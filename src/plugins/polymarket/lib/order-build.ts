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

/** Encode-meta + owner keys that are NOT part of the submitted order. */
const NON_ORDER_KEYS = new Set([
  'eip712',
  'orderId',
  'appDomainSep',
  'contentsHash',
  'signatureSuffix',
  'orderType',
  'owner', // gateway overwrites owner→apiKey; the frontend omits it too
]);

/**
 * Extract the submit `order` from the FLAT encode DTO: keep the order fields
 * (salt/maker/signer/taker/tokenId/makerAmount/takerAmount/side/signatureType/
 * timestamp/expiration/metadata/builder), drop encode-meta + owner.
 */
export function extractOrder(dto: OrderEncodeDTO): EncodedOrder {
  const order: EncodedOrder = {};
  for (const [k, v] of Object.entries(dto)) {
    if (!NON_ORDER_KEYS.has(k)) order[k] = v;
  }
  return order;
}

export interface EncodeParams {
  walletAddress: string;
  tokenId: string;
  side: OrderSide;
  /** Signed worst price (market = re-quote worst ± Δ, tick-aligned). */
  signedPrice: string;
  /** BUY = USD to spend; SELL = shares to sell. */
  amount: string;
  negRisk: boolean;
  /** Defaults to FOK (market). */
  orderType?: OrderTypeStr;
}

export function toEncodeReq(p: EncodeParams): OrderEncodeReq {
  return {
    walletAddress: p.walletAddress,
    tokenId: p.tokenId,
    side: p.side,
    price: p.signedPrice,
    amount: p.amount,
    orderType: p.orderType ?? 'FOK',
    negRisk: p.negRisk,
  };
}

/**
 * Build the POST /clob/order body from the flat DTO (matches the frontend's
 * serializeSignedOrder): order fields (owner stripped) + assembled signature,
 * with `salt` as a NUMBER (the CLOB rejects a string salt → "Invalid order
 * payload"). Body shape `{order, orderType, postOnly, deferExec}`.
 */
export function toSubmitBody(
  dto: OrderEncodeDTO,
  innerSig: string,
  orderType: OrderTypeStr,
): SubmitOrderBody {
  const order = extractOrder(dto);
  order.signature = assembleSignature(innerSig, dto.signatureSuffix);
  if (typeof order.salt === 'string') {
    order.salt = Number.parseInt(order.salt, 10);
  }
  return { order, orderType, postOnly: false, deferExec: false };
}
