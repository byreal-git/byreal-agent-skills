/**
 * Shared Privy signing helpers for command implementations.
 *
 * Three execution patterns:
 *   - privyBroadcastOne: single tx, sign + broadcast, returns { signature }
 *   - privyBroadcastMany: N txs, sequential, returns per-index outcomes
 *   - privySignMany:     N txs, sign-only, returns per-index signed base64
 *                        (used by the atomic claim-rewards flow)
 */

import chalk from 'chalk';
import { SOLANA_MAINNET_CAIP2 } from '../core/constants.js';
import { ok } from '../core/types.js';
import type { Result } from '../core/types.js';
import {
  privyNotConfiguredError,
  privyWalletNotFoundError,
  type ByrealError,
} from '../core/errors.js';
import { loadAgentToken, loadPrivyConfig, loadRealclawConfig } from './config.js';
import { signTransaction, signAndBroadcast } from './client.js';
import type { PrivyContext } from './types.js';

// ============================================
// Context Resolution
// ============================================

/**
 * Resolve a PrivyContext (token + config + caip2) for the given wallet.
 * Returns null when the user has no Privy configuration at all.
 *
 * If the user *does* have a realclaw-config.json with solana wallets but
 * none match `walletAddress`, this throws PRIVY_WALLET_NOT_FOUND so the
 * caller can surface a precise error rather than fall through to "missing".
 */
export function getPrivyContext(walletAddress?: string): PrivyContext | null {
  const config = loadPrivyConfig();
  if (!config) return null;

  const token = loadAgentToken(walletAddress);
  if (!token) {
    // Differentiate "no token at all" vs "wallet-specific token not found".
    if (walletAddress) {
      const realclaw = loadRealclawConfig();
      const hasSolWallets =
        realclaw?.wallets?.some((w) => w.type === 'solana') ?? false;
      if (hasSolWallets) {
        throw privyWalletNotFoundError(walletAddress);
      }
    }
    return null;
  }

  return { token, config, caip2: SOLANA_MAINNET_CAIP2 };
}

/** Same as getPrivyContext but throws PRIVY_NOT_CONFIGURED on null. */
export function requirePrivyContext(walletAddress?: string): PrivyContext {
  const ctx = getPrivyContext(walletAddress);
  if (!ctx) throw privyNotConfiguredError();
  return ctx;
}

// ============================================
// Broadcast One
// ============================================

export interface BroadcastOneResult {
  signature: string;
}

export async function privyBroadcastOne(
  ctx: PrivyContext,
  unsignedTx: string,
): Promise<Result<BroadcastOneResult, ByrealError>> {
  if (process.env.DEBUG) {
    console.error(chalk.gray('[DEBUG] Privy: signing + broadcasting transaction...'));
  }
  const r = await signAndBroadcast(ctx.token, ctx.config, unsignedTx, ctx.caip2);
  if (!r.ok) return r;
  return ok({ signature: r.value });
}

// ============================================
// Broadcast Many (sequential)
// ============================================

export interface BroadcastManyResult {
  results: Array<{ index: number; signature?: string; error?: string }>;
  successCount: number;
  failCount: number;
}

export async function privyBroadcastMany(
  ctx: PrivyContext,
  unsignedTxs: string[],
): Promise<Result<BroadcastManyResult, ByrealError>> {
  const results: BroadcastManyResult['results'] = [];
  let successCount = 0;
  let failCount = 0;
  for (let i = 0; i < unsignedTxs.length; i++) {
    if (process.env.DEBUG) {
      console.error(
        chalk.gray(`[DEBUG] Privy: broadcasting tx ${i + 1}/${unsignedTxs.length}...`),
      );
    }
    const r = await signAndBroadcast(ctx.token, ctx.config, unsignedTxs[i], ctx.caip2);
    if (r.ok) {
      results.push({ index: i, signature: r.value });
      successCount++;
    } else {
      results.push({ index: i, error: r.error.message });
      failCount++;
    }
  }
  return ok({ results, successCount, failCount });
}

// ============================================
// Sign Many (sign only — used by atomic reward claim flow)
// ============================================

export interface SignManyResult {
  signedTxs: Array<{ index: number; signedTx: string }>;
}

/**
 * Sign every tx; if ANY tx fails to sign, return the first error.
 *
 * Atomic semantics: callers (claim-rewards / claim-bonus) submit the whole
 * batch to a Byreal backend endpoint that expects all signatures present.
 * Partial signing would let the backend reject the order anyway, so we
 * fail-fast on the first error to keep error reporting clean.
 */
export async function privySignMany(
  ctx: PrivyContext,
  unsignedTxs: string[],
): Promise<Result<SignManyResult, ByrealError>> {
  const signedTxs: SignManyResult['signedTxs'] = [];
  for (let i = 0; i < unsignedTxs.length; i++) {
    if (process.env.DEBUG) {
      console.error(
        chalk.gray(`[DEBUG] Privy: signing tx ${i + 1}/${unsignedTxs.length} (no broadcast)...`),
      );
    }
    const r = await signTransaction(ctx.token, ctx.config, unsignedTxs[i]);
    if (!r.ok) return r;
    signedTxs.push({ index: i, signedTx: r.value });
  }
  return ok({ signedTxs });
}
