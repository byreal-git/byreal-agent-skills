/**
 * Gamma passthrough (raw Polymarket JSON, no Byreal envelope) via the gateway
 * /gamma route — gateway adds the geo-proxy to bypass Polymarket geo-blocking.
 */

import type { Result } from '../../../core/types.js';
import type { ByrealError } from '../../../core/errors.js';
import { pmGet, type PmGetOptions, type PmQueryParams } from './gateway.js';
import type { RawEvent } from '../lib/neg-risk.js';

/** GET /gamma/events/{id} → full event with markets[]. */
export async function getEvent(
  eventId: string,
  opts?: PmGetOptions,
): Promise<Result<RawEvent, ByrealError>> {
  return pmGet<RawEvent>('gamma', `/events/${encodeURIComponent(eventId)}`, undefined, opts);
}

export interface PublicSearchResult {
  events?: RawEvent[];
  tags?: unknown[];
  profiles?: unknown[];
}

/** GET /gamma/public-search?q=... → { events[], tags[], profiles[] }. */
export async function publicSearch(
  params: PmQueryParams,
  opts?: PmGetOptions,
): Promise<Result<PublicSearchResult, ByrealError>> {
  return pmGet<PublicSearchResult>('gamma', '/public-search', params, opts);
}
