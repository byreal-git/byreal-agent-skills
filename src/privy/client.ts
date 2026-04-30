/**
 * HTTP client for the Privy proxy signing endpoints.
 *
 * Public API:
 *   - signTransaction(token, config, unsignedTx)   → base64 signed tx (broadcast=false)
 *   - signAndBroadcast(token, config, unsignedTx, caip2) → tx hash (broadcast=true)
 *
 * Both functions return Result<T, ByrealError> and never throw.
 */

import { DEFAULTS, PRIVY_STRATEGY_ID, PRIVY_STRATEGY_NAME } from '../core/constants.js';
import { ok, err } from '../core/types.js';
import type { Result } from '../core/types.js';
import type { ByrealError } from '../core/errors.js';
import {
  privyAuthError,
  privyBadRequestError,
  privyBusinessError,
  privyRateLimitedError,
  privyTimeoutError,
  privyUpstreamError,
} from '../core/errors.js';
import {
  type PrivyConfig,
  type SignSolanaTransactionRequest,
  type SignBroadcastResponse,
  type SignOnlyResponse,
  type PrivyEnvelope,
  unwrapEnvelope,
} from './types.js';

const SIGN_PATH = '/sign/solana-transaction';
// Privy proxy signing endpoints have a 30-second timeout per service docs.
const SIGN_TIMEOUT_MS = DEFAULTS.REQUEST_TIMEOUT_MS;

// ============================================
// HTTP Helper
// ============================================

async function privyPost<T>(
  token: string,
  config: PrivyConfig,
  path: string,
  body: Record<string, unknown>,
): Promise<Result<T, ByrealError>> {
  const url = `${config.proxyUrl}${config.apiBasePath}${path}`;

  if (process.env.DEBUG) {
    console.error(`[DEBUG] Privy POST ${url}`);
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'byreal-cli',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(SIGN_TIMEOUT_MS),
    });
  } catch (e: unknown) {
    if (e instanceof DOMException && e.name === 'TimeoutError') {
      return err(privyTimeoutError(SIGN_TIMEOUT_MS));
    }
    const msg = (e as Error)?.message ?? 'Network error';
    return err(privyUpstreamError(msg, true));
  }

  // HTTP-level mapping
  if (res.status === 401 || res.status === 403) {
    const text = await res.text().catch(() => '');
    return err(privyAuthError(text || `HTTP ${res.status}`));
  }
  if (res.status === 422) {
    const text = await res.text().catch(() => '');
    return err(privyBadRequestError(text || `HTTP ${res.status}`));
  }
  if (res.status === 429) {
    return err(privyRateLimitedError());
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return err(privyUpstreamError(`HTTP ${res.status}: ${text}`, res.status >= 500));
  }

  // Parse + unwrap envelope (direct or BGW)
  let raw: PrivyEnvelope<T>;
  try {
    raw = (await res.json()) as PrivyEnvelope<T>;
  } catch {
    return err(privyUpstreamError('Invalid JSON response from Privy proxy'));
  }
  const envelope = unwrapEnvelope(raw);

  if (process.env.DEBUG) {
    console.error(
      `[DEBUG] Privy response: success=${envelope.success} retCode=${envelope.retCode} retMsg=${envelope.retMsg ?? ''}`,
    );
  }

  if (envelope.retCode !== 0 || envelope.success === false) {
    const retMsg = envelope.retMsg ?? '';
    return err(privyBusinessError(envelope.retCode, retMsg));
  }

  if (envelope.data === null || envelope.data === undefined) {
    return err(privyUpstreamError('Empty data in Privy proxy response'));
  }

  return ok(envelope.data);
}

// ============================================
// Public Signing Functions
// ============================================

/**
 * Sign a Solana transaction without broadcasting; returns signed base64.
 *
 * The proxy returns the Privy SDK passthrough shape:
 *   { data: { encoding: "base64", signed_transaction: "..." }, method: "signTransaction" }
 *
 * Older / direct-mode envelopes may still return a flat { signedTransaction }
 * which we accept as a fallback.
 */
export async function signTransaction(
  token: string,
  config: PrivyConfig,
  unsignedTx: string,
): Promise<Result<string, ByrealError>> {
  const body: SignSolanaTransactionRequest = {
    transaction: unsignedTx,
    broadcast: false,
    strategyId: PRIVY_STRATEGY_ID,
    strategyName: PRIVY_STRATEGY_NAME,
  };

  const result = await privyPost<SignOnlyResponse>(
    token,
    config,
    SIGN_PATH,
    body as unknown as Record<string, unknown>,
  );
  if (!result.ok) return result;

  // Preferred: nested snake_case shape (Privy SDK passthrough).
  const nested = result.value.data?.signed_transaction;
  if (nested) return ok(nested);

  // Fallback: legacy flat camelCase shape.
  const flat = result.value.signedTransaction;
  if (flat) return ok(flat);

  return err(privyUpstreamError('No signed_transaction in Privy response'));
}

/** Sign + broadcast a Solana transaction; returns the on-chain tx hash. */
export async function signAndBroadcast(
  token: string,
  config: PrivyConfig,
  unsignedTx: string,
  caip2: string,
): Promise<Result<string, ByrealError>> {
  const body: SignSolanaTransactionRequest = {
    transaction: unsignedTx,
    broadcast: true,
    caip2,
    strategyId: PRIVY_STRATEGY_ID,
    strategyName: PRIVY_STRATEGY_NAME,
  };

  const result = await privyPost<SignBroadcastResponse>(
    token,
    config,
    SIGN_PATH,
    body as unknown as Record<string, unknown>,
  );
  if (!result.ok) return result;

  if (!result.value.hash) {
    return err(privyUpstreamError('No transaction hash in Privy broadcast response'));
  }
  return ok(result.value.hash);
}
