/**
 * Whitelist set caching + gateway construction.
 *
 * The whitelist Set is built by enumerating categories (/categoy/tree) and
 * paging each category's /categoy/data for dataStatus===0 eventIds. It is
 * cached to ~/.openclaw/pm-whitelist.json (TTL pm.whitelistCacheTtlSeconds,
 * default 600s) to amortize the N gateway calls across consecutive searches.
 *
 * Pure helpers (isCacheFresh / flattenCategoryIds / serialize / deserialize)
 * are unit-tested; the gateway build + file I/O are exercised by live-smoke.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { expandTilde } from '../../../auth/security.js';
import { ok } from '../../../core/types.js';
import type { Result } from '../../../core/types.js';
import type { ByrealError } from '../../../core/errors.js';
import { getCategoryTree, getCategoyData, type CategoryNode } from '../api/categoy.js';
import type { PmGetOptions } from '../api/gateway.js';
import { buildSet, type WhitelistSet, type CategoyDataRecord } from './whitelist.js';

const CACHE_PATH = '~/.openclaw/pm-whitelist.json';

interface CacheFile {
  builtAtMs: number;
  ids: string[];
  enrich: Record<string, { title?: string; slug?: string; categoryId?: number }>;
}

// ---- pure helpers ------------------------------------------------------

export function isCacheFresh(builtAtMs: number, nowMs: number, ttlSec: number): boolean {
  return nowMs - builtAtMs < ttlSec * 1000;
}

/** Recursively collect every category id in the tree (incl. children). */
export function flattenCategoryIds(tree: CategoryNode[]): number[] {
  const ids: number[] = [];
  const walk = (nodes: CategoryNode[]): void => {
    for (const n of nodes) {
      ids.push(n.id);
      if (n.children && n.children.length) walk(n.children);
    }
  };
  walk(tree);
  return ids;
}

export function serializeSet(set: WhitelistSet, nowMs: number): string {
  const enrich: CacheFile['enrich'] = {};
  for (const [k, v] of set.enrich) enrich[k] = v;
  const file: CacheFile = { builtAtMs: nowMs, ids: [...set.ids], enrich };
  return JSON.stringify(file);
}

export function deserializeSet(json: string): { set: WhitelistSet; builtAtMs: number } | null {
  try {
    const file = JSON.parse(json) as CacheFile;
    if (!Array.isArray(file.ids) || typeof file.builtAtMs !== 'number') return null;
    const enrich = new Map<string, { title?: string; slug?: string; categoryId?: number }>();
    for (const [k, v] of Object.entries(file.enrich ?? {})) enrich.set(k, v);
    return { set: { ids: new Set(file.ids), enrich }, builtAtMs: file.builtAtMs };
  } catch {
    return null;
  }
}

// ---- cache I/O ---------------------------------------------------------

function cacheFile(): string {
  return expandTilde(CACHE_PATH);
}

function readCache(nowMs: number, ttlSec: number): WhitelistSet | null {
  try {
    const p = cacheFile();
    if (!fs.existsSync(p)) return null;
    const parsed = deserializeSet(fs.readFileSync(p, 'utf-8'));
    if (!parsed) return null;
    if (!isCacheFresh(parsed.builtAtMs, nowMs, ttlSec)) return null;
    return parsed.set;
  } catch {
    return null;
  }
}

/**
 * Read the cached whitelist Set WITHOUT building it (returns null on miss/stale).
 * Used by event.detail for an opportunistic membership guard: enforce only when
 * the cache is warm (built by a prior list/search), never trigger a multi-call
 * build just to validate one detail lookup.
 */
export function peekWhitelistCache(nowMs: number, ttlSec: number): WhitelistSet | null {
  return readCache(nowMs, ttlSec);
}

function writeCache(set: WhitelistSet, nowMs: number): void {
  try {
    const p = cacheFile();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, serializeSet(set, nowMs), 'utf-8');
  } catch {
    // best-effort; a failed cache write just means we rebuild next time
  }
}

// ---- gateway build -----------------------------------------------------

/** Build the whitelist Set from the gateway (tree → per-category data pages). */
export async function buildWhitelistFromGateway(
  opts?: PmGetOptions,
): Promise<Result<WhitelistSet, ByrealError>> {
  const treeR = await getCategoryTree(opts);
  if (!treeR.ok) return treeR;
  const categoryIds = flattenCategoryIds(treeR.value);

  const records: CategoyDataRecord[] = [];
  for (const categoryId of categoryIds) {
    let page = 1;
    // bound pages defensively (whitelist is low-thousands total)
    for (; page <= 50; page++) {
      const r = await getCategoyData(categoryId, page, 100, opts);
      if (!r.ok) break; // skip a failing category rather than abort the whole set
      const recs = r.value.records ?? [];
      records.push(...recs);
      const pages = r.value.pages ?? 1;
      if (page >= pages || recs.length === 0) break;
    }
  }
  return ok(buildSet(records));
}

export interface GetWhitelistOptions {
  nowMs: number;
  ttlSec: number;
  forceRefresh?: boolean;
  gateway?: PmGetOptions;
}

/** Get the whitelist Set, using the on-disk cache when fresh. */
export async function getWhitelistSet(
  opts: GetWhitelistOptions,
): Promise<Result<WhitelistSet, ByrealError>> {
  if (!opts.forceRefresh) {
    const cached = readCache(opts.nowMs, opts.ttlSec);
    if (cached) return ok(cached);
  }
  const built = await buildWhitelistFromGateway(opts.gateway);
  if (!built.ok) return built;
  writeCache(built.value, opts.nowMs);
  return ok(built.value);
}
