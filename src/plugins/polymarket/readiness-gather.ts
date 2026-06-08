/**
 * Readiness data-gather (network) shared by `account readiness` and `order place`.
 *
 * Aggregates: /wallet/status (READY + proxy) + /clob/balance-allowance (BUY=
 * COLLATERAL / SELL=CONDITIONAL+token_id) + /clob/markets booleans, then runs the
 * pure aggregateReadiness. Degrades gracefully: a balance/market fetch failure is
 * reported as not-ready (not a hard throw); only a wallet-status network error
 * propagates. Without --condition-id the market booleans cannot be verified and
 * are reported as such (see detail).
 */

import { ok } from '../../core/types.js';
import type { Result } from '../../core/types.js';
import type { ByrealError } from '../../core/errors.js';
import type { OrderSide, ReadinessVerdict } from './types.js';
import type { PmWriteAuth } from './api/gateway.js';
import { getWalletStatus } from './api/wallet.js';
import { getBalanceAllowance } from './api/clob-account.js';
import { getMarket } from './api/clob.js';
import { aggregateReadiness } from './lib/readiness.js';

export interface ReadinessGatherParams {
  auth: PmWriteAuth; // token + evmAddress (EOA)
  tokenId: string;
  side: OrderSide;
  need: string;
  conditionId?: string;
}

export async function gatherReadiness(
  p: ReadinessGatherParams,
): Promise<Result<ReadinessVerdict, ByrealError>> {
  const eoa = p.auth.evmAddress;

  // 1) wallet status (READY + proxyAddress). Hard-error on network failure.
  const statusR = await getWalletStatus(eoa);
  if (!statusR.ok) return statusR;
  const walletStatus = statusR.value.status;
  const proxyAddress = statusR.value.proxyAddress ?? null;

  // 2) balance (BUY=COLLATERAL / SELL=CONDITIONAL+token_id). Degrade to '0'.
  const assetType = p.side === 'BUY' ? 'COLLATERAL' : 'CONDITIONAL';
  const balR = await getBalanceAllowance(assetType, p.tokenId, p.auth);
  const balance = balR.ok ? balR.value.balance : '0';

  // 3) market booleans via /clob/markets (needs conditionId). enableOrderBook is a
  //    Gamma field absent from /clob/markets → approximated as active && !closed.
  let market = { active: true, acceptingOrders: true, enableOrderBook: true };
  let marketVerified = false;
  if (p.conditionId) {
    const mR = await getMarket(p.conditionId);
    if (mR.ok) {
      marketVerified = true;
      market = {
        active: mR.value.active !== false,
        acceptingOrders: mR.value.accepting_orders !== false,
        enableOrderBook: mR.value.active !== false && mR.value.closed !== true,
      };
    }
  }

  const verdict = aggregateReadiness({
    walletStatus,
    proxyAddress,
    balance,
    need: p.need,
    side: p.side,
    market,
  });
  if (!marketVerified) {
    verdict.checks.market.detail += ' (not verified — pass --condition-id)';
  }
  return ok(verdict);
}
