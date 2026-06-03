import { describe, it, expect } from 'vitest';
import {
  tickSizeToPriceDecimals,
  amountDecimalsForTick,
  floorToDecimals,
  toFixedPoint6,
} from './precision.js';

describe('tickSizeToPriceDecimals', () => {
  it('maps tick sizes to price decimals', () => {
    expect(tickSizeToPriceDecimals(0.1)).toBe(1);
    expect(tickSizeToPriceDecimals(0.01)).toBe(2);
    expect(tickSizeToPriceDecimals(0.001)).toBe(3);
    expect(tickSizeToPriceDecimals(0.0001)).toBe(4);
  });
});

describe('amountDecimalsForTick', () => {
  it('is price decimals + 2 (per docs/06 M4 C4)', () => {
    expect(amountDecimalsForTick(0.1)).toBe(3);
    expect(amountDecimalsForTick(0.01)).toBe(4);
    expect(amountDecimalsForTick(0.001)).toBe(5);
    expect(amountDecimalsForTick(0.0001)).toBe(6);
  });
});

describe('floorToDecimals', () => {
  it('truncates (does not round) to N decimals', () => {
    expect(floorToDecimals('1.23987', 4)).toBe('1.2398');
    expect(floorToDecimals('1.99999', 2)).toBe('1.99');
    expect(floorToDecimals('5', 3)).toBe('5');
    expect(floorToDecimals(0.30001, 4)).toBe('0.3');
  });
});

describe('toFixedPoint6', () => {
  it('floors to amount decimals then scales by 1e6 to an integer string', () => {
    expect(toFixedPoint6('1.5', 6)).toBe('1500000');
    expect(toFixedPoint6('1.234567', 6)).toBe('1234567');
    // tick 0.01 → 4 amount decimals: floor 1.23456789 → 1.2345 → 1234500
    expect(toFixedPoint6('1.23456789', 4)).toBe('1234500');
    expect(toFixedPoint6('0', 6)).toBe('0');
  });
});
