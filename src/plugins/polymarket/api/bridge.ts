/**
 * Byreal /bridge/* endpoints. Phase A uses only the PUBLIC reads:
 *   /bridge/supported-assets, /bridge/quote, /bridge/deposit/address,
 *   /bridge/orders. The deposit/withdraw *submit* writes are Phase B.
 */

import type { Result } from '../../../core/types.js';
import type { ByrealError } from '../../../core/errors.js';
import { pmGet, type PmGetOptions, type PmQueryParams } from './gateway.js';
import { unwrapBusiness, type PmEnvelope } from './envelope.js';

export interface BridgeSupportedAsset {
  chainId: number;
  tokenAddress: string;
  symbol: string;
  decimals: number;
  minDeposit?: string;
  minWithdraw?: string;
}

export interface BridgeQuote {
  quoteId: string;
  fromAmount?: string;
  toAmount?: string;
  estTimeMs?: number;
  fee?: Record<string, unknown>;
}

export interface BridgeDepositAddress {
  depositAddress: string;
  [k: string]: unknown;
}

export interface BridgeOrder {
  orderId?: string;
  status?: string;
  type?: string;
  [k: string]: unknown;
}

export async function getSupportedAssets(
  opts?: PmGetOptions,
): Promise<Result<BridgeSupportedAsset[], ByrealError>> {
  const r = await pmGet<PmEnvelope<BridgeSupportedAsset[]>>('v1', '/bridge/supported-assets', undefined, opts);
  if (!r.ok) return r;
  return unwrapBusiness(r.value);
}

export async function getQuote(
  params: PmQueryParams,
  opts?: PmGetOptions,
): Promise<Result<BridgeQuote, ByrealError>> {
  const r = await pmGet<PmEnvelope<BridgeQuote>>('v1', '/bridge/quote', params, opts);
  if (!r.ok) return r;
  return unwrapBusiness(r.value);
}

export async function getDepositAddress(
  params: PmQueryParams,
  opts?: PmGetOptions,
): Promise<Result<BridgeDepositAddress, ByrealError>> {
  const r = await pmGet<PmEnvelope<BridgeDepositAddress>>('v1', '/bridge/deposit/address', params, opts);
  if (!r.ok) return r;
  return unwrapBusiness(r.value);
}

export async function getOrders(
  params: PmQueryParams,
  opts?: PmGetOptions,
): Promise<Result<BridgeOrder[], ByrealError>> {
  const r = await pmGet<PmEnvelope<BridgeOrder[]>>('v1', '/bridge/orders', params, opts);
  if (!r.ok) return r;
  return unwrapBusiness(r.value);
}
