/**
 * Titan Exchange API types
 */

// ============================================
// Titan Compact Instruction Format (from SDK)
// ============================================

export interface TitanAccountMeta {
  p: Uint8Array; // pubkey
  s: boolean;    // isSigner
  w: boolean;    // isWritable
}

export interface TitanInstruction {
  p: Uint8Array;         // programId
  a: TitanAccountMeta[]; // accounts
  d: Uint8Array;         // instruction data
}

// ============================================
// Titan Swap Route (from SDK stream)
// ============================================

export interface TitanSwapRoute {
  inAmount: number;
  outAmount: number;
  slippageBps: number;
  transaction?: Uint8Array;
  instructions: TitanInstruction[];
  addressLookupTables: Uint8Array[];
  computeUnits?: number;
  computeUnitsSafe?: number;
}

// ============================================
// Swap Result
// ============================================

export interface TitanSwapQuoteResult {
  inAmount: string;
  outAmount: string;
  inputMint: string;
  outputMint: string;
  transaction: string; // base64-encoded unsigned VersionedTransaction
}
