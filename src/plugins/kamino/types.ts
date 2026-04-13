/**
 * Kamino Finance API types
 */

// ============================================
// Market Types
// ============================================

export interface KaminoMarket {
  marketAddress: string;
  marketName: string;
  isMain: boolean;
}

export interface KaminoReserve {
  address: string;
  mintAddress: string;
  symbol: string;
  decimals: number;
  supplyApy: number;
  borrowApy: number;
  totalSupply: string;
  totalBorrow: string;
  availableLiquidity: string;
  ltv: number;
}

// ============================================
// Transaction Types
// ============================================

export interface KaminoTransactionResponse {
  transaction: string; // base64 serialized unsigned transaction
}

export interface KaminoDepositRequest {
  wallet: string;
  market: string;
  reserve: string;
  amount: string;
}

export interface KaminoWithdrawRequest {
  wallet: string;
  market: string;
  reserve: string;
  amount: string;
}

// ============================================
// Raw Obligation (API response format)
// ============================================

export interface RawKaminoObligationResponse {
  obligationAddress: string;
  state: {
    tag: string;
    lastUpdate: Record<string, unknown>;
    lendingMarket: string;
    owner: string;
    deposits: RawKaminoDeposit[];
    borrows: RawKaminoBorrow[];
    [key: string]: unknown;
  };
}

export interface RawKaminoDeposit {
  depositReserve: string;
  depositedAmount: string;
  marketValueSf: string;
  [key: string]: unknown;
}

export interface RawKaminoBorrow {
  borrowReserve: string;
  borrowedAmountSf: string;
  marketValueSf: string;
  [key: string]: unknown;
}

// ============================================
// Enriched Obligation (CLI output format)
// ============================================

export interface KaminoObligation {
  obligationAddress: string;
  deposits: KaminoObligationDeposit[];
  borrows: KaminoObligationBorrow[];
  totalDepositValue: string;
  totalBorrowValue: string;
  netAccountValue: string;
}

export interface KaminoObligationDeposit {
  reserveAddress: string;
  mintAddress: string;
  symbol: string;
  amount: string;        // underlying token amount (cToken converted via exchange rate)
  cTokenAmount: string;  // raw cToken amount for traceability
  marketValue: string;
  apy: number;
}

export interface KaminoObligationBorrow {
  reserveAddress: string;
  mintAddress: string;
  symbol: string;
  amount: string;
  marketValue: string;
  apy: number;
}
