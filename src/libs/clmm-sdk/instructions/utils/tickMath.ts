import BN from 'bn.js';
import { Decimal } from 'decimal.js';

import { SqrtPriceMath } from './sqrtPriceMath.js';

export interface TickAlignedPriceDetails {
  tick: number;
  sqrtPriceX64: BN;
  price: Decimal;
}
export class TickMath {
  // Convert price to tick
  public static getTickWithPriceAndTickspacing(
    price: Decimal,
    tickSpacing: number,
    mintDecimalsA: number,
    mintDecimalsB: number
  ): number {
    const tick = SqrtPriceMath.getTickFromSqrtPriceX64(
      SqrtPriceMath.priceToSqrtPriceX64(price, mintDecimalsA, mintDecimalsB)
    );
    let result = tick / tickSpacing;
    if (result < 0) {
      result = Math.floor(result);
    } else {
      result = Math.ceil(result);
    }
    return result * tickSpacing;
  }

  public static getPriceFromTick(params: {
    tick: number;
    decimalsA: number;
    decimalsB: number;
    baseIn?: boolean;
  }): Decimal {
    const { tick, decimalsA, decimalsB, baseIn = true } = params;
    const tickSqrtPriceX64 = SqrtPriceMath.getSqrtPriceX64FromTick(tick);
    const tickPrice = SqrtPriceMath.sqrtPriceX64ToPrice(tickSqrtPriceX64, decimalsA, decimalsB);

    return baseIn ? tickPrice : new Decimal(1).div(tickPrice);
  }

  // Align price to the nearest valid tick and return related data
  public static getTickAlignedPriceDetails(
    price: Decimal,
    tickSpacing: number,
    mintDecimalsA: number,
    mintDecimalsB: number
  ): TickAlignedPriceDetails {
    const tick = TickMath.getTickWithPriceAndTickspacing(
      price,
      tickSpacing,
      mintDecimalsA,
      mintDecimalsB
    );
    const sqrtPriceX64 = SqrtPriceMath.getSqrtPriceX64FromTick(tick);
    const roundedPrice = SqrtPriceMath.sqrtPriceX64ToPrice(
      sqrtPriceX64,
      mintDecimalsA,
      mintDecimalsB
    );
    return {
      tick,
      sqrtPriceX64,
      price: roundedPrice,
    };
  }
}
