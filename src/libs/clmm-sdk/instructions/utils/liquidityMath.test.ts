import BN from 'bn.js';
import { Decimal } from 'decimal.js';
import { describe, test, expect } from 'vitest';

import { LiquidityMath } from './liquidityMath.js';
import { SqrtPriceMath } from './sqrtPriceMath.js';

describe('LiquidityMath.getLiquidityFromTokenAmounts', () => {
  test('current price is below the lower limit - only consider tokenA', () => {
    // price: current < A < B
    const sqrtPriceCurrentX64 = new BN('100000');
    const sqrtPriceX64A = new BN('150000');
    const sqrtPriceX64B = new BN('300000');
    const amountA = new BN('1000000');
    const amountB = new BN('500000');

    // manually calculate the expected result
    const expectedLiquidity = LiquidityMath.getLiquidityFromTokenAmountA(
      sqrtPriceX64A,
      sqrtPriceX64B,
      amountA,
      false
    );

    const liquidity = LiquidityMath.getLiquidityFromTokenAmounts(
      sqrtPriceCurrentX64,
      sqrtPriceX64A,
      sqrtPriceX64B,
      amountA,
      amountB
    );

    // verify the result
    expect(liquidity.toString()).toBe(expectedLiquidity.toString());
  });

  test('current price is in the range - take the minimum of the two liquiditys', () => {
    // price: A < current < B
    const sqrtPriceX64A = new BN('100000');
    const sqrtPriceCurrentX64 = new BN('200000');
    const sqrtPriceX64B = new BN('300000');
    const amountA = new BN('1000000');
    const amountB = new BN('500000');

    // calculate the two liquiditys
    const liquidityA = LiquidityMath.getLiquidityFromTokenAmountA(
      sqrtPriceCurrentX64,
      sqrtPriceX64B,
      amountA,
      false
    );

    const liquidityB = LiquidityMath.getLiquidityFromTokenAmountB(
      sqrtPriceX64A,
      sqrtPriceCurrentX64,
      amountB
    );

    // the expected result is the minimum of the two liquiditys
    const expectedLiquidity = BN.min(liquidityA, liquidityB);

    const liquidity = LiquidityMath.getLiquidityFromTokenAmounts(
      sqrtPriceCurrentX64,
      sqrtPriceX64A,
      sqrtPriceX64B,
      amountA,
      amountB
    );

    // verify the result
    expect(liquidity.toString()).toBe(expectedLiquidity.toString());
  });

  test('current price is above the upper limit - only consider tokenB', () => {
    // price: A < B < current
    const sqrtPriceX64A = new BN('100000');
    const sqrtPriceX64B = new BN('200000');
    const sqrtPriceCurrentX64 = new BN('300000');
    const amountA = new BN('1000000');
    const amountB = new BN('500000');

    // manually calculate the expected result
    const expectedLiquidity = LiquidityMath.getLiquidityFromTokenAmountB(
      sqrtPriceX64A,
      sqrtPriceX64B,
      amountB
    );

    const liquidity = LiquidityMath.getLiquidityFromTokenAmounts(
      sqrtPriceCurrentX64,
      sqrtPriceX64A,
      sqrtPriceX64B,
      amountA,
      amountB
    );

    // verify the result
    expect(liquidity.toString()).toBe(expectedLiquidity.toString());
  });

  test('price range order adjustment - ensure A is always less than B', () => {
    // test the case of reversed price order: B < A
    const sqrtPriceCurrentX64 = new BN('200000');
    const sqrtPriceX64B = new BN('100000'); // deliberately reversed
    const sqrtPriceX64A = new BN('300000'); // deliberately reversed
    const amountA = new BN('1000000');
    const amountB = new BN('500000');

    // call in the correct order
    const expectedLiquidity = LiquidityMath.getLiquidityFromTokenAmounts(
      sqrtPriceCurrentX64,
      sqrtPriceX64A,
      sqrtPriceX64B,
      amountA,
      amountB
    );

    // call in the reversed order
    const liquidity = LiquidityMath.getLiquidityFromTokenAmounts(
      sqrtPriceCurrentX64,
      sqrtPriceX64B,
      sqrtPriceX64A,
      amountA,
      amountB
    );

    // verify the result is the same
    expect(liquidity.toString()).toBe(expectedLiquidity.toString());
  });
});

