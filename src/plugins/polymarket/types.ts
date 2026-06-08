/**
 * Shared types for the Polymarket plugin.
 *
 * Response/preview shapes grow as commands land in C2–C5. Kept minimal here.
 */

import type { GlobalOptions } from '../../core/types.js';
import type { Eip712TypedData } from '../../privy/types.js';

export type { GlobalOptions };

export type Side = 'buy' | 'sell';
export type OrderType = 'FOK' | 'GTC' | 'GTD';

// ============================================================
// Phase B — order placement (Plan B: gateway encode → Privy sign → submit)
// ============================================================

export type OrderSide = 'BUY' | 'SELL';
export type OrderTypeStr = 'FOK' | 'GTC' | 'GTD';

/**
 * Request body for POST /market/order/encode (OrderEncodeReq).
 * Exact field names confirmed in the live run (docs/09 §6); the param→request
 * mapping is isolated in lib/order-build.toEncodeReq so a rename touches one place.
 */
export interface OrderEncodeReq {
  walletAddress: string;
  tokenId: string;
  conditionId?: string;
  side: OrderSide;
  price: string;
  size: string;
  orderType: OrderTypeStr;
  negRisk: boolean;
}

/**
 * The order fields the backend computed (maker=signer=proxy, taker=0x0,
 * signatureType=3 POLY_1271, makerAmount/takerAmount fixed-point). Index
 * signature passes through any unknown extras untouched.
 */
export interface EncodedOrder {
  salt?: string;
  maker?: string;
  signer?: string;
  taker?: string;
  tokenId?: string;
  makerAmount?: string;
  takerAmount?: string;
  side?: string | number;
  expiration?: string;
  nonce?: string;
  feeRateBps?: string;
  signatureType?: number;
  owner?: string;
  signature?: string;
  [k: string]: unknown;
}

/** Response of POST /market/order/encode (OrderEncodeDTO). */
export interface OrderEncodeDTO {
  eip712: Eip712TypedData;
  orderId?: string;
  appDomainSep?: string;
  contentsHash?: string;
  signatureSuffix: string;
  order: EncodedOrder;
  [k: string]: unknown;
}

/** Body of POST /clob/order. */
export interface SubmitOrderBody {
  order: EncodedOrder;
  orderType: OrderTypeStr;
  postOnly: boolean;
}

/** Raw OrderResponse from POST /clob/order (Polymarket passthrough, no envelope). */
export interface OrderResponse {
  success?: boolean;
  orderID?: string;
  status?: string;
  transactionsHashes?: string[];
  takingAmount?: string;
  makingAmount?: string;
  errorMsg?: string;
  [k: string]: unknown;
}

/** Raw GET /clob/data/order/{id} (OpenOrder). */
export interface OpenOrder {
  id?: string;
  status?: string;
  size_matched?: string;
  original_size?: string;
  [k: string]: unknown;
}

/** Raw GET /clob/balance-allowance body. */
export interface BalanceAllowance {
  balance: string;
  allowances?: Record<string, string>;
}

export interface ReadinessCheck {
  ok: boolean;
  detail: string;
}

export interface ReadinessVerdict {
  ready: boolean;
  checks: {
    proxy_ready: ReadinessCheck;
    balance: ReadinessCheck;
    market: ReadinessCheck;
  };
  proxy_address: string | null;
  blocking_reason?: string;
}

/** Result of an executed order placement (execute mode). */
export interface OrderPlaceResult {
  orderID: string;
  status: string | null;
  /** settled = reached a terminal status within the poll budget; pending = timed out (re-check via order status). */
  outcome: 'settled' | 'pending';
  side: OrderSide;
  signed_price: string;
  size: string;
  taking_amount?: string;
  making_amount?: string;
  transaction_hashes?: string[];
}
