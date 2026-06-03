/**
 * CLOB passthrough (raw Polymarket JSON) via the gateway /clob route.
 * Phase A uses only public reads: /book, /price, /markets/{conditionId}.
 */

import type { Result } from '../../../core/types.js';
import type { ByrealError } from '../../../core/errors.js';
import { pmGet, type PmGetOptions } from './gateway.js';

export interface BookLevel {
  price: string;
  size: string;
}

export interface OrderBook {
  market?: string;
  asset_id?: string;
  bids?: BookLevel[];
  asks?: BookLevel[];
  timestamp?: string;
}

export interface ClobToken {
  token_id: string;
  outcome: string;
  price?: number;
}

export interface ClobMarket {
  condition_id?: string;
  tokens?: ClobToken[];
  minimum_tick_size?: number | string;
  neg_risk?: boolean;
  accepting_orders?: boolean;
  active?: boolean;
  closed?: boolean;
}

/** GET /clob/book?token_id=... → order book for one outcome token. */
export async function getBook(
  tokenId: string,
  opts?: PmGetOptions,
): Promise<Result<OrderBook, ByrealError>> {
  return pmGet<OrderBook>('clob', '/book', { token_id: tokenId }, opts);
}

/** GET /clob/markets/{conditionId} → market meta (tick size, neg_risk, tokens). */
export async function getMarket(
  conditionId: string,
  opts?: PmGetOptions,
): Promise<Result<ClobMarket, ByrealError>> {
  return pmGet<ClobMarket>('clob', `/markets/${encodeURIComponent(conditionId)}`, undefined, opts);
}

/** GET /clob/price?token_id=&side= → best price. */
export async function getPrice(
  tokenId: string,
  side: 'buy' | 'sell',
  opts?: PmGetOptions,
): Promise<Result<{ price?: string }, ByrealError>> {
  return pmGet<{ price?: string }>('clob', '/price', { token_id: tokenId, side }, opts);
}
