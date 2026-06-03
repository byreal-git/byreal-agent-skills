/**
 * Order-book sweep → worstPrice / avgPrice / fills.
 *
 * Polymarket's /book returns asks DESCENDING and bids ASCENDING (best price is
 * last). sweep() sorts internally so callers can pass the raw book:
 *   - buy-usd:     consume asks cheapest-first; target is USD to spend.
 *   - sell-shares: consume bids highest-first;  target is shares to sell.
 *
 * worstPrice = price of the last level touched (the signed worst-price basis,
 * mirroring the frontend's lastFillPrice). Pure; uses decimal.js.
 */

import Decimal from 'decimal.js';

export interface BookLevel {
  price: string;
  size: string;
}

export interface Fill {
  price: number;
  size: number; // shares filled at this level
}

export interface SweepResult {
  worstPrice: number;
  avgPrice: number;
  shares: number; // total shares filled
  usd: number; // total USD spent (buy) or received (sell)
  fills: Fill[];
  fullyFilled: boolean;
}

export type SweepMode = 'buy-usd' | 'sell-shares';

export function sweep(levels: BookLevel[], target: number, mode: SweepMode): SweepResult {
  // Sort so the best price comes first.
  const sorted = [...levels]
    .map((l) => ({ price: new Decimal(l.price), size: new Decimal(l.size) }))
    .sort((a, b) =>
      mode === 'buy-usd' ? a.price.minus(b.price).toNumber() : b.price.minus(a.price).toNumber(),
    );

  let remaining = new Decimal(target); // USD (buy) or shares (sell)
  let shares = new Decimal(0);
  let usd = new Decimal(0);
  const fills: Fill[] = [];
  let worst = new Decimal(0);
  const ZERO = new Decimal(0);

  for (const lvl of sorted) {
    if (remaining.lte(ZERO)) break;
    if (lvl.size.lte(ZERO)) continue;

    let fillShares: Decimal;
    if (mode === 'buy-usd') {
      // USD to fully consume this level = price * size.
      const levelUsd = lvl.price.times(lvl.size);
      const spend = Decimal.min(remaining, levelUsd);
      fillShares = spend.div(lvl.price);
      usd = usd.plus(spend);
      remaining = remaining.minus(spend);
    } else {
      fillShares = Decimal.min(remaining, lvl.size);
      usd = usd.plus(fillShares.times(lvl.price));
      remaining = remaining.minus(fillShares);
    }

    shares = shares.plus(fillShares);
    worst = lvl.price;
    fills.push({ price: lvl.price.toNumber(), size: fillShares.toNumber() });
  }

  const avg = shares.gt(ZERO) ? usd.div(shares) : ZERO;
  return {
    worstPrice: worst.toNumber(),
    avgPrice: avg.toNumber(),
    shares: shares.toNumber(),
    usd: usd.toNumber(),
    fills,
    fullyFilled: remaining.lte(new Decimal('1e-9')),
  };
}
