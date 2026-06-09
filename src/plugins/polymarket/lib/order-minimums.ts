/**
 * Pre-submit minimum-order checks (docs/next-todo §4.2 follow-up).
 *
 * The CLOB rejects too-small orders with a cryptic `invalid taker amount`. We
 * pre-check locally (so dry-run surfaces it, with numbers) mirroring the
 * frontend's rules (apps/prediction TradingPanel/state/validation.ts):
 *  - market BUY : notional (USD) ≥ MIN_NOTIONAL_USD ($1). Shares NOT checked
 *                 (frontend gates market BUY on $ only; shares are an estimate).
 *  - market SELL: notional (size × signedPrice) ≥ MIN_NOTIONAL_USD. The frontend
 *                 does NOT pre-check market SELL, but the CLOB rejects sub-$1
 *                 notionals (live: 47.5sh @0.005 = $0.24 rejected; 6.38sh @0.616
 *                 = $3.93 matched), so we add it. Also checks shares ≥ min.
 *  - limit BUY/SELL: shares ≥ book min_order_size (mirrors frontend limit gate).
 *
 * The exact CLOB notional floor is not in any local source; $1 is the frontend's
 * own constant (MIN_MARKET_BUY_AMOUNT_USDC) and is consistent with every live
 * data point, so we align to it. The order-exec post-submit translation of a
 * real `invalid taker amount` remains as a backstop for any residual edge.
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
  // Shares are gated for limit (both sides) and market SELL — i.e. whenever the
  // user supplied an exact share count. Market BUY shares are an estimate, so
  // (like the frontend) we don't gate on them.
  const checksShares = i.kind === 'limit' || i.side === 'SELL';
  // Notional is gated for market orders (the $ value actually exchanged).
  const checksNotional = i.kind === 'market';

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
