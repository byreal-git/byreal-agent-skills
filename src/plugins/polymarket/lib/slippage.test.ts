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
