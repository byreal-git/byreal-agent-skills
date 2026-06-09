/**
 * Polymarket gateway read base client.
 *
 * All Phase A endpoints are PUBLIC reads (no auth) on the Byreal PM gateway:
 *   {host}/byreal/api/gw/pm/{base}{path}
 *     base = 'v1'    → business REST  (/categoy/*, /wallet/*, /bridge/*)
 *     base = 'clob'  → CLOB passthrough (/book, /price, /markets/{cond})
 *     base = 'gamma' → Gamma passthrough (/public-search, /events/{id})
 *
 * Returns Result<T, ByrealError>; never throws. Errors map to:
 *   network/abort/5xx → SOURCE_UNAVAILABLE (retryable)
 *   other non-2xx     → API_ERROR (retryable only for 5xx)
 *
 * Write auth (Authorization + x-evm-address for /clob writes) is Phase B.
 */

import {
  DEFAULTS,
  PM_GATEWAY_HOST_DEFAULT,
  PM_GATEWAY_BASE_PATH,
} from '../../../core/constants.js';
import { ok, err } from '../../../core/types.js';
import type { Result } from '../../../core/types.js';
import type { ByrealError } from '../../../core/errors.js';
import { apiError, sourceUnavailableError } from '../../../core/errors.js';

export type PmBase = 'v1' | 'clob' | 'gamma' | 'data';

export type PmQueryParams = Record<string, string | number | boolean | undefined>;

export interface PmGetOptions {
  /** Override the gateway host (defaults to PM_GATEWAY_HOST_DEFAULT). */
  host?: string;
  /** Extra request headers (Phase B write auth). */
  headers?: Record<string, string>;
}

function buildUrl(base: PmBase, path: string, params?: PmQueryParams, host?: string): string {
  const root = `${host ?? PM_GATEWAY_HOST_DEFAULT}${PM_GATEWAY_BASE_PATH}/${base}${path}`;
  if (!params) return root;
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    sp.set(k, String(v));
  }
  const qs = sp.toString();
  return qs ? `${root}?${qs}` : root;
}

export async function pmGet<T>(
  base: PmBase,
  path: string,
  params?: PmQueryParams,
  opts?: PmGetOptions,
): Promise<Result<T, ByrealError>> {
  const url = buildUrl(base, path, params, opts?.host);

  if (process.env.DEBUG) {
    console.error(`[DEBUG] PM GET ${url}`);
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': 'byreal-cli', Accept: 'application/json', ...opts?.headers },
      signal: AbortSignal.timeout(DEFAULTS.REQUEST_TIMEOUT_MS),
    });
  } catch (e: unknown) {
    if (e instanceof DOMException && e.name === 'TimeoutError') {
      return err(sourceUnavailableError(`request timed out: GET ${url}`, true));
    }
    const msg = (e as Error)?.message ?? 'network error';
    // `fetch` collapses connect/DNS/TLS failures into a bare "fetch failed";
    // the actionable detail (e.g. ConnectTimeoutError + attempted addresses)
    // lives on `.cause`. Surface it so these are diagnosable from the message.
    const cause = (e as Error)?.cause;
    const detail =
      cause instanceof Error ? ` (${cause.name}: ${cause.message})` : '';
    return err(sourceUnavailableError(`${msg}${detail}: GET ${url}`, true));
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    if (res.status >= 500) {
      return err(sourceUnavailableError(`HTTP ${res.status}: ${text || url}`, true));
    }
    return err(apiError(`PM gateway ${res.status}: ${text || url}`, res.status));
  }

  try {
    const json = (await res.json()) as T;
    return ok(json);
  } catch {
    return err(sourceUnavailableError(`invalid JSON from GET ${url}`, true));
  }
}

/** Auth material for gateway write requests (CLOB writes + /v1 business writes). */
export interface PmWriteAuth {
  /** Agent token (oc_at_…) sent as `Authorization: Bearer`. */
  token: string;
  /** EVM EOA sent as `x-evm-address`. */
  evmAddress: string;
}

/**
 * Authenticated gateway write (POST/DELETE). Injects `Authorization: Bearer
 * <agent-token>` + `x-evm-address: <EOA>` (the gateway resolves L2 creds and
 * injects POLY_* HMAC; see docs/02 §B / docs/04).
 *
 * Returns the RAW parsed JSON as T — mirroring pmGet. `/clob/*` is a Polymarket
 * passthrough with NO business envelope (raw OrderResponse / {balance}), while
 * `/v1/*` IS enveloped; so envelope unwrap belongs in the callers (api/market.ts
 * uses PmEnvelope + unwrapBusiness; api/order.ts + api/clob-account.ts use raw).
 *
 * HTTP mapping: 425 (too-early) + 5xx → retryable SOURCE_UNAVAILABLE; other
 * non-2xx → API_ERROR (not retryable). Never throws.
 */
export async function pmWrite<T>(
  method: 'POST' | 'DELETE',
  base: PmBase,
  path: string,
  body: unknown | undefined,
  auth: PmWriteAuth,
  opts?: PmGetOptions,
): Promise<Result<T, ByrealError>> {
  const url = buildUrl(base, path, undefined, opts?.host);

  if (process.env.DEBUG) {
    console.error(`[DEBUG] PM ${method} ${url}`);
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        'User-Agent': 'byreal-cli',
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${auth.token}`,
        'x-evm-address': auth.evmAddress,
        ...opts?.headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(DEFAULTS.REQUEST_TIMEOUT_MS),
    });
  } catch (e: unknown) {
    if (e instanceof DOMException && e.name === 'TimeoutError') {
      return err(sourceUnavailableError(`request timed out: ${method} ${url}`, true));
    }
    const msg = (e as Error)?.message ?? 'network error';
    const cause = (e as Error)?.cause;
    const detail = cause instanceof Error ? ` (${cause.name}: ${cause.message})` : '';
    return err(sourceUnavailableError(`${msg}${detail}: ${method} ${url}`, true));
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    // 425 (too-early, CLOB warmup) + 5xx are retryable; other 4xx are not.
    if (res.status === 425 || res.status >= 500) {
      return err(sourceUnavailableError(`HTTP ${res.status}: ${text || url}`, true));
    }
    return err(apiError(`PM gateway ${res.status}: ${text || url}`, res.status));
  }

  try {
    const json = (await res.json()) as T;
    return ok(json);
  } catch {
    return err(sourceUnavailableError(`invalid JSON from ${method} ${url}`, true));
  }
}
