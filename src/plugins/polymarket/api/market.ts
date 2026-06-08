/**
 * Market controller (Phase B): order encode.
 * POST /market/order/encode is a /v1 business endpoint → business envelope.
 */

import type { Result } from '../../../core/types.js';
import type { ByrealError } from '../../../core/errors.js';
import type { OrderEncodeReq, OrderEncodeDTO } from '../types.js';
import { pmWrite, type PmWriteAuth } from './gateway.js';
import { unwrapBusiness, type PmEnvelope } from './envelope.js';

/** POST /market/order/encode → OrderEncodeDTO (eip712 + signatureSuffix + order fields). */
export async function encodeOrder(
  req: OrderEncodeReq,
  auth: PmWriteAuth,
): Promise<Result<OrderEncodeDTO, ByrealError>> {
  const r = await pmWrite<PmEnvelope<OrderEncodeDTO>>('POST', 'v1', '/market/order/encode', req, auth);
  if (!r.ok) return r;
  return unwrapBusiness(r.value);
}
