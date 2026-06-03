/**
 * Preview freshness: an immutable snapshot returned by order.preview and the
 * TTL/drift validation order.place runs against a re-quote (docs/05 §4.5).
 *
 * Stateless: the CLI does not persist anything — the Skill round-trips the
 * snapshot back into order.place, which re-quotes and validates:
 *   1. now > expires_at                                  → PREVIEW_EXPIRED (ttl)
 *   2. |fresh_worst - book_worst| / book_worst > drift   → PREVIEW_EXPIRED (drift)
 * TTL is checked before drift. Pure; clock injected as seconds.
 */

import type { Fill } from './book-sweep.js';

export interface PreviewSnapshotInput {
  token_id: string;
  condition_id: string | null;
  side: 'buy' | 'sell';
  order_type: 'FOK' | 'GTC' | 'GTD';
  amount: string | null; // BUY: USD
  size: string | null; // SELL shares / limit size
  tick_size: number;
  neg_risk: boolean;
  book_worst_price: number; // raw scan price (drift basis)
  signed_worst_price: number; // book_worst ± Δ (clamped, tick-aligned)
  avg_price: number;
  fills: Fill[];
  slippage_bps: number;
}

export interface PreviewSnapshot extends PreviewSnapshotInput {
  quoted_at: number; // unix seconds
  expires_at: number; // quoted_at + ttl
}

export function buildSnapshot(
  input: PreviewSnapshotInput,
  nowSec: number,
  ttlSec: number,
): PreviewSnapshot {
  return { ...input, quoted_at: nowSec, expires_at: nowSec + ttlSec };
}

export type ValidateResult = { ok: true } | { ok: false; reason: string };

export function validate(
  snapshot: PreviewSnapshot,
  freshWorst: number,
  nowSec: number,
  driftBps: number,
): ValidateResult {
  if (nowSec > snapshot.expires_at) {
    return { ok: false, reason: `ttl: now ${nowSec} > expires_at ${snapshot.expires_at}` };
  }
  const base = snapshot.book_worst_price;
  if (base > 0) {
    const drift = Math.abs(freshWorst - base) / base;
    const threshold = driftBps / 10_000;
    if (drift > threshold) {
      return {
        ok: false,
        reason: `drift: ${(drift * 100).toFixed(2)}% > ${(threshold * 100).toFixed(2)}%`,
      };
    }
  }
  return { ok: true };
}
