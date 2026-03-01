import BN from 'bn.js';
import { Decimal } from 'decimal.js';
import { describe, test, expect } from 'vitest';

import { MIN_TICK, MAX_TICK, MIN_SQRT_PRICE_X64, MAX_SQRT_PRICE_X64 } from '../constants.js';

import { SqrtPriceMath } from './sqrtPriceMath.js';

describe('SqrtPriceMath basic functionality test', () => {
  test('price, sqrtPriceX64 and tick conversion', () => {
    const price = new Decimal('1.0001');
    const decimalsA = 6;
    const decimalsB = 6;

    // price -> tick
    const tick = SqrtPriceMath.getTickFromPrice(price, decimalsA, decimalsB);

    // tick -> sqrtPriceX64
    const sqrtPriceX64 = SqrtPriceMath.getSqrtPriceX64FromTick(tick);

    // sqrtPriceX64 -> price
    const calculatedPrice = SqrtPriceMath.sqrtPriceX64ToPrice(sqrtPriceX64, decimalsA, decimalsB);

    // Verify that the converted price is close to the original price
    expect(calculatedPrice.toNumber()).toBeCloseTo(price.toNumber(), 1);

    // sqrtPriceX64 -> tick
    const calculatedTick = SqrtPriceMath.getTickFromSqrtPriceX64(sqrtPriceX64);

    // Verify that the converted tick is the same as the original tick
    expect(calculatedTick).toBe(tick);
  });
});

describe('SqrtPriceMath boundary condition test', () => {
  test('MIN_TICK and MAX_TICK boundary test', () => {
    // Test minimum tick
    const minTickSqrtPrice = SqrtPriceMath.getSqrtPriceX64FromTick(MIN_TICK);
    const minTickCalculated = SqrtPriceMath.getTickFromSqrtPriceX64(minTickSqrtPrice);
    expect(minTickCalculated).toBe(MIN_TICK);

    // Test maximum tick
    const maxTickSqrtPrice = SqrtPriceMath.getSqrtPriceX64FromTick(MAX_TICK);
    const maxTickCalculated = SqrtPriceMath.getTickFromSqrtPriceX64(maxTickSqrtPrice);
    expect(maxTickCalculated).toBe(MAX_TICK);
  });

  test('MIN_SQRT_PRICE_X64 and MAX_SQRT_PRICE_X64 boundary test', () => {
    // Test minimum sqrtPriceX64
    const minTick = SqrtPriceMath.getTickFromSqrtPriceX64(MIN_SQRT_PRICE_X64);
    const recalculatedSqrtPrice = SqrtPriceMath.getSqrtPriceX64FromTick(minTick);
    // Check if it is within the reasonable error range
    expect(recalculatedSqrtPrice.gte(MIN_SQRT_PRICE_X64)).toBeTruthy();

    // Test maximum sqrtPriceX64
    const maxTick = SqrtPriceMath.getTickFromSqrtPriceX64(MAX_SQRT_PRICE_X64);
    const recalculatedMaxSqrtPrice = SqrtPriceMath.getSqrtPriceX64FromTick(maxTick);
    // Check if it is within the reasonable error range
    expect(recalculatedMaxSqrtPrice.lte(MAX_SQRT_PRICE_X64)).toBeTruthy();
  });

  test('Exception handling for out-of-bounds', () => {
    // Test for less than MIN_TICK
    expect(() => {
      SqrtPriceMath.getSqrtPriceX64FromTick(MIN_TICK - 1);
    }).toThrow();

    // Test for greater than MAX_TICK
    expect(() => {
      SqrtPriceMath.getSqrtPriceX64FromTick(MAX_TICK + 1);
    }).toThrow();

    // Test for less than MIN_SQRT_PRICE_X64
    expect(() => {
      SqrtPriceMath.getTickFromSqrtPriceX64(MIN_SQRT_PRICE_X64.sub(new BN(1)));
    }).toThrow();

    // Test for greater than MAX_SQRT_PRICE_X64
    expect(() => {
      SqrtPriceMath.getTickFromSqrtPriceX64(MAX_SQRT_PRICE_X64.add(new BN(1)));
    }).toThrow();
  });
});