describe('LiquidityMath.getAmountsFromLiquidity', () => {
  test('current price is below the lower limit - only return tokenA', () => {
    // price: current < A < B
    const sqrtPriceCurrentX64 = new BN('100000');
    const sqrtPriceX64A = new BN('150000');
    const sqrtPriceX64B = new BN('300000');
    const liquidity = new BN('10000000');
    const roundUp = true;

    // manually calculate the expected tokenA quantity
    const expectedAmountA = LiquidityMath.getTokenAmountAFromLiquidity(
      sqrtPriceX64A,
      sqrtPriceX64B,
      liquidity,
      roundUp
    );

    const { amountA, amountB } = LiquidityMath.getAmountsFromLiquidity(
      sqrtPriceCurrentX64,
      sqrtPriceX64A,
      sqrtPriceX64B,
      liquidity,
      roundUp
    );

    // verify the result
    expect(amountA.toString()).toBe(expectedAmountA.toString());
    expect(amountB.toString()).toBe('0');
  });

  test('current price is in the range - return two tokens', () => {
    // price: A < current < B
    const sqrtPriceX64A = new BN('100000');
    const sqrtPriceCurrentX64 = new BN('200000');
    const sqrtPriceX64B = new BN('300000');
    const liquidity = new BN('10000000');
    const roundUp = true;

    // manually calculate the expected quantity
    const expectedAmountA = LiquidityMath.getTokenAmountAFromLiquidity(
      sqrtPriceCurrentX64,
      sqrtPriceX64B,
      liquidity,
      roundUp
    );

    const expectedAmountB = LiquidityMath.getTokenAmountBFromLiquidity(
      sqrtPriceX64A,
      sqrtPriceCurrentX64,
      liquidity,
      roundUp
    );

    const { amountA, amountB } = LiquidityMath.getAmountsFromLiquidity(
      sqrtPriceCurrentX64,
      sqrtPriceX64A,
      sqrtPriceX64B,
      liquidity,
      roundUp
    );

    // verify the result
    expect(amountA.toString()).toBe(expectedAmountA.toString());
    expect(amountB.toString()).toBe(expectedAmountB.toString());
  });

  test('current price is above the upper limit - only return tokenB', () => {
    // price: A < B < current
    const sqrtPriceX64A = new BN('100000');
    const sqrtPriceX64B = new BN('200000');
    const sqrtPriceCurrentX64 = new BN('300000');
    const liquidity = new BN('10000000');
    const roundUp = true;

    // manually calculate the expected tokenB quantity
    const expectedAmountB = LiquidityMath.getTokenAmountBFromLiquidity(
      sqrtPriceX64A,
      sqrtPriceX64B,
      liquidity,
      roundUp
    );

    const { amountA, amountB } = LiquidityMath.getAmountsFromLiquidity(
      sqrtPriceCurrentX64,
      sqrtPriceX64A,
      sqrtPriceX64B,
      liquidity,
      roundUp
    );

    // verify the result
    expect(amountA.toString()).toBe('0');
    expect(amountB.toString()).toBe(expectedAmountB.toString());
  });

  test('rounding behavior test - roundUp = true vs false', () => {
    const sqrtPriceX64A = new BN('100000');
    const sqrtPriceCurrentX64 = new BN('200000');
    const sqrtPriceX64B = new BN('300000');
    const liquidity = new BN('10000000');

    // use roundUp = true
    const resultRoundUp = LiquidityMath.getAmountsFromLiquidity(
      sqrtPriceCurrentX64,
      sqrtPriceX64A,
      sqrtPriceX64B,
      liquidity,
      true
    );

    // use roundUp = false
    const resultRoundDown = LiquidityMath.getAmountsFromLiquidity(
      sqrtPriceCurrentX64,
      sqrtPriceX64A,
      sqrtPriceX64B,
      liquidity,
      false
    );

    expect(new BN(resultRoundUp.amountA).gte(new BN(resultRoundDown.amountA))).toBeTruthy();
    expect(new BN(resultRoundUp.amountB).gte(new BN(resultRoundDown.amountB))).toBeTruthy();
  });
});

