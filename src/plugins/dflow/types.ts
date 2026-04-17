/**
 * DFlow API types
 */

// ============================================
// DFlow Order Response
// ============================================

export interface DFlowOrderResponse {
  transaction: string;       // base64-encoded unsigned VersionedTransaction
  inAmount: string;
  outAmount: string;
  inputMint: string;
  outputMint: string;
  priceImpactPct?: string;
  executionMode?: 'sync' | 'async';
}

// ============================================
// Swap Result
// ============================================

export interface DFlowSwapQuoteResult {
  inAmount: string;
  outAmount: string;
  inputMint: string;
  outputMint: string;
  transaction: string;       // base64-encoded unsigned VersionedTransaction
  priceImpactPct?: string;
}
