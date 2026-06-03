import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  isCacheFresh,
  flattenCategoryIds,
  serializeSet,
  deserializeSet,
} from './whitelist-cache.js';
import { buildSet } from './whitelist.js';
import type { CategoryNode } from '../api/categoy.js';

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
