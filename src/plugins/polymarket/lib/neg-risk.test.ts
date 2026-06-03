import { describe, it, expect } from 'vitest';
import {
  classify,
  filterTradable,
  sortByYesProb,
  buildCompact,
  buildFull,
  relatedMarkets,
  type RawMarket,
  type RawEvent,
} from './neg-risk.js';

// ---- synthetic markets -------------------------------------------------
function mkt(over: Partial<RawMarket>): RawMarket {
  return {
    id: 'm',
    question: 'Q',
    groupItemTitle: 'Team',
    outcomes: '["Yes","No"]',
    outcomePrices: '["0.5","0.5"]',
    clobTokenIds: '["yes","no"]',
    orderPriceMinTickSize: 0.01,
    active: true,
    closed: false,
    archived: false,
    enableOrderBook: true,
    acceptingOrders: true,
    negRisk: true,
    negRiskOther: false,
    negRiskMarketID: '0xGROUP',
    ...over,
  };
}

describe('classify', () => {
  it('sports when a market has sportsMarketType + gameId', () => {
    const ev: RawEvent = { id: '1', markets: [mkt({ sportsMarketType: 'moneyline', gameId: 'g1', negRisk: false })] };
    expect(classify(ev)).toBe('sports');
  });
  it('neg-risk when event.negRisk is true', () => {
    expect(classify({ id: '1', negRisk: true, markets: [mkt({})] })).toBe('neg-risk');
  });
  it('binary otherwise', () => {
    expect(classify({ id: '1', negRisk: false, markets: [mkt({ negRisk: false })] })).toBe('binary');
  });
});

describe('filterTradable', () => {
  it('drops negRiskOther / inactive / closed / archived / not-accepting / no-orderbook', () => {
    const markets = [
      mkt({ id: 'ok' }),
      mkt({ id: 'other', negRiskOther: true }),
      mkt({ id: 'inactive', active: false }),
      mkt({ id: 'closed', closed: true }),
      mkt({ id: 'archived', archived: true }),
      mkt({ id: 'notaccept', acceptingOrders: false }),
      mkt({ id: 'nobook', enableOrderBook: false }),
    ];
    expect(filterTradable(markets).map((m) => m.id)).toEqual(['ok']);
  });
});

describe('sortByYesProb', () => {
  it('orders by parsed YES price (outcomePrices[0]) descending', () => {
    const a = mkt({ id: 'a', outcomePrices: '["0.35","0.65"]' });
    const b = mkt({ id: 'b', outcomePrices: '["0.65","0.35"]' });
    const c = mkt({ id: 'c', outcomePrices: '["0.10","0.90"]' });
    expect(sortByYesProb([a, b, c]).map((m) => m.id)).toEqual(['b', 'a', 'c']);
  });
  it('puts unparseable YES price last', () => {
    const a = mkt({ id: 'a', outcomePrices: '["0.5","0.5"]' });
    const bad = mkt({ id: 'bad', outcomePrices: 'oops' });
    expect(sortByYesProb([bad, a]).map((m) => m.id)).toEqual(['a', 'bad']);
  });
});

describe('buildCompact', () => {
  const ev: RawEvent = { id: '27830', title: '2026 NBA Champion', negRisk: true, negRiskMarketID: '0xGROUP' };
  // 6 tradable with descending yes prices p=.9..,.4 plus 1 closed (filtered)
  const tradable = [0.9, 0.8, 0.7, 0.6, 0.5, 0.4].map((p, i) =>
    mkt({ id: `t${i}`, groupItemTitle: `Team${i}`, outcomePrices: `["${p}","${1 - p}"]` }),
  );
  const closed = mkt({ id: 'closed', closed: true });

  it('returns top-N sorted with truncation triplet', () => {
    const r = buildCompact(ev, [...tradable, closed], 5);
    expect(r.market_count).toBe(6); // tradable total (closed filtered)
    expect(r.markets_returned).toBe(5);
    expect(r.markets_truncated).toBe(true);
    expect(r.markets.map((m) => m.market_id)).toEqual(['t0', 't1', 't2', 't3', 't4']);
    expect(r.markets[0].title).toBe('Team0');
    expect(r.markets[0].tick_size).toBe(0.01);
    expect(r.markets[0].yes_price).toBe(0.9);
    expect(r.markets[0].yes_token_id).toBe('yes');
  });

  it('pins a named market that is outside top-N', () => {
    const r = buildCompact(ev, [...tradable, closed], 5, 't5'); // t5 has lowest prob
    expect(r.markets.map((m) => m.market_id)).toContain('t5');
    expect(r.markets_returned).toBe(6); // 5 + pinned
  });

  it('not truncated when count <= N', () => {
    const r = buildCompact(ev, tradable.slice(0, 3), 5);
    expect(r.market_count).toBe(3);
    expect(r.markets_truncated).toBe(false);
  });
});

describe('buildFull', () => {
  it('returns all tradable markets sorted, no truncation', () => {
    const ev: RawEvent = { id: '1', negRisk: true };
    const ms = [0.3, 0.9, 0.6].map((p, i) => mkt({ id: `m${i}`, outcomePrices: `["${p}","${1 - p}"]` }));
    const r = buildFull(ev, [...ms, mkt({ id: 'closed', closed: true })]);
    expect(r.markets_returned).toBe(3);
    expect(r.markets_truncated).toBe(false);
    expect(r.markets.map((m) => m.market_id)).toEqual(['m1', 'm2', 'm0']);
  });
});

describe('relatedMarkets', () => {
  it('returns same-group markets excluding self', () => {
    const ms = [
      mkt({ id: 'a', groupItemTitle: 'A', negRiskMarketID: '0xG' }),
      mkt({ id: 'b', groupItemTitle: 'B', negRiskMarketID: '0xG' }),
      mkt({ id: 'c', groupItemTitle: 'C', negRiskMarketID: '0xOTHER' }),
    ];
    const r = relatedMarkets(ms, '0xG', 'a');
    expect(r).toEqual([{ market_id: 'b', title: 'B' }]);
  });
});
