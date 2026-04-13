/**
 * Jupiter API client — swap, price
 */

import type { Result } from '../../core/types.js';
import { ok, err } from '../../core/types.js';
import { networkError, apiError } from '../../core/errors.js';
import type { ByrealError } from '../../core/errors.js';
import type {
  JupiterQuoteResponse,
  JupiterSwapResponse,
  JupiterPriceResponse,
} from './types.js';

const JUP_SWAP_API = 'https://api.jup.ag/swap/v1';
const JUP_PRICE_API = 'https://api.jup.ag/price/v3';

// ============================================
// Swap API
// ============================================

export async function getQuote(params: {
  inputMint: string;
  outputMint: string;
  amount: string;
  slippageBps?: number;
  swapMode?: 'ExactIn' | 'ExactOut';
}): Promise<Result<JupiterQuoteResponse, ByrealError>> {
  try {
    const searchParams = new URLSearchParams({
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      amount: params.amount,
      dynamicSlippage: 'true',
      maxAccounts: '64',
      swapMode: params.swapMode ?? 'ExactIn',
    });
    if (params.slippageBps !== undefined) {
      searchParams.set('slippageBps', String(params.slippageBps));
    }

    const response = await fetch(`${JUP_SWAP_API}/quote?${searchParams}`);
    if (!response.ok) {
      const text = await response.text();
      return err(apiError(`Jupiter quote failed: ${text}`, response.status));
    }
    const data = await response.json() as JupiterQuoteResponse;
    return ok(data);
  } catch (error) {
    return err(networkError(`Jupiter quote: ${(error as Error).message}`));
  }
}

export async function getSwapTransaction(params: {
  quoteResponse: JupiterQuoteResponse;
  userPublicKey: string;
  priorityFeeMicroLamports?: number;
}): Promise<Result<JupiterSwapResponse, ByrealError>> {
  try {
    const response = await fetch(`${JUP_SWAP_API}/swap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quoteResponse: params.quoteResponse,
        userPublicKey: params.userPublicKey,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        dynamicSlippage: true,
        prioritizationFeeLamports: {
          priorityLevelWithMaxLamports: {
            maxLamports: params.priorityFeeMicroLamports ?? 10000000,
            global: false,
            priorityLevel: 'medium',
          },
        },
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      return err(apiError(`Jupiter swap failed: ${text}`, response.status));
    }
    const data = await response.json() as JupiterSwapResponse;
    return ok(data);
  } catch (error) {
    return err(networkError(`Jupiter swap: ${(error as Error).message}`));
  }
}

// ============================================
// Price API
// ============================================

export async function getPrice(mints: string[]): Promise<Result<JupiterPriceResponse, ByrealError>> {
  try {
    const response = await fetch(`${JUP_PRICE_API}?ids=${mints.join(',')}`);
    if (!response.ok) {
      const text = await response.text();
      return err(apiError(`Jupiter price failed: ${text}`, response.status));
    }
    const data = await response.json() as JupiterPriceResponse;
    return ok(data);
  } catch (error) {
    return err(networkError(`Jupiter price: ${(error as Error).message}`));
  }
}