describe('SqrtPriceMath precision and rounding behavior test', () => {
  test('tick boundary value rounding behavior_1', () => {
    const tick = 1000;
    const sqrtPriceX64 = SqrtPriceMath.getSqrtPriceX64FromTick(tick);

    // Create a slightly larger sqrtPriceX64 value than the current tick
    const slightlyLargerSqrtPrice = sqrtPriceX64.add(new BN(1));
    const nextTick = SqrtPriceMath.getTickFromSqrtPriceX64(slightlyLargerSqrtPrice);

    expect(nextTick).toBe(tick);
  });

  test('tick boundary value rounding behavior_2', () => {
    const tick = 1000;
    const sqrtPriceX64 = SqrtPriceMath.getSqrtPriceX64FromTick(tick);

    // Create a slightly smaller sqrtPriceX64 value than the current tick
    const slightlyLargerSqrtPrice = sqrtPriceX64.sub(new BN(1));
    const nextTick = SqrtPriceMath.getTickFromSqrtPriceX64(slightlyLargerSqrtPrice);

    expect(nextTick).toBe(tick - 1);
  });

  test('Different decimal places affect conversion', () => {
    const price = new Decimal('8.7');

    // Test different decimal place combinations
    const decimalCombinations = [
      { decimalsA: 6, decimalsB: 6 },
      { decimalsA: 8, decimalsB: 6 },
      { decimalsA: 6, decimalsB: 8 },
      { decimalsA: 9, decimalsB: 18 },
    ];

    for (const { decimalsA, decimalsB } of decimalCombinations) {
      // price -> sqrtPriceX64
      const sqrtPriceX64 = SqrtPriceMath.priceToSqrtPriceX64(price, decimalsA, decimalsB);

      // sqrtPriceX64 -> price
      const calculatedPrice = SqrtPriceMath.sqrtPriceX64ToPrice(sqrtPriceX64, decimalsA, decimalsB);

      // Verify that the converted price is close to the original price
      expect(calculatedPrice.toNumber()).toBeCloseTo(price.toNumber(), 0.01);
    }
  });

  test('Price precision boundary case', () => {
    // Test for very small and very large price values
    const extremePrices = [
      new Decimal('0.0000001'), // Very small price
      new Decimal('1000000'), // Very large price
    ];

    for (const price of extremePrices) {
      const decimalsA = 6;
      const decimalsB = 6;

      // price -> tick -> sqrtPriceX64 -> price complete loop test
      const tick = SqrtPriceMath.getTickFromPrice(price, decimalsA, decimalsB);
      const sqrtPriceX64 = SqrtPriceMath.getSqrtPriceX64FromTick(tick);
      const calculatedPrice = SqrtPriceMath.sqrtPriceX64ToPrice(sqrtPriceX64, decimalsA, decimalsB);

      // Verify that the relative error is within the acceptable range
      const relativeError = price.minus(calculatedPrice).abs().div(price);
      expect(relativeError.toNumber()).toBeLessThan(0.001); // 0.1% error
    }
  });
});

describe('SqrtPriceMath special case test', () => {
  test('Non-integer tick handling', () => {
    // Test for non-integer tick
    expect(() => {
      SqrtPriceMath.getSqrtPriceX64FromTick(1.5);
    }).toThrow();
  });
});

describe('SqrtPriceMath loop consistency test', () => {
  test('price -> tick -> price conversion consistency', () => {
    const testPrices = [
      new Decimal('0.01'),
      new Decimal('0.5'),
      new Decimal('1'),
      new Decimal('2'),
      new Decimal('10'),
      new Decimal('100'),
    ];

    const decimalsA = 6;
    const decimalsB = 9;

    for (const initialPrice of testPrices) {
      // price -> tick
      const tick = SqrtPriceMath.getTickFromPrice(initialPrice, decimalsA, decimalsB);

      // tick -> sqrtPriceX64
      const sqrtPriceX64 = SqrtPriceMath.getSqrtPriceX64FromTick(tick);

      // sqrtPriceX64 -> price
      const finalPrice = SqrtPriceMath.sqrtPriceX64ToPrice(sqrtPriceX64, decimalsA, decimalsB);

      // Verify that the relative error is within the acceptable range
      const relativeError = initialPrice.minus(finalPrice).abs().div(initialPrice);
      expect(relativeError.toNumber()).toBeLessThan(0.001); // 0.1% error
    }
  });

  test('sqrtPriceX64 -> tick -> sqrtPriceX64 conversion consistency', () => {
    // Generate a series of test sqrtPriceX64 values
    const testValues = [
      // Close to MIN_SQRT_PRICE_X64
      MIN_SQRT_PRICE_X64.add(new BN('1000')),
      // Middle value
      new BN('79226673521066979257578248091').div(new BN(2)),
      // Close to MAX_SQRT_PRICE_X64
      MAX_SQRT_PRICE_X64.sub(new BN('1000')),
    ];

    for (const initialSqrtPriceX64 of testValues) {
      // sqrtPriceX64 -> tick
      const tick = SqrtPriceMath.getTickFromSqrtPriceX64(initialSqrtPriceX64);

      // tick -> sqrtPriceX64
      const finalSqrtPriceX64 = SqrtPriceMath.getSqrtPriceX64FromTick(tick);

      // Calculate relative error
      const diff = initialSqrtPriceX64.sub(finalSqrtPriceX64).abs();

      const relativeError = diff.mul(new BN(1000000)).div(initialSqrtPriceX64);

      // Verify that the relative error is within the acceptable range
      expect(relativeError.ltn(1000)).toBeTruthy(); // 0.1% error
    }
  });
});
