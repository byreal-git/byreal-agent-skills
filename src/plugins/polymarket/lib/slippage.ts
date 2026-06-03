/**
 * Market-order signed price = worstPrice ± absolute Δ, clamped to a legal range
 * and aligned to tick (docs/polymarket-cli/05 §4.3).
 *
 *   Δ = slippageBps / 10000   (ABSOLUTE probability points — default 0.01;
 *                              NOT a relative % of worst like swap's slippage)
 *   BUY:  signed = min(worst + Δ, 1 - tick), then CEIL to tick
 *   SELL: signed = max(worst - Δ, tick),     then FLOOR to tick
 *
 * Result is always 0 < p < 1 and tick-aligned, or CLOB rejects the order.
 * All math via decimal.js to avoid float drift (0.2 + 0.01 ≠ 0.21 in floats).
 */

import Decimal from 'decimal.js';

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
  // sell
  const lower = tick; // min legal sell price (> 0)
  const raw = Decimal.max(worst.minus(delta), lower);
  return floorToTick(raw.toString(), p.tickSize);
}
