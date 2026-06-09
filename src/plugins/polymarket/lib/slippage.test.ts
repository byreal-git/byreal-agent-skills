import { describe, it, expect } from 'vitest';
import { applySlippage, ceilToTick, floorToTick } from './slippage.js';

describe('tick rounding', () => {
  it('ceilToTick rounds up, floorToTick rounds down (no float drift)', () => {
    expect(ceilToTick(0.6512, 0.001)).toBeCloseTo(0.652, 10);
    expect(floorToTick(0.6512, 0.001)).toBeCloseTo(0.651, 10);
    expect(ceilToTick(0.21, 0.01)).toBeCloseTo(0.21, 10); // already aligned
  });
});

describe('applySlippage — absolute Δ (NOT relative %)', () => {
  it('BUY adds Δ = bps/10000 then ceils to tick', () => {
    expect(applySlippage({ worst: 0.2, side: 'buy', slippageBps: 100, tickSize: 0.01 })).toBeCloseTo(0.21, 10);
    expect(applySlippage({ worst: 0.9, side: 'buy', slippageBps: 100, tickSize: 0.01 })).toBeCloseTo(0.91, 10);
  });

  it('SELL subtracts Δ then floors to tick', () => {
    expect(applySlippage({ worst: 0.2, side: 'sell', slippageBps: 100, tickSize: 0.01 })).toBeCloseTo(0.19, 10);
    expect(applySlippage({ worst: 0.9, side: 'sell', slippageBps: 100, tickSize: 0.01 })).toBeCloseTo(0.89, 10);
  });

  it('Δ is absolute and uniform across the range (not scaled by worst)', () => {
    // worst 0.2 and 0.9 both move by exactly 0.01 (1 prob point), not by 1% of worst
    const a = applySlippage({ worst: 0.2, side: 'buy', slippageBps: 100, tickSize: 0.001 });
    const b = applySlippage({ worst: 0.9, side: 'buy', slippageBps: 100, tickSize: 0.001 });
    expect(a).toBeCloseTo(0.21, 10);
    expect(b).toBeCloseTo(0.91, 10);
  });

  it('BUY clamps to (1 - tick)', () => {
    // 0.995 + 0.01 = 1.005 → clamp to 0.99, ceil → 0.99
    expect(applySlippage({ worst: 0.995, side: 'buy', slippageBps: 100, tickSize: 0.01 })).toBeCloseTo(0.99, 10);
  });

  it('SELL clamps to tick (>0)', () => {
    // 0.005 - 0.01 = -0.005 → clamp to tick 0.01, floor → 0.01
    expect(applySlippage({ worst: 0.005, side: 'sell', slippageBps: 100, tickSize: 0.01 })).toBeCloseTo(0.01, 10);
  });

  it('output is always strictly within (0,1) and tick-aligned', () => {
    for (const worst of [0.001, 0.5, 0.999]) {
      for (const side of ['buy', 'sell'] as const) {
        const p = applySlippage({ worst, side, slippageBps: 100, tickSize: 0.001 });
        expect(p).toBeGreaterThan(0);
        expect(p).toBeLessThan(1);
      }
    }
  });
});

describe('applySlippage — SELL low-price relative floor (docs/next-todo §4.2)', () => {
  // Root cause of the live SELL rejection: when the absolute Δ exceeds the token
  // price, worst-Δ goes ≤ 0 → the signed price was slammed to the tick floor
  // (e.g. 0.001), so the encoded takerAmount was so small the CLOB rejected it
  // ("invalid taker amount"). Fix: floor the SELL signed price to a relative
  // fraction of worst (default 20%) instead of all the way down to tick.

  it('SELL no longer slams to tick when Δ exceeds the token price', () => {
    // worst 0.008, Δ 0.01 (>worst). Old: max(0.008-0.01, tick) = tick = 0.001.
    // New: max(0.008-0.01, 0.008*(1-0.20)=0.0064, 0.001) = 0.0064 → floor 0.001 → 0.006.
    expect(applySlippage({ worst: 0.008, side: 'sell', slippageBps: 100, tickSize: 0.001 }))
      .toBeCloseTo(0.006, 10);
  });

  it('SELL relative floor is configurable via relCapBps', () => {
    // worst 0.01, Δ 0.02, relCap 10%: max(-0.01, 0.01*0.9=0.009, 0.001)=0.009 → floor 0.009.
    expect(
      applySlippage({ worst: 0.01, side: 'sell', slippageBps: 200, tickSize: 0.001, relCapBps: 1000 }),
    ).toBeCloseTo(0.009, 10);
  });

  it('SELL with a normal-price token is unchanged (absolute Δ dominates)', () => {
    // worst 0.3, Δ 0.01, relCap 20%: max(0.29, 0.24, 0.001)=0.29 → absolute wins.
    expect(applySlippage({ worst: 0.3, side: 'sell', slippageBps: 100, tickSize: 0.01 }))
      .toBeCloseTo(0.29, 10);
  });

  it('BUY is NOT affected by the SELL relative floor (proven BUY path unchanged)', () => {
    // BUY low-price token keeps the full absolute Δ buffer (no "invalid taker
    // amount" failure mode exists on the BUY side).
    expect(applySlippage({ worst: 0.021, side: 'buy', slippageBps: 100, tickSize: 0.001 }))
      .toBeCloseTo(0.031, 10);
    expect(applySlippage({ worst: 0.008, side: 'buy', slippageBps: 100, tickSize: 0.001 }))
      .toBeCloseTo(0.018, 10);
  });

  it('SELL relative floor still clamps to tick when even the relative floor is below tick', () => {
    // worst 0.005, Δ 0.01, tick 0.01, relCap 20%: max(-0.005, 0.004, 0.01)=0.01.
    expect(applySlippage({ worst: 0.005, side: 'sell', slippageBps: 100, tickSize: 0.01 }))
      .toBeCloseTo(0.01, 10);
  });
});
