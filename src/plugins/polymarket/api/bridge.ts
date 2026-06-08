/**
 * Byreal /bridge/* endpoints. Phase A uses only the PUBLIC reads:
 *   /bridge/supported-assets, /bridge/quote, /bridge/deposit/address,
 *   /bridge/orders. The deposit/withdraw *submit* writes are Phase B.
 */

import type { Result } from '../../../core/types.js';
import type { ByrealError } from '../../../core/errors.js';
import { pmGet, pmWrite, type PmGetOptions, type PmQueryParams, type PmWriteAuth } from './gateway.js';
import { unwrapBusiness, type PmEnvelope } from './envelope.js';

export interface BridgeSupportedAsset {
  chainId: string; // bridge chain id (Solana = "1151111081099710")
  tokenAddress: string;
  symbol: string;
  decimals: number;
  minDepositAmount?: string;
  minWithdrawAmount?: string;
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
  // Real /bridge/orders fields (verified against a live COMPLETED deposit order):
  // a single `amount` (no from/to split in the list view), ISO `createdAt`/`updatedAt`,
  // `txHash`, `bridgeStatus`, and chain ids — NOT fromAmount/toAmount/createTime.
  bridgeStatus?: string;
  amount?: string;
  fromChainId?: string;
  toChainId?: string | null;
  txHash?: string;
  createdAt?: string;
  updatedAt?: string;
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

/**
 * POST /bridge/deposit/submit — body fields confirmed against the live flow
 * (the backend validates + broadcasts the signed Solana tx; CLI never broadcasts).
 * /v1 business endpoint → enveloped. Exact field set may be trimmed after the
 * first live submit (failed submits don't move funds).
 */
export interface BridgeDepositSubmitReq {
  quoteId: string;
  signedTransaction: string; // base64 signed Solana V0 tx
  fromChainId: string;
  fromTokenAddress: string;
  toChainId: string;
  toTokenAddress: string;
  amount: string;
  recipientAddress: string; // proxy wallet (Polygon)
  depositAddress: string; // Solana intermediary
  [k: string]: unknown;
}

export async function submitDeposit(
  body: BridgeDepositSubmitReq,
  auth: PmWriteAuth,
): Promise<Result<BridgeOrder, ByrealError>> {
  const r = await pmWrite<PmEnvelope<BridgeOrder>>('POST', 'v1', '/bridge/deposit/submit', body, auth);
  if (!r.ok) return r;
  return unwrapBusiness(r.value);
}
