import { Decimal } from 'decimal.js';
import { describe, test, expect } from 'vitest';

import { SqrtPriceMath } from './sqrtPriceMath.js';
import { TickMath } from './tickMath.js';

describe('TickMath basic functionality test', () => {
  test('getTickWithPriceAndTickspacing basic functionality', () => {
    const priceList = [
      new Decimal('0.001'),
      new Decimal('0.01'),
      new Decimal('0.1'),
      new Decimal('1'),
      new Decimal('10'),
      new Decimal('100'),
      new Decimal('1000'),
      new Decimal('10000'),
    ];

    const tickSpacing = 10;
    const decimalsA = 6;
    const decimalsB = 6;

    for (const price of priceList) {
      const tick = TickMath.getTickWithPriceAndTickspacing(
        price,
        tickSpacing,
        decimalsA,
        decimalsB
      );

      expect(Math.abs(tick % tickSpacing)).toBe(0);
    }
  });

  test('getPriceFromTick basic functionality', () => {
    const tick = 100;
    const decimalsA = 6;
    const decimalsB = 6;

    const price = TickMath.getPriceFromTick({ tick, decimalsA, decimalsB });

    // Verify that the price is positive
    expect(price.isPositive()).toBeTruthy();
  });

  test('getTickAlignedPriceDetails returns the correct structure', () => {
    const price = new Decimal('1.5');
    const tickSpacing = 10;
    const decimalsA = 6;
    const decimalsB = 6;

    const details = TickMath.getTickAlignedPriceDetails(price, tickSpacing, decimalsA, decimalsB);

    // Verify that the returned object contains all necessary fields
    expect(details).toHaveProperty('tick');
    expect(details).toHaveProperty('sqrtPriceX64');
    expect(details).toHaveProperty('price');
    expect(details.tick % tickSpacing).toBe(0);
  });
});

describe('TickMath rounding behavior test', () => {
  test('positive tick rounding up', () => {
    // Select a positive tick that is not a multiple of tickSpacing
    const originalTick = 15;

    const tickSpacing = 10;
    const decimalsA = 9;
    const decimalsB = 6;

    const price = TickMath.getPriceFromTick({ tick: originalTick, decimalsA, decimalsB });
    const alignedTick = TickMath.getTickWithPriceAndTickspacing(
      price,
      tickSpacing,
      decimalsA,
      decimalsB
    );

    expect(alignedTick).toBe(20);
  });

  test('negative tick rounding down', () => {
    // Similar to above, but using a negative tick
    const originalTick = -15;

    const tickSpacing = 10;
    const decimalsA = 9;
    const decimalsB = 6;

    const price = TickMath.getPriceFromTick({ tick: originalTick, decimalsA, decimalsB });
    const alignedTick = TickMath.getTickWithPriceAndTickspacing(
      price,
      tickSpacing,
      decimalsA,
      decimalsB
    );

    // 负数应该向下舍入到 -20
    expect(alignedTick).toBe(-20);
  });
});

describe('TickMath boundary condition test', () => {
  test('extreme price values', () => {
    const extremePrices = [
      new Decimal('0.0000001'), // Very small price
      new Decimal('1000000'), // Very large price
    ];

    const tickSpacing = 60;
    const decimalsA = 6;
    const decimalsB = 6;

    for (const price of extremePrices) {
      const tick = TickMath.getTickWithPriceAndTickspacing(
        price,
        tickSpacing,
        decimalsA,
        decimalsB
      );

      // Verify that the tick is a multiple of tickSpacing
      expect(Math.abs(tick % tickSpacing)).toBe(0);

      // Verify that there is no exception when converting back from tick to price
      const details = TickMath.getTickAlignedPriceDetails(price, tickSpacing, decimalsA, decimalsB);
      expect(details.price.isPositive()).toBeTruthy();
    }
  });

  test('different tickSpacing values', () => {
    const price = new Decimal('1.5');
    const decimalsA = 6;
    const decimalsB = 6;

    const tickSpacings = [1, 10, 60, 200];

    for (const spacing of tickSpacings) {
      const tick = TickMath.getTickWithPriceAndTickspacing(price, spacing, decimalsA, decimalsB);

      // Verify that the tick is a multiple of tickSpacing
      expect(tick % spacing).toBe(0);

      // Verify that the difference between the original tick and the aligned tick should not exceed tickSpacing
      const originalTick = SqrtPriceMath.getTickFromPrice(price, decimalsA, decimalsB);
      expect(Math.abs(tick - originalTick)).toBeLessThan(spacing);
    }
  });
});

