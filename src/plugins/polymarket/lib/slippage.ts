/**
 * Market-order signed price = worstPrice ± absolute Δ, clamped to a legal range
 * and aligned to tick (docs/polymarket-cli/03 §4.3).
 *
 *   Δ = slippageBps / 10000   (ABSOLUTE probability points — default 0.01;
 *                              NOT a relative % of worst like swap's slippage)
 *   BUY:  signed = min(worst + Δ, 1 - tick), then CEIL to tick
 *   SELL: signed = max(worst - Δ, worst·(1 - relCap), tick), then FLOOR to tick
 *
 * The SELL relative floor: for very-low-price tokens the
 * absolute Δ can exceed the token price, so worst-Δ goes ≤ 0 and the signed
 * price used to be slammed to the tick floor (e.g. 0.001) — the encoded
 * takerAmount then came out so small the CLOB rejected it ("invalid taker
 * amount"). Flooring instead to a relative fraction of worst keeps the SELL
 * order economically sane and acceptable. For normal-price tokens worst-Δ
 * dominates, so behaviour is unchanged. BUY has no such failure mode and is
 * left on the pure absolute Δ + (1-tick) clamp.
 *
 * Result is always 0 < p < 1 and tick-aligned, or CLOB rejects the order.
 * All math via decimal.js to avoid float drift (0.2 + 0.01 ≠ 0.21 in floats).
 */

import Decimal from 'decimal.js';

/** Default SELL relative-discount cap: signed never falls below 80% of worst. */
export const DEFAULT_SELL_REL_CAP_BPS = 2000; // 20%

export function ceilToTick(price: number | string, tick: number): number {
  const p = new Decimal(price);
  const t = new Decimal(tick);
  return p.div(t).toDecimalPlaces(0, Decimal.ROUND_CEIL).times(t).toNumber();
}

export function floorToTick(price: number | string, tick: number): number {
  const p = new Decimal(price);
  const t = new Decimal(tick);
  return p.div(t).toDecimalPlaces(0, Decimal.ROUND_FLOOR).times(t).toNumber();
}

export interface ApplySlippageParams {
  worst: number;
  side: 'buy' | 'sell';
  slippageBps: number;
  tickSize: number;
  /** SELL relative-discount cap (bps of worst); default DEFAULT_SELL_REL_CAP_BPS. */
  relCapBps?: number;
}

export function applySlippage(p: ApplySlippageParams): number {
  const delta = new Decimal(p.slippageBps).div(10_000);
  const tick = new Decimal(p.tickSize);
  const worst = new Decimal(p.worst);

  if (p.side === 'buy') {
    const upper = new Decimal(1).minus(tick); // max legal buy price
    const raw = Decimal.min(worst.plus(delta), upper);
    return ceilToTick(raw.toString(), p.tickSize);
  }
  // sell: floor is the LARGEST (least aggressive) of absolute Δ, the relative
  // cap, and tick. For normal prices worst-Δ wins (unchanged); for low-price
  // tokens the relative floor protects against slamming to tick.
  const relCap = new Decimal(p.relCapBps ?? DEFAULT_SELL_REL_CAP_BPS).div(10_000);
  const relFloor = worst.times(new Decimal(1).minus(relCap));
  const lower = tick; // min legal sell price (> 0)
  const raw = Decimal.max(worst.minus(delta), relFloor, lower);
  return floorToTick(raw.toString(), p.tickSize);
}
