/**
 * Pure transforms for event.list and event.detail (PRD §3.2 / §3.3 shapes).
 * Discovery/whitelist guards + neg-risk processing live here; the command
 * layer only wires network + printing.
 */

import {
  buildCompact,
  buildFull,
  relatedMarkets,
  classify,
  type RawEvent,
  type RawMarket,
  type MarketsView,
} from './neg-risk.js';

function str(v: string | number | undefined | null): string | null {
  return v === undefined || v === null ? null : String(v);
}

// ---- event.list --------------------------------------------------------

export interface EventListItem {
  event_id: string;
  title: string;
  description: string | null;
  endDate: string | null;
  volume: string | null;
  liquidity: string | null;
  openInterest: string | null;
}

function eventVolume(e: RawEvent): number {
  const n = Number(e.volume ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** Map whitelist-trimmed pmdata records to PRD events[], volume_desc, limited. */
export function buildEventList(
  records: RawEvent[],
  limit: number,
): { sort: 'volume_desc'; events: EventListItem[] } {
  const events = [...records]
    .sort((a, b) => eventVolume(b) - eventVolume(a))
    .slice(0, limit)
    .map((e) => ({
      event_id: String(e.id),
      title: e.title ?? '',
      description: str(e.description),
      endDate: str(e.endDate),
      volume: str(e.volume),
      liquidity: str(e.liquidity),
      openInterest: str(e.openInterest),
    }));
  return { sort: 'volume_desc', events };
}

// ---- event.detail ------------------------------------------------------

export interface EventDetail {
  detail_level: 'compact' | 'full';
  market_detail_level: 'compact' | 'full';
  event: {
    event_id: string;
    title: string;
    description: string | null;
    endDate: string | null;
    liquidity: string | null;
    volume: string | null;
    openInterest: string | null;
    negRisk: boolean;
    kind: 'sports' | 'neg-risk' | 'binary';
  };
  market_count: number;
  markets_returned: number;
  markets_truncated: boolean;
  markets: MarketsView['markets'];
}

export interface EventDetailOptions {
  marketId?: string;
  full?: boolean;
  compactN: number;
}

/**
 * Build event.detail. With `marketId`, expand just that market and populate its
 * related_markets (same negRiskMarketID). Otherwise compact top-N or full.
 */
export function buildEventDetail(event: RawEvent, opts: EventDetailOptions): EventDetail {
  const allMarkets = event.markets ?? [];
  const kind = classify(event);

  const header = (view: MarketsView, level: 'compact' | 'full'): EventDetail => ({
    detail_level: level,
    market_detail_level: level,
    event: {
      event_id: String(event.id),
      title: event.title ?? '',
      description: str(event.description),
      endDate: str(event.endDate),
      liquidity: str(event.liquidity),
      volume: str(event.volume),
      openInterest: str(event.openInterest),
      negRisk: event.negRisk === true,
      kind,
    },
    market_count: view.market_count,
    markets_returned: view.markets_returned,
    markets_truncated: view.markets_truncated,
    markets: view.markets,
  });

  // Single-market expand → related_markets populated.
  if (opts.marketId) {
    const single = buildSingleMarket(event, allMarkets, opts.marketId);
    return header(single, 'full');
  }

  if (opts.full) return header(buildFull(event, allMarkets), 'full');
  return header(buildCompact(event, allMarkets, opts.compactN), 'compact');
}

function buildSingleMarket(event: RawEvent, allMarkets: RawMarket[], marketId: string): MarketsView {
  const view = buildFull(event, allMarkets);
  const picked = view.markets.filter((m) => m.market_id === marketId);
  if (picked.length === 0) {
    return { market_count: view.market_count, markets_returned: 0, markets_truncated: false, markets: [] };
  }
  // Group by the SELECTED market's negRiskMarketID (the precise source), falling
  // back to the event-level group. Using the event level alone mis-groups when
  // an event holds more than one neg-risk group, or when Gamma only populates
  // the market-level id — see docs/03 §5.3 "同 negRiskMarketID 其他候选".
  const selected = allMarkets.find((m) => m.id === marketId);
  const group = selected?.negRiskMarketID ?? event.negRiskMarketID;
  const withRelated = picked.map((m) => ({
    ...m,
    related_markets: group ? relatedMarkets(allMarkets, group, marketId) : [],
  }));
  return {
    market_count: view.market_count,
    markets_returned: withRelated.length,
    markets_truncated: false,
    markets: withRelated,
  };
}
