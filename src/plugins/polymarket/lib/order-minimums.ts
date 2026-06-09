/**
 * Pre-submit minimum-order checks.
 *
 * The CLOB rejects too-small orders with a cryptic `invalid taker amount`. We
 * pre-check locally (so dry-run surfaces it, with numbers) mirroring the
 * frontend's rules (apps/prediction TradingPanel/state/validation.ts):
 *  - market BUY : notional (USD) ≥ MIN_NOTIONAL_USD ($1). Shares NOT checked
 *                 (frontend gates market BUY on $ only; shares are an estimate).
 *  - market SELL: no local minimum gate. The frontend allows small partial sells,
 *                 and CLOB/backend should be the authority for residual edges.
 *  - limit BUY/SELL: shares ≥ book min_order_size (verified by CLOB rejection).
 *
 * The order-exec post-submit translation of a real `invalid taker amount`
 * remains as a backstop for any residual edge.
 */

/** Minimum order notional in USD — mirrors the frontend MIN_MARKET_BUY_AMOUNT_USDC. */
export const MIN_NOTIONAL_USD = 1;

export interface OrderMinimumInput {
  kind: 'market' | 'limit';
  side: 'BUY' | 'SELL';
  /** Shares involved (user --size for SELL/limit; an estimate for market BUY). */
  shares?: number;
  /** USD notional: market BUY = amount; otherwise size × signedPrice. */
  notionalUsd: number;
  /** book min_order_size (shares); undefined when the book omitted it. */
  minOrderSize?: number;
  /** Override the notional floor (defaults to MIN_NOTIONAL_USD). */
  minNotionalUsd?: number;
}

export interface OrderMinimumVerdict {
  ok: boolean;
  reason?: string;
}

export function checkOrderMinimum(i: OrderMinimumInput): OrderMinimumVerdict {
  const minNotional = i.minNotionalUsd ?? MIN_NOTIONAL_USD;
  // Shares are gated for limit orders. Market sells can be partial, but resting
  // SELL orders below min_order_size are rejected by the CLOB.
  const checksShares = i.kind === 'limit';
  // Market BUY is gated on user-entered USD. Market SELL is left to CLOB/backend.
  const checksNotional = i.kind === 'market' && i.side === 'BUY';

  if (
    checksShares &&
    i.minOrderSize !== undefined &&
    Number.isFinite(i.minOrderSize) &&
    i.minOrderSize > 0 &&
    i.shares !== undefined &&
    i.shares < i.minOrderSize
  ) {
    return {
      ok: false,
      reason: `order size ${i.shares} shares is below the market minimum of ${i.minOrderSize} shares`,
    };
  }

  if (checksNotional && i.notionalUsd < minNotional) {
    return {
      ok: false,
      reason: `order value ~$${i.notionalUsd.toFixed(4)} is below the minimum order value of $${minNotional} (size × price too small — increase the amount/size)`,
    };
  }

  return { ok: true };
}
