/**
 * Polymarket event typing + market filtering/sorting + compact/full views.
 *
 * Rules (docs/polymarket-cli/03 §5.3):
 *   - classify: sports (gameId + sportsMarketType) → neg-risk (event.negRisk)
 *     → binary (single Yes/No).
 *   - filterTradable: drop negRiskOther / inactive / closed / archived /
 *     not-accepting / no-orderbook. (negRiskOther is the real field; the PRD's
 *     `negRiskAugmented` does not exist at market level.)
 *   - sort by YES probability (outcomePrices[0]) descending.
 *   - compact = top-N + truncation triplet (+ pin a named market); full = all.
 *   - related_markets = same negRiskMarketID, excluding self.
 *
 * Pure functions; no network. Market field names mirror Gamma.
 */

import { deriveYesNo, parseNumberArray } from './parse.js';

export interface RawMarket {
  id: string;
  question?: string;
  groupItemTitle?: string;
  outcomes?: string;
  outcomePrices?: string;
  clobTokenIds?: string;
  conditionId?: string;
  orderPriceMinTickSize?: number;
  active?: boolean;
  closed?: boolean;
  archived?: boolean;
  enableOrderBook?: boolean;
  acceptingOrders?: boolean;
  negRisk?: boolean;
  negRiskOther?: boolean;
  negRiskMarketID?: string;
  negRiskRequestID?: string | null;
  sportsMarketType?: string;
  gameId?: string;
  volume?: string | number;
  liquidity?: string | number;
}

export interface RawEvent {
  id: string;
  title?: string;
  description?: string;
  negRisk?: boolean;
  negRiskMarketID?: string;
  gameId?: string;
  endDate?: string;
  volume?: string | number;
  liquidity?: string | number;
  openInterest?: string | number;
  markets?: RawMarket[];
}

export type EventKind = 'sports' | 'neg-risk' | 'binary';

export interface RelatedMarket {
  market_id: string;
  title: string;
  market_type?: string;
}

export interface CompactMarket {
  market_id: string;
  title: string;
  question: string | null;
  market_type: string | null;
  condition_id: string | null;
  volume: string | null;
  liquidity: string | null;
  negRisk: boolean;
  negRiskMarketID: string | null;
  related_markets: RelatedMarket[];
  outcomes: string;
  outcomePrices: string;
  tick_size: number | null;
  yes_token_id: string | null;
  no_token_id: string | null;
  yes_price: number | null;
  no_price: number | null;
}

export interface MarketsView {
  market_count: number;
  markets_returned: number;
  markets_truncated: boolean;
  markets: CompactMarket[];
}

/** Sports if any market carries a sportsMarketType + gameId; else neg-risk if
 * event.negRisk; else binary. */
export function classify(event: RawEvent): EventKind {
  const ms = event.markets ?? [];
  const isSports =
    !!event.gameId ||
    ms.some((m) => !!m.sportsMarketType && !!m.gameId);
  if (isSports) return 'sports';
  if (event.negRisk === true) return 'neg-risk';
  return 'binary';
}

/** Keep only tradable, displayable markets. */
export function filterTradable(markets: RawMarket[]): RawMarket[] {
  return markets.filter(
    (m) =>
      m.active === true &&
      m.closed !== true &&
      m.archived !== true &&
      m.acceptingOrders === true &&
      m.enableOrderBook === true &&
      m.negRiskOther !== true,
  );
}

function yesProb(m: RawMarket): number {
  const prices = parseNumberArray(m.outcomePrices);
  return prices.length > 0 ? prices[0] : -1;
}

/** Sort by YES probability (outcomePrices[0]) descending; unparseable last. */
export function sortByYesProb(markets: RawMarket[]): RawMarket[] {
  return [...markets].sort((a, b) => yesProb(b) - yesProb(a));
}

function toStr(v: string | number | undefined): string | null {
  if (v === undefined || v === null) return null;
  return String(v);
}

function toCompact(m: RawMarket, related: RelatedMarket[]): CompactMarket {
  const yn = deriveYesNo(m);
  return {
    market_id: m.id,
    title: m.groupItemTitle || m.question || m.id,
    question: m.question ?? null,
    market_type: m.sportsMarketType ?? null,
    condition_id: m.conditionId ?? null,
    volume: toStr(m.volume),
    liquidity: toStr(m.liquidity),
    negRisk: m.negRisk === true,
    negRiskMarketID: m.negRiskMarketID ?? null,
    related_markets: related,
    outcomes: m.outcomes ?? '[]',
    outcomePrices: m.outcomePrices ?? '[]',
    tick_size: m.orderPriceMinTickSize ?? null,
    yes_token_id: yn.yesTokenId,
    no_token_id: yn.noTokenId,
    yes_price: yn.yesPrice,
    no_price: yn.noPrice,
  };
}

/**
 * Compact view: filter tradable → sort by YES prob → take top-N. If
 * `pinnedMarketId` names a tradable market outside top-N, append it (pin).
 */
export function buildCompact(
  event: RawEvent,
  markets: RawMarket[],
  topN: number,
  pinnedMarketId?: string,
): MarketsView {
  const tradable = sortByYesProb(filterTradable(markets));
  const marketCount = tradable.length;

  const top = tradable.slice(0, topN);
  if (pinnedMarketId) {
    const already = top.some((m) => m.id === pinnedMarketId);
    if (!already) {
      const pinned = tradable.find((m) => m.id === pinnedMarketId);
      if (pinned) top.push(pinned);
    }
  }

  return {
    market_count: marketCount,
    markets_returned: top.length,
    markets_truncated: marketCount > top.length,
    markets: top.map((m) => toCompact(m, [])),
  };
}

/** Full view: all tradable markets sorted by YES prob, no truncation. */
export function buildFull(event: RawEvent, markets: RawMarket[]): MarketsView {
  const tradable = sortByYesProb(filterTradable(markets));
  return {
    market_count: tradable.length,
    markets_returned: tradable.length,
    markets_truncated: false,
    markets: tradable.map((m) => toCompact(m, [])),
  };
}

/** Same-group markets (matching negRiskMarketID), excluding self. */
export function relatedMarkets(
  markets: RawMarket[],
  negRiskMarketID: string,
  selfMarketId: string,
): RelatedMarket[] {
  return markets
    .filter((m) => m.negRiskMarketID === negRiskMarketID && m.id !== selfMarketId)
    .map((m) => {
      const r: RelatedMarket = { market_id: m.id, title: m.groupItemTitle || m.question || m.id };
      if (m.sportsMarketType) r.market_type = m.sportsMarketType;
      return r;
    });
}
