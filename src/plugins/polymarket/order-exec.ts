/**
 * Order placement orchestrator (Plan B, execute mode) — docs/09 §2, docs/06 C1–C9.
 *
 *   encode → sign (Privy) → assemble suffix → submit → market terminal poll
 *
 * Robustness (docs/06 C7): submit 425/5xx → exponential backoff ≤ maxEarlyRetries;
 * submit 400 insufficient-balance OR success:false balance rejection → syncBalance
 * (BUY=COLLATERAL / SELL=CONDITIONAL+token_id) then ONE retry.
 *
 * Market terminal poll (docs/06 C9): GET data/order/{id}, classify via order-terminal;
 * 1.5s × ≤ pollBudgetMs; timeout → pending (NOT failure).
 *
 * All side effects are injected (PlaceDeps) so the happy path + retries + poll are
 * unit-testable with a fake clock and no network.
 */

import { ok, err } from '../../core/types.js';
import type { Result } from '../../core/types.js';
import type { ByrealError } from '../../core/errors.js';
import { apiError } from '../../core/errors.js';
import type { Eip712TypedData } from '../../privy/types.js';
import type {
  OrderEncodeReq,
  OrderEncodeDTO,
  SubmitOrderBody,
  OrderResponse,
  OpenOrder,
  OrderSide,
  OrderPlaceResult,
} from './types.js';
import { toEncodeReq, toSubmitBody } from './lib/order-build.js';
import { classifyPoll } from './lib/order-terminal.js';

export interface PlaceDeps {
  encode: (req: OrderEncodeReq) => Promise<Result<OrderEncodeDTO, ByrealError>>;
  sign: (eip712: Eip712TypedData) => Promise<Result<string, ByrealError>>;
  submit: (body: SubmitOrderBody) => Promise<Result<OrderResponse, ByrealError>>;
  syncBalance: (assetType: 'COLLATERAL' | 'CONDITIONAL', tokenId?: string) => Promise<void>;
  pollOnce: (orderId: string) => Promise<Result<OpenOrder, ByrealError>>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

export interface PlaceParams {
  walletAddress: string;
  tokenId: string;
  conditionId?: string;
  side: OrderSide;
  signedPrice: string;
  /** Shares (BUY market: derived from amount/price by the caller). */
  size: string;
  negRisk: boolean;
  pollBudgetMs?: number; // default 20000
  pollIntervalMs?: number; // default 1500
  maxEarlyRetries?: number; // default 3
}

const BALANCE_RE = /balance|allowance|insufficient|not enough/i;

function isBalanceFailure(text: string | undefined): boolean {
  return !!text && BALANCE_RE.test(text);
}

export async function runOrderPlace(
  p: PlaceParams,
  d: PlaceDeps,
): Promise<Result<OrderPlaceResult, ByrealError>> {
  const pollBudgetMs = p.pollBudgetMs ?? 20_000;
  const pollIntervalMs = p.pollIntervalMs ?? 1_500;
  const maxEarly = p.maxEarlyRetries ?? 3;
  const assetType: 'COLLATERAL' | 'CONDITIONAL' = p.side === 'BUY' ? 'COLLATERAL' : 'CONDITIONAL';
  const syncTokenId = p.side === 'SELL' ? p.tokenId : undefined;

  // ---- encode ----
  const encR = await d.encode(
    toEncodeReq({
      walletAddress: p.walletAddress,
      tokenId: p.tokenId,
      conditionId: p.conditionId,
      side: p.side,
      signedPrice: p.signedPrice,
      size: p.size,
      negRisk: p.negRisk,
    }),
  );
  if (!encR.ok) return encR;
  const dto = encR.value;

  // ---- sign (Privy) ----
  const sigR = await d.sign(dto.eip712);
  if (!sigR.ok) return sigR;
  const body = toSubmitBody(dto, sigR.value, 'FOK');

  // ---- submit with robustness: maxEarly retries for 425/5xx + ONE balance-sync retry ----
  let earlyRetries = 0;
  let didBalanceSync = false;
  let resp: OrderResponse | null = null;
  for (;;) {
    const sub = await d.submit(body);
    if (!sub.ok) {
      const e = sub.error;
      if (e.retryable && earlyRetries < maxEarly) {
        await d.sleep(2 ** earlyRetries * 500); // 500ms, 1s, 2s
        earlyRetries++;
        continue;
      }
      const status400 = e.details?.status_code === 400;
      if (status400 && !didBalanceSync && isBalanceFailure(e.message)) {
        await d.syncBalance(assetType, syncTokenId);
        didBalanceSync = true;
        continue;
      }
      return err(e);
    }
    // HTTP 200 — but Polymarket may still reject (success:false)
    if (sub.value.success === false) {
      if (!didBalanceSync && isBalanceFailure(sub.value.errorMsg)) {
        await d.syncBalance(assetType, syncTokenId);
        didBalanceSync = true;
        continue;
      }
      return err(apiError(`order rejected: ${sub.value.errorMsg ?? sub.value.status ?? 'unknown'}`));
    }
    resp = sub.value;
    break;
  }

  const orderID = resp.orderID;
  if (!orderID) {
    return err(apiError('order accepted but response had no orderID'));
  }

  const base: OrderPlaceResult = {
    orderID,
    status: resp.status ?? null,
    outcome: 'pending',
    side: p.side,
    signed_price: p.signedPrice,
    size: p.size,
    taking_amount: resp.takingAmount,
    making_amount: resp.makingAmount,
    transaction_hashes: resp.transactionsHashes,
  };

  // ---- market terminal poll ----
  const deadline = d.now() + pollBudgetMs;
  for (;;) {
    const pr = await d.pollOnce(orderID);
    const timedOut = d.now() >= deadline;
    if (pr.ok) {
      const c = classifyPoll(pr.value, timedOut);
      if (c.outcome === 'settled') return ok({ ...base, outcome: 'settled', status: c.order.status ?? base.status });
      if (c.outcome === 'pending') return ok({ ...base, outcome: 'pending', status: c.order.status ?? base.status });
    } else if (timedOut) {
      return ok(base); // pending — couldn't confirm within budget
    }
    await d.sleep(pollIntervalMs);
  }
}
