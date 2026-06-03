import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildOrderPreview } from './order-view.js';
import type { OrderBook } from '../api/clob.js';

const book = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '__fixtures__', 'clob-book-spurs.json'), 'utf-8'),
) as OrderBook;

const NOW = 1_700_000_000;

describe('buildOrderPreview — market FOK (real Spurs book)', () => {
  it('BUY $20: immutable snapshot w/ book_worst, signed (worst+Δ), fills, expiry', () => {
    const r = buildOrderPreview({
      tokenId: 'tok',
      conditionId: '0xcond',
      side: 'buy',
      orderType: 'market',
      amount: '20',
      slippageBps: 100,
      book,
      nowSec: NOW,
      ttlSec: 30,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const s = r.value.preview;
    expect(s.order_type).toBe('FOK');
    expect(s.side).toBe('buy');
    expect(s.tick_size).toBe(0.001);
    expect(s.neg_risk).toBe(true);
    expect(s.quoted_at).toBe(NOW);
    expect(s.expires_at).toBe(NOW + 30);
    expect(s.book_worst_price).toBeGreaterThanOrEqual(0.649);
    expect(s.signed_worst_price).toBeGreaterThan(s.book_worst_price); // BUY adds Δ
    expect(s.signed_worst_price).toBeLessThan(1);
    expect(s.fills.length).toBeGreaterThan(0);
    expect(r.value.fully_fills).toBe(true);
    expect(s.slippage_bps).toBe(100);
  });

  it('SELL 30 shares: signed = worst - Δ (floored), below best bid', () => {
    const r = buildOrderPreview({
      tokenId: 'tok',
      conditionId: null,
      side: 'sell',
      orderType: 'market',
      size: '30',
      slippageBps: 100,
      book,
      nowSec: NOW,
      ttlSec: 30,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.preview.side).toBe('sell');
    expect(r.value.preview.signed_worst_price).toBeLessThan(r.value.preview.book_worst_price);
    expect(r.value.preview.signed_worst_price).toBeGreaterThan(0);
  });

  it('thin size flags fully_fills=false + warning', () => {
    const r = buildOrderPreview({
      tokenId: 'tok',
      conditionId: null,
      side: 'buy',
      orderType: 'market',
      amount: '999999999',
      slippageBps: 100,
      book,
      nowSec: NOW,
      ttlSec: 30,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.fully_fills).toBe(false);
    expect(r.value.warning).toContain('FOK');
  });

  it('BUY without --amount → validation error', () => {
    const r = buildOrderPreview({
      tokenId: 'tok', conditionId: null, side: 'buy', orderType: 'market',
      slippageBps: 100, book, nowSec: NOW, ttlSec: 30,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('INVALID_PARAMETER');
  });
});

describe('buildOrderPreview — limit GTC', () => {
  it('echoes price (tick-aligned), order_type GTC, no fills', () => {
    const r = buildOrderPreview({
      tokenId: 'tok', conditionId: null, side: 'buy', orderType: 'limit',
      price: '0.5', size: '100', slippageBps: 100, book, nowSec: NOW, ttlSec: 30,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.preview.order_type).toBe('GTC');
    expect(r.value.preview.signed_worst_price).toBeCloseTo(0.5, 10);
    expect(r.value.preview.fills).toEqual([]);
    expect(r.value.preview.slippage_bps).toBe(0);
  });

  it('rejects out-of-range limit price', () => {
    const r = buildOrderPreview({
      tokenId: 'tok', conditionId: null, side: 'buy', orderType: 'limit',
      price: '1.5', size: '100', slippageBps: 100, book, nowSec: NOW, ttlSec: 30,
    });
    expect(r.ok).toBe(false);
  });
});
