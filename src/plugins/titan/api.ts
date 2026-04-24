/**
 * Titan Exchange API client — REST Gateway swap quotes
 *
 * Titan Gateway returns a single msgpack-encoded response containing a map of
 * provider → SwapRoute. Each route has raw Solana instructions + address
 * lookup table addresses (not a pre-built transaction). We pick the best
 * route and build the VersionedTransaction ourselves.
 */

import {
  PublicKey,
  TransactionMessage,
  TransactionInstruction,
  VersionedTransaction,
  AddressLookupTableAccount,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import { decode as msgpackDecode } from '@msgpack/msgpack';
import { ByrealError, ErrorCodes } from '../../core/errors.js';
import { TITAN_API_URL, TITAN_AUTH_TOKEN, DEFAULTS } from '../../core/constants.js';
import { PROXY_URL, isProxyAvailable } from '../../core/proxy.js';
import { getConnection } from '../../core/solana.js';
import { getFeeConfig, pickFeeSide, resolveFeeAccountForSwap } from '../../core/fee-config.js';
import type { Result } from '../../core/types.js';
import type { TitanSwapRoute, TitanSwapQuoteResult } from './types.js';

const TITAN_TIMEOUT_MS = 15_000;

// Raw shape of the Titan Gateway /api/v1/quote/swap response (after msgpack decode)
interface TitanQuoteResponse {
  id: string;
  quotes: Record<string, TitanSwapRoute>;
  metadata?: { ExpectedWinner?: string };
}

// Titan has no free tier — only proxy or direct-with-token.
export type TitanRoute = 'proxy' | 'direct';
let lastRoute: TitanRoute | null = null;
export function getLastRoute(): TitanRoute | null { return lastRoute; }

// ============================================
// Swap Quote
// ============================================

export async function getSwapQuote(params: {
  inputMint: string;
  outputMint: string;
  amount: string;
  swapMode: 'ExactIn' | 'ExactOut';
  slippageBps: number;
  userPublicKey: string;
}): Promise<Result<TitanSwapQuoteResult, ByrealError>> {
  // Resolve route: proxy first, then direct-with-token. No free tier.
  let url: string;
  const headers: Record<string, string> = { Accept: 'application/vnd.msgpack' };
  if (await isProxyAvailable()) {
    lastRoute = 'proxy';
    const base = PROXY_URL.replace(/\/$/, '');
    url = `${base}/titan/api/v1/quote/swap`;
  } else if (TITAN_AUTH_TOKEN) {
    lastRoute = 'direct';
    url = `${TITAN_API_URL}/api/v1/quote/swap`;
    headers.Authorization = `Bearer ${TITAN_AUTH_TOKEN}`;
  } else {
    return {
      ok: false,
      error: new ByrealError({
        code: ErrorCodes.MISSING_REQUIRED,
        type: 'VALIDATION',
        message: 'Titan is only available via the Byreal proxy. The proxy is currently unreachable — please contact the Byreal team.',
        retryable: false,
      }),
    };
  }

  const query = new URLSearchParams({
    inputMint: params.inputMint,
    outputMint: params.outputMint,
    amount: params.amount,
    userPublicKey: params.userPublicKey,
    slippageBps: String(params.slippageBps),
    swapMode: params.swapMode,
  });

  // Platform fee (optional). `pickFeeSide` picks the major-mint side so the
  // treasury only needs ATAs on the handful of major mints. `feeFromInputMint`
  // must match the side of `feeAccount`'s mint; mismatch → Titan 400. Titan
  // also requires the partner JWT subject to be whitelisted server-side —
  // unrelated to env config, handled via onboarding.
  const feeConfig = getFeeConfig();
  const { mint: feeMint, side: feeSide } = pickFeeSide(params.inputMint, params.outputMint);
  const feeAccount = feeConfig
    ? await resolveFeeAccountForSwap(feeMint, getConnection(), feeConfig)
    : null;
  if (feeConfig && feeAccount) {
    query.set('feeAccount', feeAccount);
    query.set('feeBps', String(feeConfig.bps));
    query.set('feeFromInputMint', feeSide === 'input' ? 'true' : 'false');
  }

  url = `${url}?${query.toString()}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TITAN_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    const aborted = (e as Error).name === 'AbortError';
    return {
      ok: false,
      error: new ByrealError({
        code: ErrorCodes.NETWORK_ERROR,
        type: 'NETWORK',
        message: aborted
          ? `Titan request timed out after ${TITAN_TIMEOUT_MS}ms`
          : `Titan request failed: ${(e as Error).message}`,
        retryable: true,
      }),
    };
  }
  clearTimeout(timer);

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    return {
      ok: false,
      error: new ByrealError({
        code: ErrorCodes.API_ERROR,
        type: 'NETWORK',
        message: `Titan API error ${response.status}: ${bodyText.slice(0, 200) || response.statusText}`,
        retryable: response.status >= 500 || response.status === 429,
      }),
    };
  }

  let decoded: TitanQuoteResponse;
  try {
    const buf = new Uint8Array(await response.arrayBuffer());
    decoded = msgpackDecode(buf) as TitanQuoteResponse;
  } catch (e) {
    return {
      ok: false,
      error: new ByrealError({
        code: ErrorCodes.API_ERROR,
        type: 'NETWORK',
        message: `Failed to decode Titan msgpack response: ${(e as Error).message}`,
        retryable: true,
      }),
    };
  }

  // Pick the best route across all providers.
  const bestRoute = pickBestRoute(decoded.quotes ?? {}, params.swapMode);
  if (!bestRoute || !bestRoute.instructions?.length) {
    return {
      ok: false,
      error: new ByrealError({
        code: ErrorCodes.API_ERROR,
        type: 'NETWORK',
        message: 'No swap route returned from Titan.',
        retryable: true,
      }),
    };
  }

  try {
    const transaction = await buildTransaction(
      bestRoute.instructions,
      bestRoute.addressLookupTables,
      params.userPublicKey,
      bestRoute.computeUnitsSafe ?? bestRoute.computeUnits,
    );

    return {
      ok: true,
      value: {
        inAmount: String(bestRoute.inAmount),
        outAmount: String(bestRoute.outAmount),
        inputMint: params.inputMint,
        outputMint: params.outputMint,
        transaction,
      },
    };
  } catch (e) {
    return {
      ok: false,
      error: new ByrealError({
        code: ErrorCodes.NETWORK_ERROR,
        type: 'NETWORK',
        message: `Failed to build Titan transaction: ${(e as Error).message}`,
        retryable: true,
      }),
    };
  }
}

function pickBestRoute(
  quotes: Record<string, TitanSwapRoute>,
  swapMode: 'ExactIn' | 'ExactOut',
): TitanSwapRoute | null {
  let best: TitanSwapRoute | null = null;
  for (const route of Object.values(quotes)) {
    if (!route?.instructions?.length) continue;
    if (!best) { best = route; continue; }
    if (swapMode === 'ExactIn') {
      if (BigInt(route.outAmount) > BigInt(best.outAmount)) best = route;
    } else {
      if (BigInt(route.inAmount) < BigInt(best.inAmount)) best = route;
    }
  }
  return best;
}

// ============================================
// Transaction Builder
// ============================================

/**
 * Build a base64-encoded VersionedTransaction from Titan's compact
 * instruction format and address lookup table addresses.
 */
async function buildTransaction(
  instructions: TitanSwapRoute['instructions'],
  altAddresses: Uint8Array[],
  userPublicKey: string,
  computeUnits?: number,
): Promise<string> {
  const connection = getConnection();
  const payer = new PublicKey(userPublicKey);

  // Prepend compute budget instructions — Titan routes often need far more
  // than the default 200k CU limit (e.g. Titan-DART needs ~1.4M CU).
  const budgetInstructions: TransactionInstruction[] = [];
  if (computeUnits && computeUnits > 200_000) {
    budgetInstructions.push(
      ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }),
    );
  }
  budgetInstructions.push(
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: DEFAULTS.PRIORITY_FEE_MICRO_LAMPORTS }),
  );

  // Convert Titan compact instructions → Solana TransactionInstruction
  const txInstructions: TransactionInstruction[] = instructions.map((ix) => {
    const accounts = (ix.a || []).map((acc) => ({
      pubkey: new PublicKey(acc.p),
      isSigner: acc.s ?? false,
      isWritable: acc.w ?? false,
    }));

    return new TransactionInstruction({
      programId: new PublicKey(ix.p),
      keys: accounts,
      data: Buffer.from(ix.d),
    });
  });

  // Fetch address lookup tables from on-chain
  let lookupTableAccounts: AddressLookupTableAccount[] = [];
  if (altAddresses?.length) {
    const fetched = await Promise.all(
      altAddresses.map(async (addr) => {
        try {
          const result = await connection.getAddressLookupTable(new PublicKey(addr));
          return result.value;
        } catch {
          return null;
        }
      }),
    );
    lookupTableAccounts = fetched.filter(
      (t): t is AddressLookupTableAccount => t !== null,
    );
  }

  // Build VersionedTransaction (V0 with lookup tables)
  const { blockhash } = await connection.getLatestBlockhash('confirmed');

  const messageV0 = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions: [...budgetInstructions, ...txInstructions],
  }).compileToV0Message(lookupTableAccounts);

  const tx = new VersionedTransaction(messageV0);
  return Buffer.from(tx.serialize()).toString('base64');
}
