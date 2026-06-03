import { describe, it, expect } from 'vitest';
import { buildSnapshot, validate, type PreviewSnapshotInput } from './freshness.js';

const input: PreviewSnapshotInput = {
  token_id: 'tok',
  condition_id: '0xcond',
  side: 'buy',
  order_type: 'FOK',
  amount: '20',
  size: null,
  tick_size: 0.001,
  neg_risk: true,
  book_worst_price: 0.66,
  signed_worst_price: 0.67,
  avg_price: 0.655,
  fills: [{ price: 0.65, size: 30 }],
  slippage_bps: 100,
};

describe('buildSnapshot', () => {
  it('sets quoted_at = now and expires_at = now + ttl', () => {
    const s = buildSnapshot(input, 1000, 30);
    expect(s.quoted_at).toBe(1000);
    expect(s.expires_at).toBe(1030);
    expect(s.book_worst_price).toBe(0.66);
    expect(s.signed_worst_price).toBe(0.67);
  });
});

describe('validate', () => {
  const snap = buildSnapshot(input, 1000, 30);

  it('ok when within ttl and drift', () => {
    const r = validate(snap, 0.66, 1010, 100); // same worst
    expect(r.ok).toBe(true);
  });

  it('expired (ttl) when now > expires_at', () => {
    const r = validate(snap, 0.66, 1031, 100);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toContain('ttl');
  });

  it('expired (drift) when |fresh - book_worst|/book_worst > driftBps', () => {
    // book_worst 0.66, drift 100bps = 1% → threshold 0.0066; fresh 0.70 → drift ~6%
    const r = validate(snap, 0.7, 1010, 100);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toContain('drift');
  });

  it('ok when drift just under threshold', () => {
    // 1% of 0.66 = 0.0066 → fresh 0.6659 drift ~0.89% < 1%
    const r = validate(snap, 0.6659, 1010, 100);
    expect(r.ok).toBe(true);
  });

  it('ttl is checked before drift', () => {
    const r = validate(snap, 0.99, 9999, 100); // both would trip; ttl wins
    expect(!r.ok && r.reason).toContain('ttl');
  });
});
