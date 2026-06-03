/**
 * Byreal /categoy/* business endpoints (note: backend typo "categoy").
 *   /categoy/tree   → category tree
 *   /categoy/pmdata → whitelist ∩ live Gamma events for a category
 *   /categoy/data   → whitelist records (eventId + dataStatus) for a category
 */

import type { Result } from '../../../core/types.js';
import type { ByrealError } from '../../../core/errors.js';
import { pmGet, type PmGetOptions } from './gateway.js';
import { unwrapBusiness, type PmEnvelope } from './envelope.js';
import type { RawEvent } from '../lib/neg-risk.js';
import type { CategoyDataRecord } from '../lib/whitelist.js';

export interface MarketType {
  id: number;
  marketType: string;
  memo?: string;
  sortOrder?: number;
}

export interface CategoryNode {
  id: number;
  parentId: number;
  categoryName: string;
  categoryType?: string;
  hasDraw?: number;
  sortOrder?: number;
  children?: CategoryNode[];
  marketTypes?: MarketType[];
}

export interface PageResult<T> {
  total: number;
  pageNum?: number;
  pageSize?: number;
  records: T[];
  current?: number;
  pages?: number;
}

export async function getCategoryTree(
  opts?: PmGetOptions,
): Promise<Result<CategoryNode[], ByrealError>> {
  const r = await pmGet<PmEnvelope<CategoryNode[]>>('v1', '/categoy/tree', undefined, opts);
  if (!r.ok) return r;
  return unwrapBusiness(r.value);
}

export async function getPmData(
  categoryId: number | string,
  page = 1,
  pageSize = 50,
  opts?: PmGetOptions,
): Promise<Result<PageResult<RawEvent>, ByrealError>> {
  const r = await pmGet<PmEnvelope<PageResult<RawEvent>>>(
    'v1',
    '/categoy/pmdata',
    { categoryId, page, pageSize },
    opts,
  );
  if (!r.ok) return r;
  return unwrapBusiness(r.value);
}

export async function getCategoyData(
  categoryId: number | string,
  page = 1,
  pageSize = 100,
  opts?: PmGetOptions,
): Promise<Result<PageResult<CategoyDataRecord>, ByrealError>> {
  const r = await pmGet<PmEnvelope<PageResult<CategoyDataRecord>>>(
    'v1',
    '/categoy/data',
    { categoryId, page, pageSize },
    opts,
  );
  if (!r.ok) return r;
  return unwrapBusiness(r.value);
}