describe('LiquidityMath.getAmountBFromAmountA', () => {
  test('calculate tokenB from tokenA - normal case', () => {
    // price: start < current < end
    const startSqrtPriceX64 = new BN('100000');
    const currentSqrtPriceX64 = new BN('200000');
    const endSqrtPriceX64 = new BN('300000');
    const amountA = new BN('1000000');

    const amountB = LiquidityMath.getAmountBFromAmountA(
      startSqrtPriceX64,
      endSqrtPriceX64,
      currentSqrtPriceX64,
      amountA
    );

    // verify the correctness of the calculation process
    // 1. calculate the liquidity
    const liquidity = LiquidityMath.getLiquidityFromTokenAmountA(
      currentSqrtPriceX64,
      endSqrtPriceX64,
      amountA,
      false
    );

    // 2. calculate the tokenB quantity from the liquidity
    const expectedAmountB = LiquidityMath.getTokenAmountBFromLiquidity(
      startSqrtPriceX64,
      currentSqrtPriceX64,
      liquidity,
      true
    );

    // verify the result
    expect(amountB.toString()).toBe(expectedAmountB.toString());
  });

  test('current price is below the lower limit - return 0', () => {
    // price: current < start < end
    const startSqrtPriceX64 = new BN('200000');
    const currentSqrtPriceX64 = new BN('100000'); // below the lower limit
    const endSqrtPriceX64 = new BN('300000');
    const amountA = new BN('1000000');

    const amountB = LiquidityMath.getAmountBFromAmountA(
      startSqrtPriceX64,
      endSqrtPriceX64,
      currentSqrtPriceX64,
      amountA
    );

    // verify the result is 0
    expect(amountB.toString()).toBe('0');
  });

  test('current price is above the upper limit - return 0', () => {
    // price: start < end < current
    const startSqrtPriceX64 = new BN('100000');
    const endSqrtPriceX64 = new BN('200000');
    const currentSqrtPriceX64 = new BN('300000'); // above the upper limit
    const amountA = new BN('1000000');

    const amountB = LiquidityMath.getAmountBFromAmountA(
      startSqrtPriceX64,
      endSqrtPriceX64,
      currentSqrtPriceX64,
      amountA
    );

    // verify the result is 0
    expect(amountB.toString()).toBe('0');
  });

  test('price range order adjustment - ensure start is always less than end', () => {
    // test the case of reversed price order: end < start
    const endSqrtPriceX64 = new BN('100000'); // deliberately reversed
    const currentSqrtPriceX64 = new BN('150000');
    const startSqrtPriceX64 = new BN('200000'); // deliberately reversed
    const amountA = new BN('1000000');

    // call in the correct order
    const expectedAmountB = LiquidityMath.getAmountBFromAmountA(
      endSqrtPriceX64,
      startSqrtPriceX64,
      currentSqrtPriceX64,
      amountA
    );

    // call in the reversed order
    const amountB = LiquidityMath.getAmountBFromAmountA(
      startSqrtPriceX64,
      endSqrtPriceX64,
      currentSqrtPriceX64,
      amountA
    );

    // verify the result is the same
    expect(amountB.toString()).toBe(expectedAmountB.toString());
  });
});

describe('LiquidityMath.getAmountAFromAmountB', () => {
  test('calculate tokenA from tokenB - normal case', () => {
    // price: start < current < end
    const startSqrtPriceX64 = new BN('100000');
    const currentSqrtPriceX64 = new BN('200000');
    const endSqrtPriceX64 = new BN('300000');
    const amountB = new BN('500000');

    const amountA = LiquidityMath.getAmountAFromAmountB(
      startSqrtPriceX64,
      endSqrtPriceX64,
      currentSqrtPriceX64,
      amountB
    );

    // verify the correctness of the calculation process
    // 1. calculate the liquidity
    const liquidity = LiquidityMath.getLiquidityFromTokenAmountB(
      startSqrtPriceX64,
      currentSqrtPriceX64,
      amountB
    );

    // 2. calculate the tokenA quantity from the liquidity
    const expectedAmountA = LiquidityMath.getTokenAmountAFromLiquidity(
      currentSqrtPriceX64,
      endSqrtPriceX64,
      liquidity,
      true
    );

    // verify the result
    expect(amountA.toString()).toBe(expectedAmountA.toString());
  });

  test('current price is below the lower limit - return 0', () => {
    // price: current < start < end
    const startSqrtPriceX64 = new BN('200000');
    const currentSqrtPriceX64 = new BN('100000'); // below the lower limit
    const endSqrtPriceX64 = new BN('300000');
    const amountB = new BN('500000');

    const amountA = LiquidityMath.getAmountAFromAmountB(
      startSqrtPriceX64,
      endSqrtPriceX64,
      currentSqrtPriceX64,
      amountB
    );

    // verify the result is 0
    expect(amountA.toString()).toBe('0');
  });

  test('current price is above the upper limit - return 0', () => {
    // price: start < end < current
    const startSqrtPriceX64 = new BN('100000');
    const endSqrtPriceX64 = new BN('200000');
    const currentSqrtPriceX64 = new BN('300000'); // above the upper limit
    const amountB = new BN('500000');

    const amountA = LiquidityMath.getAmountAFromAmountB(
      startSqrtPriceX64,
      endSqrtPriceX64,
      currentSqrtPriceX64,
      amountB
    );

    // verify the result is 0
    expect(amountA.toString()).toBe('0');
  });

  test('price range order adjustment - ensure start is always less than end', () => {
    // test the case of reversed price order: end < start
    const endSqrtPriceX64 = new BN('100000'); // deliberately reversed
    const currentSqrtPriceX64 = new BN('150000');
    const startSqrtPriceX64 = new BN('200000'); // deliberately reversed
    const amountB = new BN('500000');

    // call in the correct order
    const expectedAmountA = LiquidityMath.getAmountAFromAmountB(
      endSqrtPriceX64,
      startSqrtPriceX64,
      currentSqrtPriceX64,
      amountB
    );

    // call in the reversed order
    const amountA = LiquidityMath.getAmountAFromAmountB(
      startSqrtPriceX64,
      endSqrtPriceX64,
      currentSqrtPriceX64,
      amountB
    );

    // verify the result is the same
    expect(amountA.toString()).toBe(expectedAmountA.toString());
  });
});

