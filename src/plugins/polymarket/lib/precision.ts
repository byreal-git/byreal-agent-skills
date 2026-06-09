/**
 * Price/amount precision helpers for Polymarket order math.
 *
 * tickSize ∈ {0.1, 0.01, 0.001, 0.0001} → price decimals {1,2,3,4}; the
 * maker/taker amount decimals are price decimals + 2. Amounts
 * are floored (never rounded up) before scaling to 1e6 fixed point.
 *
 * Pure functions; use decimal.js to avoid float drift.
 */

import Decimal from 'decimal.js';

/** tickSize → number of price decimals. */
export function tickSizeToPriceDecimals(tick: number): number {
  // 0.1 → 1, 0.01 → 2, 0.001 → 3, 0.0001 → 4
  return Math.round(-Math.log10(tick));
}

/** tickSize → maker/taker amount decimals (= price decimals + 2). */
export function amountDecimalsForTick(tick: number): number {
  return tickSizeToPriceDecimals(tick) + 2;
}

/** Truncate (floor toward zero) to N decimals, return a clean decimal string. */
export function floorToDecimals(x: string | number, decimals: number): string {
  return new Decimal(x).toDecimalPlaces(decimals, Decimal.ROUND_DOWN).toString();
}

/**
 * Floor a human amount to `amountDecimals`, then scale by 1e6 to an integer
 * string (CLOB maker/takerAmount units). E.g. ('1.23456789', 4) → '1234500'.
 */
export function toFixedPoint6(human: string | number, amountDecimals: number): string {
  const floored = new Decimal(x_str(human)).toDecimalPlaces(amountDecimals, Decimal.ROUND_DOWN);
  return floored.times(1_000_000).toFixed(0);
}

function x_str(x: string | number): string {
  return typeof x === 'number' ? new Decimal(x).toString() : x;
}
