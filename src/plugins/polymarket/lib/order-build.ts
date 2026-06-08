/**
 * Pure helpers for Plan-B order assembly (docs/02 §二, docs/09).
 *
 * The backend `encode` endpoint produces the order math + EIP-712 typed-data;
 * here we only:
 *  - assemble the ERC-7739 signature: "0x" + innerSig + signatureSuffix
 *  - strip `owner` (the gateway overwrites owner→apiKey unconditionally; we drop
 *    it so the submitted body is clean — not a HMAC-correctness requirement)
 *  - shape the encode request and the submit body
 *
 * Exact `OrderEncodeReq` field names + the submit `signature` placement are
 * confirmed against a real encode response (docs/09 §6); the mapping lives here
 * so any rename touches one place.
 */
import type {
  OrderEncodeDTO,
  OrderEncodeReq,
  OrderSide,
  OrderTypeStr,
  EncodedOrder,
  SubmitOrderBody,
} from '../types.js';

const strip0x = (h: string): string => (h.startsWith('0x') ? h.slice(2) : h);

/** sig = "0x" + innerSig(65 bytes) + signatureSuffix (ERC-7739 TypedDataSign). */
export function assembleSignature(innerSig: string, signatureSuffix: string): string {
  return '0x' + strip0x(innerSig) + strip0x(signatureSuffix);
}

/** Return a copy of the order without `owner`. */
export function stripOwner(order: EncodedOrder): EncodedOrder {
  const { owner: _owner, ...rest } = order;
  return rest;
}

export interface EncodeParams {
  walletAddress: string;
  tokenId: string;
  conditionId?: string;
  side: OrderSide;
  /** Signed worst price (market = re-quote worst ± Δ, tick-aligned). */
  signedPrice: string;
  size: string;
  negRisk: boolean;
  /** Defaults to FOK (market). */
  orderType?: OrderTypeStr;
}

export function toEncodeReq(p: EncodeParams): OrderEncodeReq {
  return {
    walletAddress: p.walletAddress,
    tokenId: p.tokenId,
    conditionId: p.conditionId,
    side: p.side,
    price: p.signedPrice,
    size: p.size,
    orderType: p.orderType ?? 'FOK',
    negRisk: p.negRisk,
  };
}

/** Build the POST /clob/order body: owner stripped, assembled signature on the order. */
export function toSubmitBody(
  dto: OrderEncodeDTO,
  innerSig: string,
  orderType: OrderTypeStr,
): SubmitOrderBody {
  const order = stripOwner(dto.order);
  order.signature = assembleSignature(innerSig, dto.signatureSuffix);
  return { order, orderType, postOnly: false };
}
