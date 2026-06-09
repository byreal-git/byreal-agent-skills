/**
 * CLOB order submit + status (Phase B). Both are /clob passthrough → RAW
 * Polymarket JSON (no business envelope). Writes inject Authorization + x-evm-address
 * (gateway adds L2 HMAC + owner→apiKey).
 */

import { ok } from '../../../core/types.js';
import type { Result } from '../../../core/types.js';
import type { ByrealError } from '../../../core/errors.js';
import type { SubmitOrderBody, OrderResponse, OpenOrder, CancelResponse } from '../types.js';
import { pmWrite, pmGet, type PmWriteAuth, type PmQueryParams } from './gateway.js';

/** POST /clob/order → raw OrderResponse. */
export function submitOrder(
  body: SubmitOrderBody,
  auth: PmWriteAuth,
): Promise<Result<OrderResponse, ByrealError>> {
  return pmWrite<OrderResponse>('POST', 'clob', '/order', body, auth);
}

/** GET /clob/data/order/{id} → raw OpenOrder (L2-scoped read; send auth headers). */
export function getOrderStatus(
  orderId: string,
  auth: PmWriteAuth,
): Promise<Result<OpenOrder, ByrealError>> {
  return pmGet<OpenOrder>('clob', `/data/order/${encodeURIComponent(orderId)}`, undefined, {
    headers: { Authorization: `Bearer ${auth.token}`, 'x-evm-address': auth.evmAddress },
  });
}

/**
 * GET /clob/data/orders → active orders (L2). The CLOB returns a paginated
 * object `{ data: OpenOrder[], next_cursor, limit, count }` (not a bare array) —
 * extract `.data`. Tolerates a bare array too.
 */
export async function getActiveOrders(
  params: PmQueryParams,
  auth: PmWriteAuth,
): Promise<Result<OpenOrder[], ByrealError>> {
  const r = await pmGet<{ data?: OpenOrder[] } | OpenOrder[]>('clob', '/data/orders', params, {
    headers: { Authorization: `Bearer ${auth.token}`, 'x-evm-address': auth.evmAddress },
  });
  if (!r.ok) return r;
  const v = r.value;
  return ok(Array.isArray(v) ? v : (v?.data ?? []));
}

/** DELETE /clob/order → cancel one order by id. */
export function cancelOrder(
  orderId: string,
  auth: PmWriteAuth,
): Promise<Result<CancelResponse, ByrealError>> {
  return pmWrite<CancelResponse>('DELETE', 'clob', '/order', { orderID: orderId }, auth);
}

/** DELETE /clob/cancel-all → cancel all open orders for the wallet. */
export function cancelAll(auth: PmWriteAuth): Promise<Result<CancelResponse, ByrealError>> {
  return pmWrite<CancelResponse>('DELETE', 'clob', '/cancel-all', undefined, auth);
}

/**
 * POST /v1/market/limit-order/submit — register a GTC/GTD limit order for
 * backend keepalive heartbeat (docs/02 §七). Different base path (/v1/market,
 * NOT /clob). Market orders must NOT call this. /v1 enveloped.
 */
export async function submitLimitKeepalive(
  eoaAddress: string,
  orderId: string,
  auth: PmWriteAuth,
): Promise<Result<unknown, ByrealError>> {
  return pmWrite<unknown>('POST', 'v1', '/market/limit-order/submit', { eoaAddress, orderId }, auth);
}
