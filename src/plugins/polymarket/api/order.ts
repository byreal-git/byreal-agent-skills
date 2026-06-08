/**
 * CLOB order submit + status (Phase B). Both are /clob passthrough → RAW
 * Polymarket JSON (no business envelope). Writes inject Authorization + x-evm-address
 * (gateway adds L2 HMAC + owner→apiKey).
 */

import type { Result } from '../../../core/types.js';
import type { ByrealError } from '../../../core/errors.js';
import type { SubmitOrderBody, OrderResponse, OpenOrder } from '../types.js';
import { pmWrite, pmGet, type PmWriteAuth } from './gateway.js';

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
