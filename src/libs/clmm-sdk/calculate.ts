// Various calculations

import { Decimal } from 'decimal.js';

import { MAX_TICK, MIN_TICK, PoolUtils, SqrtPriceMath, TickMath } from './instructions/index.js';

/**
 * Calculate tick-aligned price range
 * @param poolInfo
 * @param startPrice
 * @param endPrice
 * @returns
 */
export function calculateTickAlignedPriceRange(info: {
  tickSpacing: number;
  mintDecimalsA: number;
  mintDecimalsB: number;
  startPrice: string | number;
  endPrice: string | number;
}) {
  const priceInTickLower = TickMath.getTickAlignedPriceDetails(
    new Decimal(info.startPrice),
    info.tickSpacing,
    info.mintDecimalsA,
    info.mintDecimalsB
  );
  const priceInTickUpper = TickMath.getTickAlignedPriceDetails(
    new Decimal(info.endPrice),
    info.tickSpacing,
    info.mintDecimalsA,
    info.mintDecimalsB
  );
  return {
    priceInTickLower,
    priceInTickUpper,
  };
}

/**
  Using the following process, reassemble a function that takes a tick + tickSpacing and returns a new price

// tick + tickSpacing -> sqrtPriceX64
SqrtPriceMath.getSqrtPriceX64FromTick;
// sqrtPriceX64 -> price
SqrtPriceMath.sqrtPriceX64ToPrice;
 */

export function calculatePriceFromTick(
  tick: number | string,
  mintDecimalsA: number,
  mintDecimalsB: number,
  tickSpacing: number | string
) {
  let tickWithSpacing = Number(tick) + Number(tickSpacing);

  // If tickWithSpacing is out of MIN_TICK and MAX_TICK range, use the nearest max or min tick
  if (tickWithSpacing < MIN_TICK || tickWithSpacing > MAX_TICK) {
    console.warn(`!!! tickWithSpacing ${tickWithSpacing} is out of range, using the nearest tick !!!`);
    tickWithSpacing = Number(tick);
  }
  const sqrtPriceX64 = SqrtPriceMath.getSqrtPriceX64FromTick(tickWithSpacing);
  const price = SqrtPriceMath.sqrtPriceX64ToPrice(sqrtPriceX64, mintDecimalsA, mintDecimalsB);
  return {
    price: price.toString(),
    tick: tickWithSpacing,
  };
}

/**
 * Calculate the available price range from a TickSpacing, returns an object containing min and max prices
 * @param tickSpacing
 * @returns
 */
export function calculatePriceRangeFromTickSpacing(tickSpacing: number, mintDecimalsA: number, mintDecimalsB: number) {
  const { minTickBoundary, maxTickBoundary } = PoolUtils.tickRange(tickSpacing);
  return {
    min: calculatePriceFromTick(minTickBoundary, mintDecimalsA, mintDecimalsB, tickSpacing),
    max: calculatePriceFromTick(maxTickBoundary, mintDecimalsA, mintDecimalsB, tickSpacing),
  };
}
