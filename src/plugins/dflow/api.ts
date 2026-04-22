/**
 * DFlow API client — REST-based swap quotes
 *
 * Routing (see src/core/proxy.ts):
 *   1. proxy        — ${PROXY_URL}/dflow/... (key injected by gateway)
 *   2. direct-paid  — https://quote-api.dflow.net/... (requires DFLOW_API_KEY)
 *   3. direct-free  — https://dev-quote-api.dflow.net/... (no key, rate-limited)
 */

import { ByrealError, ErrorCodes } from '../../core/errors.js';
import {
  DFLOW_API_KEY,
  DFLOW_PAID_URL,
  DFLOW_FREE_URL,
  DEFAULTS,
} from '../../core/constants.js';
import { PROXY_URL, isProxyAvailable } from '../../core/proxy.js';
import type { Result } from '../../core/types.js';
import type { DFlowOrderResponse, DFlowSwapQuoteResult } from './types.js';

// ============================================
// Route resolution
// ============================================

export type DFlowRoute = 'proxy' | 'direct-paid' | 'direct-free';
let lastRoute: DFlowRoute | null = null;
export function getLastRoute(): DFlowRoute | null { return lastRoute; }

async function resolveOrderUrl(): Promise<{
  base: string;
  headers: Record<string, string>;
  route: DFlowRoute;
}> {
  if (await isProxyAvailable()) {
    lastRoute = 'proxy';
    return {
      base: `${PROXY_URL.replace(/\/$/, '')}/dflow`,
      headers: {},
      route: 'proxy',
    };
  }
  if (DFLOW_API_KEY) {
    lastRoute = 'direct-paid';
    return {
      base: DFLOW_PAID_URL,
      headers: { 'x-api-key': DFLOW_API_KEY },
      route: 'direct-paid',
    };
  }
  lastRoute = 'direct-free';
  return { base: DFLOW_FREE_URL, headers: {}, route: 'direct-free' };
}

// ============================================
// Swap Quote
// ============================================

export async function getSwapQuote(params: {
  inputMint: string;
  outputMint: string;
  amount: string;
  slippageBps: number;
  userPublicKey: string;
}): Promise<Result<DFlowSwapQuoteResult, ByrealError>> {
  // DFlow uses 'auto' slippage by default; pass explicit bps if user provided
  const slippageValue = params.slippageBps > 0 ? String(params.slippageBps) : 'auto';

  const query = new URLSearchParams({
    userPublicKey: params.userPublicKey,
    inputMint: params.inputMint,
    outputMint: params.outputMint,
    amount: params.amount,
    slippageBps: slippageValue,
  });

  const { base, headers } = await resolveOrderUrl();
  const url = `${base}/order?${query.toString()}`;

  if (process.env.DEBUG) {
    console.error(`[DEBUG] DFlow GET ${url}`);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULTS.REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': 'byreal-cli', ...headers },
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    const aborted = (e as Error).name === 'AbortError';
    return {
      ok: false,
      error: new ByrealError({
        code: aborted ? ErrorCodes.TIMEOUT : ErrorCodes.NETWORK_ERROR,
        type: 'NETWORK',
        message: aborted
          ? 'DFlow request timed out.'
          : `DFlow swap failed: ${(e as Error).message}`,
        retryable: true,
      }),
    };
  }
  clearTimeout(timer);

  if (!response.ok) {
    if (response.status === 429) {
      return {
        ok: false,
        error: new ByrealError({
          code: ErrorCodes.NETWORK_ERROR,
          type: 'NETWORK',
          message: 'DFlow rate limit exceeded.',
          retryable: true,
        }),
      };
    }
    return {
      ok: false,
      error: new ByrealError({
        code: ErrorCodes.API_ERROR,
        type: 'NETWORK',
        message: `DFlow API error: ${response.status} ${response.statusText}`,
        details: { status_code: response.status },
        retryable: response.status >= 500,
      }),
    };
  }

  const data = (await response.json()) as DFlowOrderResponse;

  if (!data.transaction) {
    return {
      ok: false,
      error: new ByrealError({
        code: ErrorCodes.API_ERROR,
        type: 'NETWORK',
        message: 'No transaction returned from DFlow /order endpoint.',
        retryable: true,
      }),
    };
  }

  return {
    ok: true,
    value: {
      inAmount: data.inAmount || params.amount,
      outAmount: data.outAmount || '0',
      inputMint: data.inputMint || params.inputMint,
      outputMint: data.outputMint || params.outputMint,
      transaction: data.transaction,
      priceImpactPct: data.priceImpactPct,
    },
  };
}
