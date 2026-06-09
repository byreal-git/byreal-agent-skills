import { describe, it, expect } from 'vitest';
import { checkOrderMinimum, MIN_NOTIONAL_USD } from './order-minimums.js';

describe('checkOrderMinimum', () => {
  // ---- market SELL: notional (size × signedPrice) must clear the min ----
  it('rejects a market SELL whose notional is below the minimum (the live 47.5sh @0.005 = $0.24 case)', () => {
    const v = checkOrderMinimum({
      kind: 'market',
      side: 'SELL',
      shares: 47.5,
      notionalUsd: 47.5 * 0.005, // ≈ 0.2375
      minOrderSize: 5,
    });
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/minimum order value|\$1/i);
  });

  it('passes a market SELL whose notional clears the minimum (the live 6.3795sh @0.616 = $3.93 case)', () => {
    const v = checkOrderMinimum({
      kind: 'market',
      side: 'SELL',
      shares: 6.3795,
      notionalUsd: 6.3795 * 0.616,
      minOrderSize: 5,
    });
    expect(v.ok).toBe(true);
  });

  // ---- market BUY: notional only (shares are an estimate; mirror frontend) ----
  it('passes the proven $1 market BUY (exactly at the boundary)', () => {
    const v = checkOrderMinimum({ kind: 'market', side: 'BUY', notionalUsd: 1, minOrderSize: 5 });
    expect(v.ok).toBe(true);
  });

  it('rejects a market BUY below $1', () => {
    const v = checkOrderMinimum({ kind: 'market', side: 'BUY', notionalUsd: 0.5, minOrderSize: 5 });
    expect(v.ok).toBe(false);
  });

  it('does NOT reject a market BUY on shares (a $1 BUY of a pricey token = few shares is allowed, mirrors frontend)', () => {
    // $1 @ 0.62 ≈ 1.6 shares < minOrderSize 5, but frontend only gates market BUY on $1.
    const v = checkOrderMinimum({ kind: 'market', side: 'BUY', shares: 1.6, notionalUsd: 1, minOrderSize: 5 });
    expect(v.ok).toBe(true);
  });

  // ---- limit: shares vs book min_order_size (mirror frontend) ----
  it('rejects a limit order below the book min_order_size (shares)', () => {
    const v = checkOrderMinimum({ kind: 'limit', side: 'BUY', shares: 3, notionalUsd: 3 * 0.05, minOrderSize: 5 });
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/shares|minimum/i);
  });

  it('passes the proven resting limit (30sh @0.05, min 5)', () => {
    const v = checkOrderMinimum({ kind: 'limit', side: 'BUY', shares: 30, notionalUsd: 30 * 0.05, minOrderSize: 5 });
    expect(v.ok).toBe(true);
  });

  // ---- robustness: missing book min_order_size must not false-reject ----
  it('skips the shares check when the book did not provide min_order_size', () => {
    const v = checkOrderMinimum({ kind: 'limit', side: 'SELL', shares: 1, notionalUsd: 1, minOrderSize: undefined });
    expect(v.ok).toBe(true);
  });

  it('MIN_NOTIONAL_USD mirrors the frontend market-BUY constant ($1)', () => {
    expect(MIN_NOTIONAL_USD).toBe(1);
  });
});