describe('TickMath consistency test', () => {
  test('price -> tick -> price conversion consistency', () => {
    const testPrices = [
      new Decimal('0.01'),
      new Decimal('0.5'),
      new Decimal('1'),
      new Decimal('2'),
      new Decimal('10'),
    ];

    const tickSpacing = 10;
    const decimalsA = 6;
    const decimalsB = 6;

    for (const initialPrice of testPrices) {
      // Get the aligned price information
      const details = TickMath.getTickAlignedPriceDetails(
        initialPrice,
        tickSpacing,
        decimalsA,
        decimalsB
      );

      // Convert back from tick to price
      const recalculatedPrice = TickMath.getPriceFromTick({
        tick: details.tick,
        decimalsA,
        decimalsB,
      });

      // Verify that the two price values are equal within a reasonable error range
      expect(details.price.toString()).toBe(recalculatedPrice.toString());
    }
  });

  test('different decimals combinations', () => {
    const price = new Decimal('2.5');
    const tickSpacing = 60;

    const decimalCombinations = [
      { decimalsA: 6, decimalsB: 6 },
      { decimalsA: 8, decimalsB: 6 },
      { decimalsA: 6, decimalsB: 8 },
      { decimalsA: 9, decimalsB: 18 },
    ];

    for (const { decimalsA, decimalsB } of decimalCombinations) {
      const details = TickMath.getTickAlignedPriceDetails(price, tickSpacing, decimalsA, decimalsB);

      // Verify that the tick is a multiple of tickSpacing
      expect(Math.abs(details.tick % tickSpacing)).toBe(0);

      // Verify that the magnitude of the adjusted price is similar to the original price
      const magnitudeDiff = Math.abs(details.price.div(price).toNumber() - 1);

      expect(magnitudeDiff).toBeLessThan(0.01);
    }
  });
});

describe('TickMath and SqrtPriceMath combination test', () => {
  test('getTickWithPriceAndTickspacing and SqrtPriceMath consistency', () => {
    const price = new Decimal('1.2345');
    const tickSpacing = 60;
    const decimalsA = 6;
    const decimalsB = 6;

    // Get the original tick
    const originalTick = SqrtPriceMath.getTickFromPrice(price, decimalsA, decimalsB);

    // Get the aligned tick
    const alignedTick = TickMath.getTickWithPriceAndTickspacing(
      price,
      tickSpacing,
      decimalsA,
      decimalsB
    );

    // Verify that the aligned tick is the closest multiple of tickSpacing to the original tick
    const expectedAlignedTick =
      originalTick >= 0
        ? Math.ceil(originalTick / tickSpacing) * tickSpacing
        : Math.floor(originalTick / tickSpacing) * tickSpacing;

    expect(alignedTick).toBe(expectedAlignedTick);
  });

  test('the effect of baseIn parameter on price calculation', () => {
    const tick = 100;
    const decimalsA = 6;
    const decimalsB = 6;

    // baseIn = true
    const priceBaseIn = TickMath.getPriceFromTick({
      tick,
      decimalsA,
      decimalsB,
      baseIn: true,
    });

    // baseIn = false
    const priceBaseOut = TickMath.getPriceFromTick({
      tick,
      decimalsA,
      decimalsB,
      baseIn: false,
    });

    // Verify that the price when baseIn = false should be the reciprocal of the price when baseIn = true
    expect(priceBaseIn.mul(priceBaseOut).toNumber()).toBeCloseTo(1, 0.00001);
  });
});
