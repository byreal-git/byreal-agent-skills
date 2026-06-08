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
 * Confirmed against the live prod endpoint (docs/09 §1.1, fixture
 * __fixtures__/order-encode-binary.json): both sides use `amount`
 * (BUY = USD to spend, SELL = shares to sell); `size`/`conditionId` are NOT
 * fields. The param→request mapping is isolated in lib/order-build.toEncodeReq.
 */
export interface OrderEncodeReq {
  walletAddress: string;
  tokenId: string;
  side: OrderSide;
  price: string;
  amount: string; // BUY = USD; SELL = shares
  orderType: OrderTypeStr;
  negRisk: boolean;
}

/**
 * The order fields submitted to /clob/order (extracted flat from the DTO, minus
 * encode-meta + owner, plus signature). maker=signer=proxy, taker=0x0,
 * signatureType=3 (POLY_1271); v2-with-builder shape (timestamp/metadata/builder).
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
  signatureType?: number;
  timestamp?: string;
  expiration?: string;
  metadata?: string;
  builder?: string;
  signature?: string;
  [k: string]: unknown;
}

/**
 * Response of POST /market/order/encode (OrderEncodeDTO). The shape is FLAT —
 * the order fields (salt/maker/signer/taker/tokenId/makerAmount/takerAmount/
 * side/signatureType/timestamp/expiration/metadata/builder/owner/orderType) sit
 * at the TOP LEVEL alongside the encode meta below; accessed via the index
 * signature and extracted by lib/order-build.extractOrder.
 */
export interface OrderEncodeDTO {
  eip712: Eip712TypedData;
  orderId?: string;
  appDomainSep?: string;
  contentsHash?: string;
  /** ERC-7739 suffix, NOT 0x-prefixed. */
  signatureSuffix: string;
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

/** Raw GET /clob/data/order/{id} or an entry of /clob/data/orders (OpenOrder). */
export interface OpenOrder {
  id?: string;
  status?: string;
  market?: string;
  asset_id?: string;
  side?: string;
  price?: string;
  original_size?: string;
  size_matched?: string;
  outcome?: string;
  order_type?: string;
  created_at?: string | number;
  [k: string]: unknown;
}

/** Raw DELETE /clob/order or /clob/cancel-all response. */
export interface CancelResponse {
  canceled?: string[];
  not_canceled?: Record<string, string>;
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
  /** User input: BUY = USD spent, SELL = shares sold. */
  amount: string;
  taking_amount?: string;
  making_amount?: string;
  transaction_hashes?: string[];
}
