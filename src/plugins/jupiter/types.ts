/**
 * Jupiter API types
 */

// ============================================
// Swap Types
// ============================================

export interface JupiterQuoteResponse {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  priceImpactPct: string;
  routePlan: JupiterRoutePlan[];
  contextSlot?: number;
  timeTaken?: number;
}

export interface JupiterRoutePlan {
  swapInfo: {
    ammKey: string;
    label: string;
    inputMint: string;
    outputMint: string;
    inAmount: string;
    outAmount: string;
    feeAmount: string;
    feeMint: string;
  };
  percent: number;
}

export interface JupiterSwapRequest {
  quoteResponse: JupiterQuoteResponse;
  userPublicKey: string;
  wrapAndUnwrapSol?: boolean;
  dynamicComputeUnitLimit?: boolean;
  dynamicSlippage?: boolean;
  prioritizationFeeLamports?: {
    priorityLevelWithMaxLamports: {
      maxLamports: number;
      global: boolean;
      priorityLevel: string;
    };
  };
}

export interface JupiterSwapResponse {
  swapTransaction: string;
  lastValidBlockHeight: number;
  prioritizationFeeLamports: number;
  computeUnitLimit: number;
  prioritizationType: {
    computeBudget: {
      microLamports: number;
      estimatedMicroLamports: number;
    };
  };
  dynamicSlippageReport?: {
    slippageBps: number;
    otherAmount: number;
    simulatedIncurredSlippageBps: number;
  };
}

// ============================================
// Price Types (V3 format)
// ============================================

/** V3 price response: keys are mint addresses */
export type JupiterPriceResponse = Record<string, JupiterPriceData>;

export interface JupiterPriceData {
  decimals: number;
  usdPrice: number;
  priceChange24h?: number | null;
  blockId?: number | null;
  createdAt?: string;
  liquidity?: number;
}
