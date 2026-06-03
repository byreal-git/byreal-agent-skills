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
    return err(sourceUnavailableError(`${msg}: GET ${url}`, true));
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
