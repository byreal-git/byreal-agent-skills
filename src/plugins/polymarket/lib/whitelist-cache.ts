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

/** Result of a whitelist build: the set + whether EVERY category fetched OK.
 * An incomplete build (a category failed after retries) must NOT be cached —
 * otherwise a transient blip poisons search with a partial whitelist for the
 * whole TTL, making genuinely-whitelisted events silently vanish. */
export interface WhitelistBuildResult {
  set: WhitelistSet;
  complete: boolean;
}

/** Injectable gateway calls (so the build is unit-testable without network). */
export interface WhitelistGatewayDeps {
  getCategoryTree: typeof getCategoryTree;
  getCategoyData: typeof getCategoyData;
}

const realDeps: WhitelistGatewayDeps = { getCategoryTree, getCategoyData };

const PAGE_RETRIES = 2;

async function fetchPageWithRetry(
  deps: WhitelistGatewayDeps,
  categoryId: number,
  page: number,
  opts?: PmGetOptions,
): Promise<Awaited<ReturnType<typeof getCategoyData>>> {
  let last = await deps.getCategoyData(categoryId, page, 100, opts);
  for (let i = 0; i < PAGE_RETRIES && !last.ok; i++) {
    last = await deps.getCategoyData(categoryId, page, 100, opts);
  }
  return last;
}

/**
 * Build the whitelist Set from the gateway (tree → per-category data pages).
 * Best-effort: a category that still fails after retries is skipped but flips
 * `complete` to false so the caller can avoid caching / claiming NO_MATCH.
 */
export async function buildWhitelistFromGateway(
  opts?: PmGetOptions,
  deps: WhitelistGatewayDeps = realDeps,
): Promise<Result<WhitelistBuildResult, ByrealError>> {
  const treeR = await deps.getCategoryTree(opts);
  if (!treeR.ok) return treeR;
  const categoryIds = flattenCategoryIds(treeR.value);

  const records: CategoyDataRecord[] = [];
  let complete = true;
  for (const categoryId of categoryIds) {
    // bound pages defensively (whitelist is low-thousands total)
    for (let page = 1; page <= 50; page++) {
      const r = await fetchPageWithRetry(deps, categoryId, page, opts);
      if (!r.ok) {
        // This category could not be fully fetched — mark the build partial and
        // move on (keep events already collected from other categories).
        complete = false;
        break;
      }
      const recs = r.value.records ?? [];
      records.push(...recs);
      const pages = r.value.pages ?? 1;
      if (page >= pages || recs.length === 0) break;
    }
  }
  return ok({ set: buildSet(records), complete });
}

export interface GetWhitelistOptions {
  nowMs: number;
  ttlSec: number;
  forceRefresh?: boolean;
  gateway?: PmGetOptions;
  /** Test seam: inject the gateway calls. */
  deps?: WhitelistGatewayDeps;
}

export interface ResolvedWhitelist {
  set: WhitelistSet;
  /** True when the set is known-complete (fresh cache, or a complete build). */
  complete: boolean;
  fromCache: boolean;
}

/**
 * Get the whitelist Set, using the on-disk cache when fresh. Only a COMPLETE
 * build is cached; an incomplete build is returned best-effort for this call
 * but not persisted (next call retries). Cached sets are treated as complete
 * (we never cache partials).
 */
export async function getWhitelistSet(
  opts: GetWhitelistOptions,
): Promise<Result<ResolvedWhitelist, ByrealError>> {
  if (!opts.forceRefresh) {
    const cached = readCache(opts.nowMs, opts.ttlSec);
    if (cached) return ok({ set: cached, complete: true, fromCache: true });
  }
  const built = await buildWhitelistFromGateway(opts.gateway, opts.deps);
  if (!built.ok) return built;
  if (built.value.complete) writeCache(built.value.set, opts.nowMs);
  return ok({ set: built.value.set, complete: built.value.complete, fromCache: false });
}
