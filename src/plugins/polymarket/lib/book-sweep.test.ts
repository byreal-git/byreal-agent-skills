import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { sweep, type BookLevel } from './book-sweep.js';

describe('sweep BUY (buy-usd, consumes asks cheapest-first)', () => {
  // intentionally out of order to prove internal sort
  const asks: BookLevel[] = [
    { price: '0.22', size: '100' },
    { price: '0.20', size: '100' },
  ];

  it('worstPrice = last ask touched; avg = usd/shares; fullyFilled', () => {
    const r = sweep(asks, 30, 'buy-usd');
    expect(r.fullyFilled).toBe(true);
    expect(r.worstPrice).toBeCloseTo(0.22, 10);
    // 100 @0.20 ($20) + 45.4545 @0.22 ($10) = 145.4545 shares
    expect(r.shares).toBeCloseTo(145.4545, 3);
    expect(r.avgPrice).toBeCloseTo(30 / 145.4545, 4);
    expect(r.fills).toHaveLength(2);
  });

  it('single-level fill stays at the best ask', () => {
    const r = sweep(asks, 10, 'buy-usd');
    expect(r.worstPrice).toBeCloseTo(0.2, 10);
    expect(r.fills).toHaveLength(1);
  });

  it('thin book → not fully filled, worst = deepest level', () => {
    const r = sweep(asks, 1000, 'buy-usd');
    expect(r.fullyFilled).toBe(false);
    expect(r.worstPrice).toBeCloseTo(0.22, 10);
  });
});

describe('sweep SELL (sell-shares, consumes bids highest-first)', () => {
  const bids: BookLevel[] = [
    { price: '0.63', size: '100' },
    { price: '0.65', size: '100' },
  ];
  it('worstPrice = last bid touched; avg = proceeds/shares', () => {
    const r = sweep(bids, 150, 'sell-shares');
    expect(r.fullyFilled).toBe(true);
    expect(r.worstPrice).toBeCloseTo(0.63, 10);
    expect(r.shares).toBeCloseTo(150, 6);
    // proceeds 65 + 31.5 = 96.5 → avg 0.643333
    expect(r.avgPrice).toBeCloseTo(96.5 / 150, 6);
  });
  it('thin book → not fully filled', () => {
    expect(sweep(bids, 500, 'sell-shares').fullyFilled).toBe(false);
  });
});

describe('sweep on the real Spurs book fixture', () => {
  const book = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', '__fixtures__', 'clob-book-spurs.json'), 'utf-8'),
  ) as { asks: BookLevel[]; bids: BookLevel[] };

  it('BUY $20: worst within [best ask, deepest ask] and >= best', () => {
    const r = sweep(book.asks, 20, 'buy-usd');
    expect(r.fullyFilled).toBe(true);
    expect(r.worstPrice).toBeGreaterThanOrEqual(0.649); // best ask
    expect(r.worstPrice).toBeLessThanOrEqual(0.669); // deepest captured ask
    expect(r.avgPrice).toBeLessThanOrEqual(r.worstPrice + 1e-9);
  });

  it('SELL 30 shares: worst <= best bid', () => {
    const r = sweep(book.bids, 30, 'sell-shares');
    expect(r.fullyFilled).toBe(true);
    expect(r.worstPrice).toBeLessThanOrEqual(0.648); // best bid
  });
});
