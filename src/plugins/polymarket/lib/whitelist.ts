/**
 * Byreal whitelist set + Gamma public-search normalization + intersection.
 *
 * The Byreal whitelist has no flat "all event ids" endpoint; it is the set of
 * `eventId`s with `dataStatus===0` from /categoy/data across categories
 * (docs/polymarket-cli/05 §5.1). `intersect` is the hard guarantee that
 * event.search never returns events outside the whitelist.
 *
 * Pure functions; the caching + gateway calls live in whitelist-cache.ts and
 * the command layer.
 */

export interface CategoyDataRecord {
  eventId: string;
  eventSlug?: string;
  eventTitle?: string;
  categoryId?: number;
  env?: number;
  dataStatus: number;
}

export interface WhitelistSet {
  ids: Set<string>;
  enrich: Map<string, { title?: string; slug?: string; categoryId?: number }>;
}

export interface EventCandidate {
  event_id: string;
  title: string;
  slug?: string;
  description?: string;
  volume?: string;
  liquidity?: string;
  openInterest?: string;
  endDate?: string;
}

/** Build the whitelist Set + enrich map from /categoy/data records (dataStatus===0). */
export function buildSet(records: CategoyDataRecord[]): WhitelistSet {
  const ids = new Set<string>();
  const enrich = new Map<string, { title?: string; slug?: string; categoryId?: number }>();
  for (const r of records) {
    if (r.dataStatus !== 0) continue;
    if (!r.eventId) continue;
    ids.add(r.eventId);
    if (!enrich.has(r.eventId)) {
      enrich.set(r.eventId, { title: r.eventTitle, slug: r.eventSlug, categoryId: r.categoryId });
    }
  }
  return { ids, enrich };
}

interface GammaSearchEvent {
  id: string;
  title?: string;
  slug?: string;
  description?: string;
  volume?: string | number;
  liquidity?: string | number;
  openInterest?: string | number;
  endDate?: string;
}

/** Map Gamma public-search `events[]` to parent event candidates. */
export function normalizeToParentEvents(res: { events?: GammaSearchEvent[] }): EventCandidate[] {
  const events = Array.isArray(res.events) ? res.events : [];
  const str = (v: string | number | undefined): string | undefined =>
    v === undefined || v === null ? undefined : String(v);
  return events.map((e) => ({
    event_id: String(e.id),
    title: e.title ?? '',
    slug: e.slug,
    description: e.description,
    volume: str(e.volume),
    liquidity: str(e.liquidity),
    openInterest: str(e.openInterest),
    endDate: e.endDate,
  }));
}

/** Keep ONLY candidates whose event_id is in the whitelist set. */
export function intersect(candidates: EventCandidate[], set: WhitelistSet): EventCandidate[] {
  return candidates.filter((c) => set.ids.has(c.event_id));
}

/** Sort candidates by numeric volume descending and take the first `limit`. */
export function sortByVolumeDescAndLimit(
  candidates: EventCandidate[],
  limit: number,
): EventCandidate[] {
  const vol = (c: EventCandidate): number => {
    const n = Number(c.volume ?? '0');
    return Number.isFinite(n) ? n : 0;
  };
  return [...candidates].sort((a, b) => vol(b) - vol(a)).slice(0, limit);
}

/**
 * Full search composition: normalize public-search → intersect whitelist
 * (the hard "never outside whitelist" guard) → volume_desc → limit.
 */
export function buildSearchCandidates(
  publicSearchRes: { events?: unknown[] },
  whitelist: WhitelistSet,
  limit: number,
): EventCandidate[] {
  const normalized = normalizeToParentEvents(publicSearchRes as { events?: never[] });
  const whitelisted = intersect(normalized, whitelist);
  return sortByVolumeDescAndLimit(whitelisted, limit);
}
