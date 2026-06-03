import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildEventList } from './event-view.js';
import { buildEventDetail } from './event-view.js';
import { buildCategoryList } from './category-view.js';
import type { RawEvent } from './neg-risk.js';

const FX = path.join(__dirname, '..', '__fixtures__');
function load(name: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(FX, name), 'utf-8'));
}

describe('buildEventList (real pmdata fixture)', () => {
  it('maps records to PRD events[], volume_desc, limited', () => {
    const pmdata = load('pmdata-nba.json') as { data: { records: RawEvent[] } };
    const out = buildEventList(pmdata.data.records, 10);
    expect(out.sort).toBe('volume_desc');
    expect(out.events.length).toBeGreaterThan(0);
    // volume descending
    const vols = out.events.map((e) => Number(e.volume ?? 0));
    for (let i = 1; i < vols.length; i++) expect(vols[i - 1]).toBeGreaterThanOrEqual(vols[i]);
    // shape
    expect(out.events[0]).toHaveProperty('event_id');
    expect(out.events[0]).toHaveProperty('title');
  });

  it('respects the limit', () => {
    const pmdata = load('pmdata-nba.json') as { data: { records: RawEvent[] } };
    expect(buildEventList(pmdata.data.records, 1).events).toHaveLength(1);
  });
});

describe('buildEventDetail (real neg-risk event 27830)', () => {
  const event = load('gamma-event-27830.json') as RawEvent;

  it('compact: filters to tradable, sorts by YES prob desc, truncation triplet', () => {
    const d = buildEventDetail(event, { compactN: 5 });
    expect(d.detail_level).toBe('compact');
    expect(d.event.negRisk).toBe(true);
    expect(d.event.kind).toBe('neg-risk');
    // fixture has exactly 2 tradable markets (Spurs 0.6485, Knicks 0.3545)
    expect(d.market_count).toBe(2);
    expect(d.markets_returned).toBe(2);
    expect(d.markets_truncated).toBe(false);
    // sorted by YES probability desc
    const yes = d.markets.map((m) => m.yes_price ?? -1);
    expect(yes[0]).toBeGreaterThanOrEqual(yes[1]);
    expect(d.markets[0].title).toBe('San Antonio Spurs');
    expect(d.markets[0].tick_size).toBe(0.001);
    expect(d.markets[0].yes_token_id).toBeTruthy();
  });

  it('single-market expand populates related_markets (same neg-risk group)', () => {
    const spurs = (event.markets ?? []).find((m) => m.groupItemTitle === 'San Antonio Spurs')!;
    const d = buildEventDetail(event, { marketId: spurs.id, compactN: 5 });
    expect(d.markets_returned).toBe(1);
    expect(d.markets[0].market_id).toBe(spurs.id);
    // related = other tradable-or-not markets sharing negRiskMarketID, excluding self
    expect(d.markets[0].related_markets.length).toBeGreaterThan(0);
    expect(d.markets[0].related_markets.find((r) => r.market_id === spurs.id)).toBeUndefined();
  });

  it('full returns all tradable markets', () => {
    const d = buildEventDetail(event, { full: true, compactN: 5 });
    expect(d.detail_level).toBe('full');
    expect(d.markets_returned).toBe(2);
    expect(d.markets_truncated).toBe(false);
  });
});

describe('buildCategoryList (real tree fixture)', () => {
  it('maps the category tree to PRD category list', () => {
    const tree = load('categoy-tree.json') as { data: Parameters<typeof buildCategoryList>[0] };
    const out = buildCategoryList(tree.data);
    expect(out.categories.length).toBeGreaterThan(0);
    expect(out.categories[0]).toHaveProperty('category_id');
    expect(out.categories[0]).toHaveProperty('display_name');
    expect(Array.isArray(out.categories[0].market_types)).toBe(true);
  });
});