describe('LiquidityMath consistency test', () => {
  test('liquidity calculation and token quantity calculation consistency', () => {
    const startPirce = '1';
    const currentPrice = '2';
    const endPrice = '3';

    const decimalsA = 6;
    const decimalsB = 6;

    // set test parameters
    const sqrtPriceX64A = SqrtPriceMath.priceToSqrtPriceX64(
      new Decimal(startPirce),
      decimalsA,
      decimalsB
    );
    const sqrtPriceCurrentX64 = SqrtPriceMath.priceToSqrtPriceX64(
      new Decimal(currentPrice),
      decimalsA,
      decimalsB
    );
    const sqrtPriceX64B = SqrtPriceMath.priceToSqrtPriceX64(
      new Decimal(endPrice),
      decimalsA,
      decimalsB
    );
    const amountA = new BN('1000000');
    const amountB = new BN('500000');

    // 1. use token quantity to calculate liquidity
    const liquidity = LiquidityMath.getLiquidityFromTokenAmounts(
      sqrtPriceCurrentX64,
      sqrtPriceX64A,
      sqrtPriceX64B,
      amountA,
      amountB
    );

    // 2. use the calculated liquidity to calculate the token quantity
    const { amountA: calculatedAmountA, amountB: calculatedAmountB } =
      LiquidityMath.getAmountsFromLiquidity(
        sqrtPriceCurrentX64,
        sqrtPriceX64A,
        sqrtPriceX64B,
        liquidity,
        false // do not round up for comparison
      );

    // verify: the calculated token quantity should be less than or equal to the original token quantity
    // (since the liquidity depends on the smaller of the two tokens provided)
    expect(new BN(calculatedAmountA).lte(amountA)).toBeTruthy();
    expect(new BN(calculatedAmountB).lte(amountB)).toBeTruthy();

    // verify: at least one of the calculated token quantities should be close to the original token quantity
    const precisionThreshold = 0.0001; // allow 0.01% error

    const amountADiff = Math.abs(
      1 - Number(calculatedAmountA.toString()) / Number(amountA.toString())
    );

    const amountBDiff = Math.abs(
      1 - Number(calculatedAmountB.toString()) / Number(amountB.toString())
    );

    expect(amountADiff < precisionThreshold || amountBDiff < precisionThreshold).toBeTruthy();
  });

  test('consistency test between getAmountBFromAmountA and getAmountAFromAmountB', () => {
    const startPirce = '1';
    const currentPrice = '2';
    const endPrice = '3';

    const decimalsA = 6;
    const decimalsB = 6;

    // set test parameters
    const startSqrtPriceX64 = SqrtPriceMath.priceToSqrtPriceX64(
      new Decimal(startPirce),
      decimalsA,
      decimalsB
    );
    const currentSqrtPriceX64 = SqrtPriceMath.priceToSqrtPriceX64(
      new Decimal(currentPrice),
      decimalsA,
      decimalsB
    );
    const endSqrtPriceX64 = SqrtPriceMath.priceToSqrtPriceX64(
      new Decimal(endPrice),
      decimalsA,
      decimalsB
    );
    const initialAmountA = new BN('1000000');

    // 1. A -> B
    const calculatedAmountB = LiquidityMath.getAmountBFromAmountA(
      startSqrtPriceX64,
      endSqrtPriceX64,
      currentSqrtPriceX64,
      initialAmountA
    );

    // 2. B -> A
    const calculatedAmountA = LiquidityMath.getAmountAFromAmountB(
      startSqrtPriceX64,
      endSqrtPriceX64,
      currentSqrtPriceX64,
      calculatedAmountB
    );

    // verify: the calculated A quantity should be close to the original value
    // due to rounding errors, it may not be exactly equal, so use relative error
    const relativeError =
      Math.abs(Number(initialAmountA.toString()) - Number(calculatedAmountA.toString())) /
      Number(initialAmountA.toString());

    expect(relativeError).toBeLessThan(0.0001); // 允许 0.01% 误差
  });
});

