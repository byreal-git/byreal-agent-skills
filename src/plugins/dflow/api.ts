/**
 * DFlow API client — REST-based swap quotes
 */

import ky, { HTTPError, TimeoutError } from 'ky';
import { ByrealError, ErrorCodes } from '../../core/errors.js';
import { DFLOW_API_URL, DFLOW_API_KEY, DEFAULTS } from '../../core/constants.js';
import type { Result } from '../../core/types.js';
import type { DFlowOrderResponse, DFlowSwapQuoteResult } from './types.js';

// ============================================
// HTTP Client
// ============================================

function createDFlowClient() {
  return ky.create({
    prefixUrl: DFLOW_API_URL,
    timeout: DEFAULTS.REQUEST_TIMEOUT_MS,
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'byreal-cli',
      ...(DFLOW_API_KEY ? { 'x-api-key': DFLOW_API_KEY } : {}),
    },
    hooks: {
      beforeRequest: [
        (request) => {
          if (process.env.DEBUG) {
            console.error(`[DEBUG] DFlow ${request.method} ${request.url}`);
          }
        },
      ],
    },
  });
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
  const client = createDFlowClient();

  // DFlow uses 'auto' slippage by default; pass explicit bps if user provided
  const slippageValue = params.slippageBps > 0 ? String(params.slippageBps) : 'auto';

  try {
    const response = await client.get('order', {
      searchParams: {
        userPublicKey: params.userPublicKey,
        inputMint: params.inputMint,
        outputMint: params.outputMint,
        amount: params.amount,
        slippageBps: slippageValue,
      },
    });

    const data = await response.json<DFlowOrderResponse>();

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
  } catch (e) {
    return { ok: false, error: handleDFlowError(e) };
  }
}

// ============================================
// Error Handling
// ============================================

function handleDFlowError(error: unknown): ByrealError {
  if (error instanceof HTTPError) {
    const status = error.response.status;
    if (status === 429) {
      return new ByrealError({
        code: ErrorCodes.NETWORK_ERROR,
        type: 'NETWORK',
        message: 'DFlow rate limit exceeded. Set DFLOW_API_KEY for production use.',
        retryable: true,
      });
    }
    return new ByrealError({
      code: ErrorCodes.API_ERROR,
      type: 'NETWORK',
      message: `DFlow API error: ${status} ${error.response.statusText}`,
      details: { status_code: status },
      retryable: status >= 500,
    });
  }

  if (error instanceof TimeoutError) {
    return new ByrealError({
      code: ErrorCodes.TIMEOUT,
      type: 'NETWORK',
      message: 'DFlow request timed out.',
      retryable: true,
    });
  }

  const message = error instanceof Error ? error.message : 'Unknown DFlow error';
  return new ByrealError({
    code: ErrorCodes.NETWORK_ERROR,
    type: 'NETWORK',
    message: `DFlow swap failed: ${message}`,
    retryable: true,
  });
}
