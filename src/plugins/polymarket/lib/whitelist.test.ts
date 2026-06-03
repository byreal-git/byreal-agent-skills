import { describe, it, expect } from 'vitest';
import {
  buildSet,
  normalizeToParentEvents,
  intersect,
  sortByVolumeDescAndLimit,
  type CategoyDataRecord,
} from './whitelist.js';

describe('buildSet', () => {
  it('collects eventIds with dataStatus===0 + enrich map', () => {
    const recs: CategoyDataRecord[] = [
      { eventId: '100', eventTitle: 'A', eventSlug: 'a', categoryId: 1, dataStatus: 0 },
      { eventId: '200', eventTitle: 'B', eventSlug: 'b', categoryId: 1, dataStatus: 1 }, // disabled
      { eventId: '300', eventTitle: 'C', eventSlug: 'c', categoryId: 2, dataStatus: 0 },
    ];
    const set = buildSet(recs);
    expect([...set.ids].sort()).toEqual(['100', '300']);
    expect(set.enrich.get('100')).toEqual({ title: 'A', slug: 'a', categoryId: 1 });
    expect(set.ids.has('200')).toBe(false);
  });

  it('dedupes the same eventId across categories', () => {
    const recs: CategoyDataRecord[] = [
      { eventId: '100', dataStatus: 0, categoryId: 1 },
      { eventId: '100', dataStatus: 0, categoryId: 2 },
    ];
    expect(buildSet(recs).ids.size).toBe(1);
  });
});

describe('normalizeToParentEvents', () => {
  it('maps gamma public-search events[] to parent event candidates', () => {
    const res = {
      events: [
        { id: '100', title: 'NBA Champion', slug: 'nba', volume: '123', liquidity: '45', endDate: '2026-07-01' },
        { id: '999', title: 'Other', slug: 'oth', volume: '5' },
      ],
    };
    const out = normalizeToParentEvents(res);
    expect(out.map((c) => c.event_id)).toEqual(['100', '999']);
    expect(out[0].title).toBe('NBA Champion');
    expect(out[0].volume).toBe('123');
  });
  it('handles missing events array', () => {
    expect(normalizeToParentEvents({})).toEqual([]);
  });
});

describe('intersect', () => {
  it('keeps ONLY whitelisted candidates (drops outside-whitelist) — the hard guarantee', () => {
    const candidates = [
      { event_id: '100', title: 'in' },
      { event_id: '999', title: 'OUT' }, // not in whitelist
      { event_id: '300', title: 'in2' },
    ];
    const set = buildSet([
      { eventId: '100', dataStatus: 0 },
      { eventId: '300', dataStatus: 0 },
    ]);
    const out = intersect(candidates, set);
    expect(out.map((c) => c.event_id)).toEqual(['100', '300']);
    expect(out.find((c) => c.event_id === '999')).toBeUndefined();
  });
});

describe('sortByVolumeDescAndLimit', () => {
  it('sorts by numeric volume desc and limits', () => {
    const c = [
      { event_id: 'a', title: 'a', volume: '10' },
      { event_id: 'b', title: 'b', volume: '100' },
      { event_id: 'c', title: 'c', volume: '50' },
    ];
    expect(sortByVolumeDescAndLimit(c, 2).map((x) => x.event_id)).toEqual(['b', 'c']);
  });
});