describe('LiquidityMath boundary and special case test', () => {
  test('zero input test', () => {
    const sqrtPriceX64A = new BN('100000');
    const sqrtPriceCurrentX64 = new BN('200000');
    const sqrtPriceX64B = new BN('300000');

    // zero liquidity
    const zeroLiquidity = new BN(0);
    const { amountA, amountB } = LiquidityMath.getAmountsFromLiquidity(
      sqrtPriceCurrentX64,
      sqrtPriceX64A,
      sqrtPriceX64B,
      zeroLiquidity,
      true
    );

    expect(amountA.toString()).toBe('0');
    expect(amountB.toString()).toBe('0');

    // zero token quantity
    const zeroAmount = new BN(0);
    const amountAResult = LiquidityMath.getAmountAFromAmountB(
      sqrtPriceX64A,
      sqrtPriceX64B,
      sqrtPriceCurrentX64,
      zeroAmount
    );

    const amountBResult = LiquidityMath.getAmountBFromAmountA(
      sqrtPriceX64A,
      sqrtPriceX64B,
      sqrtPriceCurrentX64,
      zeroAmount
    );

    expect(amountAResult.toString()).toBe('0');
    expect(amountBResult.toString()).toBe('0');
  });

  test('extreme liquidity value test', () => {
    const sqrtPriceX64A = new BN('100000');
    const sqrtPriceCurrentX64 = new BN('200000');
    const sqrtPriceX64B = new BN('300000');

    // extremely large liquidity value
    const largeLiquidity = new BN('340282366920938463463374607431768211455'); // MaxUint128 - 1

    // this test is mainly to ensure that no exceptions or overflows are thrown
    const { amountA, amountB } = LiquidityMath.getAmountsFromLiquidity(
      sqrtPriceCurrentX64,
      sqrtPriceX64A,
      sqrtPriceX64B,
      largeLiquidity,
      true
    );

    expect(amountA.toString()).not.toBe('NaN');
    expect(amountB.toString()).not.toBe('NaN');
  });

  test('equal price point test', () => {
    // test the case of sqrtPriceX64A = sqrtPriceX64B
    const sqrtPriceX64 = new BN('200000');
    const sqrtPriceCurrentX64 = new BN('150000');
    const liquidity = new BN('10000000');

    // when the price is equal
    const { amountA, amountB } = LiquidityMath.getAmountsFromLiquidity(
      sqrtPriceCurrentX64,
      sqrtPriceX64,
      sqrtPriceX64,
      liquidity,
      true
    );

    // expected to be zero or very small
    expect(amountA.toString()).toBe('0');
    expect(amountB.toString()).toBe('0');
  });

  test('price point near current price test', () => {
    // test the case of current ≈ A or current ≈ B
    const sqrtPriceX64A = new BN('200000');
    const sqrtPriceCurrentX64 = new BN('200001'); // very close to A
    const sqrtPriceX64B = new BN('300000');
    const liquidity = new BN('10000000');

    // call the function
    const result = LiquidityMath.getAmountsFromLiquidity(
      sqrtPriceCurrentX64,
      sqrtPriceX64A,
      sqrtPriceX64B,
      liquidity,
      true
    );

    // verify the result
    expect(result.amountA.toString()).not.toBe('NaN');
    expect(result.amountB.toString()).not.toBe('NaN');
  });
});
