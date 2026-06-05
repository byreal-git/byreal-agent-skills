import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  isCacheFresh,
  flattenCategoryIds,
  serializeSet,
  deserializeSet,
  buildWhitelistFromGateway,
  type WhitelistGatewayDeps,
} from './whitelist-cache.js';
import { buildSet } from './whitelist.js';
import { ok, err } from '../../../core/types.js';
import { sourceUnavailableError } from '../../../core/errors.js';
import type { CategoryNode, PageResult } from '../api/categoy.js';
import type { CategoyDataRecord } from './whitelist.js';

describe('isCacheFresh', () => {
  it('fresh within TTL, stale past it (injected clock)', () => {
    const built = 1_000_000;
    expect(isCacheFresh(built, built + 599_000, 600)).toBe(true);
    expect(isCacheFresh(built, built + 601_000, 600)).toBe(false);
    expect(isCacheFresh(built, built, 600)).toBe(true);
  });
});

describe('flattenCategoryIds', () => {
  it('collects ids recursively', () => {
    const tree: CategoryNode[] = [
      { id: 1, parentId: 0, categoryName: 'NBA' },
      { id: 6, parentId: 0, categoryName: 'WC', children: [{ id: 60, parentId: 6, categoryName: 'WC-A' }] },
    ];
    expect(flattenCategoryIds(tree).sort()).toEqual([1, 6, 60]);
  });

  it('uses the real category tree fixture', () => {
    const tree = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', '__fixtures__', 'categoy-tree.json'), 'utf-8'),
    ) as { data: CategoryNode[] };
    const ids = flattenCategoryIds(tree.data);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids).toContain(1); // NBA
  });
});

describe('serialize/deserialize round-trip', () => {
  it('preserves ids + enrich + builtAt', () => {
    const set = buildSet([
      { eventId: '100', eventTitle: 'A', eventSlug: 'a', categoryId: 1, dataStatus: 0 },
      { eventId: '300', dataStatus: 0, categoryId: 2 },
    ]);
    const json = serializeSet(set, 12345);
    const back = deserializeSet(json)!;
    expect(back.builtAtMs).toBe(12345);
    expect([...back.set.ids].sort()).toEqual(['100', '300']);
    expect(back.set.enrich.get('100')).toEqual({ title: 'A', slug: 'a', categoryId: 1 });
  });

  it('deserialize returns null on garbage', () => {
    expect(deserializeSet('not json')).toBeNull();
    expect(deserializeSet('{"ids":"x"}')).toBeNull();
  });
});

describe('buildWhitelistFromGateway completeness (injected gateway)', () => {
  const tree: CategoryNode[] = [
    { id: 1, parentId: 0, categoryName: 'NBA' },
    { id: 2, parentId: 0, categoryName: 'EPL' },
  ];
  const page = (records: CategoyDataRecord[]): PageResult<CategoyDataRecord> => ({
    total: records.length, pageNum: 1, pageSize: 100, records, pages: 1,
  });
  const recOf = (eventId: string): CategoyDataRecord => ({ eventId, dataStatus: 0, categoryId: 1 });

  it('all categories OK → complete=true, full union', async () => {
    const deps: WhitelistGatewayDeps = {
      getCategoryTree: async () => ok(tree),
      getCategoyData: async (categoryId) =>
        ok(page([recOf(categoryId === 1 ? 'nba1' : 'epl1')])),
    };
    const r = await buildWhitelistFromGateway(undefined, deps);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.complete).toBe(true);
    expect([...r.value.set.ids].sort()).toEqual(['epl1', 'nba1']);
  });

  it('one category fails after retries → complete=false, partial set (other category kept)', async () => {
    const deps: WhitelistGatewayDeps = {
      getCategoryTree: async () => ok(tree),
      getCategoyData: async (categoryId) =>
        categoryId === 1 ? ok(page([recOf('nba1')])) : err(sourceUnavailableError('boom')),
    };
    const r = await buildWhitelistFromGateway(undefined, deps);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.complete).toBe(false); // ← the fix: incomplete is signaled
    expect(r.value.set.ids.has('nba1')).toBe(true); // best-effort: kept what worked
    expect(r.value.set.ids.has('epl1')).toBe(false);
  });

  it('a category that fails once then succeeds is retried → complete=true', async () => {
    let nbaCalls = 0;
    const deps: WhitelistGatewayDeps = {
      getCategoryTree: async () => ok(tree),
      getCategoyData: async (categoryId) => {
        if (categoryId === 1) {
          nbaCalls++;
          return nbaCalls === 1 ? err(sourceUnavailableError('blip')) : ok(page([recOf('nba1')]));
        }
        return ok(page([recOf('epl1')]));
      },
    };
    const r = await buildWhitelistFromGateway(undefined, deps);
    expect(r.ok && r.value.complete).toBe(true);
    expect(r.ok && r.value.set.ids.has('nba1')).toBe(true);
    expect(nbaCalls).toBeGreaterThanOrEqual(2); // retried
  });
});
