/**
 * Token registry and decimals resolver for Byreal CLI
 *
 * Hardcodes common token decimals to avoid RPC calls,
 * and falls back to on-chain lookup for unknown tokens.
 */

import { PublicKey } from '@solana/web3.js';
import { getConnection } from './solana.js';

// ============================================
// Well-known token decimals (hardcoded)
// ============================================

const KNOWN_DECIMALS: Record<string, number> = {
  // Native SOL (wrapped)
  'So11111111111111111111111111111111111111112': 9,
  // Stablecoins
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 6, // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': 6,  // USDT
  // Byreal ecosystem
  'Bybit2vBJGhPF52GBdNaQfUJ6ZpThSgHBobjWZpLPb4B': 9, // bbSOL
  '4SoQ8UkWfeDH47T56PA53CZCeW4KytYCiU65CwBWoJUt': 9, // MNT
  //  XAUt0
  'AymATz4TCL9sWNEEV9Kvyz45CHVhDZ6kUgjTJPzLpU9P': 6,
  // XStocks
  'XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB': 8, // Tesla
  'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh': 8 // NVIDIA
};

// Runtime cache for RPC-resolved decimals
const decimalsCache = new Map<string, number>();

// ============================================
// Public API
// ============================================

/**
 * Resolve token decimals for a given mint address.
 * 1. Check hardcoded registry
 * 2. Check runtime cache
 * 3. Query on-chain via RPC (getAccountInfo + MintLayout offset 44)
 */
export async function resolveDecimals(mint: string): Promise<number> {
  // 1. Hardcoded
  if (KNOWN_DECIMALS[mint] !== undefined) {
    return KNOWN_DECIMALS[mint];
  }

  // 2. Runtime cache
  if (decimalsCache.has(mint)) {
    return decimalsCache.get(mint)!;
  }

  // 3. On-chain lookup
  const connection = getConnection();
  const pubkey = new PublicKey(mint);
  const accountInfo = await connection.getAccountInfo(pubkey);

  if (!accountInfo?.data || accountInfo.data.length < 45) {
    throw new Error(`Cannot resolve decimals for mint: ${mint} (account not found or invalid)`);
  }

  // Mint layout: decimals is a single byte at offset 44
  const decimals = accountInfo.data[44];
  decimalsCache.set(mint, decimals);

  if (process.env.DEBUG) {
    console.error(`[DEBUG] Resolved decimals for ${mint}: ${decimals} (via RPC)`);
  }

  return decimals;
}
