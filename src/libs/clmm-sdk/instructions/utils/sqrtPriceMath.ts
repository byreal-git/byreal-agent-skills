import BN from 'bn.js';
import { Decimal } from 'decimal.js';

import {
  BIT_PRECISION,
  LOG_B_2_X32,
  LOG_B_P_ERR_MARGIN_LOWER_X64,
  LOG_B_P_ERR_MARGIN_UPPER_X64,
  MAX_SQRT_PRICE_X64,
  MAX_TICK,
  MaxUint128,
  MIN_SQRT_PRICE_X64,
  MIN_TICK,
  ONE,
  U64Resolution,
  ZERO,
} from '../constants.js';

import { MathUtils } from './mathUtils.js';

function mulRightShift(val: BN, mulBy: BN): BN {
  return signedRightShift(val.mul(mulBy), 64, 256);
}

function signedLeftShift(n0: BN, shiftBy: number, bitWidth: number): BN {
  const twosN0 = n0.toTwos(bitWidth).shln(shiftBy);
  twosN0.imaskn(bitWidth + 1);
  return twosN0.fromTwos(bitWidth);
}

function signedRightShift(n0: BN, shiftBy: number, bitWidth: number): BN {
  const twoN0 = n0.toTwos(bitWidth).shrn(shiftBy);
  twoN0.imaskn(bitWidth - shiftBy + 1);
  return twoN0.fromTwos(bitWidth - shiftBy);
}

export class SqrtPriceMath {
  public static sqrtPriceX64ToPrice(
    sqrtPriceX64: BN,
    decimalsA: number,
    decimalsB: number
  ): Decimal {
    return MathUtils.x64ToDecimal(sqrtPriceX64)
      .pow(2)
      .mul(Decimal.pow(10, decimalsA - decimalsB));
  }

  public static priceToSqrtPriceX64(price: Decimal, decimalsA: number, decimalsB: number): BN {
    return MathUtils.decimalToX64(price.mul(Decimal.pow(10, decimalsB - decimalsA)).sqrt());
  }

  public static getNextSqrtPriceX64FromInput(
    sqrtPriceX64: BN,
    liquidity: BN,
    amountIn: BN,
    zeroForOne: boolean
  ): BN {
    if (!sqrtPriceX64.gt(ZERO)) {
      throw new Error('sqrtPriceX64 must greater than 0');
    }
    if (!liquidity.gt(ZERO)) {
      throw new Error('liquidity must greater than 0');
    }

    return zeroForOne
      ? this.getNextSqrtPriceFromTokenAmountARoundingUp(sqrtPriceX64, liquidity, amountIn, true)
      : this.getNextSqrtPriceFromTokenAmountBRoundingDown(sqrtPriceX64, liquidity, amountIn, true);
  }

  public static getNextSqrtPriceX64FromOutput(
    sqrtPriceX64: BN,
    liquidity: BN,
    amountOut: BN,
    zeroForOne: boolean
  ): BN {
    if (!sqrtPriceX64.gt(ZERO)) {
      throw new Error('sqrtPriceX64 must greater than 0');
    }
    if (!liquidity.gt(ZERO)) {
      throw new Error('liquidity must greater than 0');
    }

    return zeroForOne
      ? this.getNextSqrtPriceFromTokenAmountBRoundingDown(sqrtPriceX64, liquidity, amountOut, false)
      : this.getNextSqrtPriceFromTokenAmountARoundingUp(sqrtPriceX64, liquidity, amountOut, false);
  }

  private static getNextSqrtPriceFromTokenAmountARoundingUp(
    sqrtPriceX64: BN,
    liquidity: BN,
    amount: BN,
    add: boolean
  ): BN {
    if (amount.eq(ZERO)) return sqrtPriceX64;
    const liquidityLeftShift = liquidity.shln(U64Resolution);

    if (add) {
      const numerator1 = liquidityLeftShift;
      const denominator = liquidityLeftShift.add(amount.mul(sqrtPriceX64));
      if (denominator.gte(numerator1)) {
        return MathUtils.mulDivCeil(numerator1, sqrtPriceX64, denominator);
      }
      return MathUtils.mulDivRoundingUp(numerator1, ONE, numerator1.div(sqrtPriceX64).add(amount));
    } else {
      const amountMulSqrtPrice = amount.mul(sqrtPriceX64);
      if (!liquidityLeftShift.gt(amountMulSqrtPrice)) {
        throw new Error(
          'getNextSqrtPriceFromTokenAmountARoundingUp,liquidityLeftShift must gt amountMulSqrtPrice'
        );
      }
      const denominator = liquidityLeftShift.sub(amountMulSqrtPrice);
      return MathUtils.mulDivCeil(liquidityLeftShift, sqrtPriceX64, denominator);
    }
  }

  private static getNextSqrtPriceFromTokenAmountBRoundingDown(
    sqrtPriceX64: BN,
    liquidity: BN,
    amount: BN,
    add: boolean
  ): BN {
    const deltaY = amount.shln(U64Resolution);
    if (add) {
      return sqrtPriceX64.add(deltaY.div(liquidity));
    } else {
      const amountDivLiquidity = MathUtils.mulDivRoundingUp(deltaY, ONE, liquidity);
      if (!sqrtPriceX64.gt(amountDivLiquidity)) {
        throw new Error(
          'getNextSqrtPriceFromTokenAmountBRoundingDown sqrtPriceX64 must gt amountDivLiquidity'
        );
      }
      return sqrtPriceX64.sub(amountDivLiquidity);
    }
  }

  public static getSqrtPriceX64FromTick(tick: number): BN {
    if (!Number.isInteger(tick)) {
      throw new Error('tick must be integer');
    }
    if (tick < MIN_TICK || tick > MAX_TICK) {
      throw new Error('tick must be in MIN_TICK and MAX_TICK');
    }
    const tickAbs: number = tick < 0 ? tick * -1 : tick;

    let ratio: BN =
      (tickAbs & 0x1) != 0 ? new BN('18445821805675395072') : new BN('18446744073709551616');
    if ((tickAbs & 0x2) != 0) ratio = mulRightShift(ratio, new BN('18444899583751176192'));
    if ((tickAbs & 0x4) != 0) ratio = mulRightShift(ratio, new BN('18443055278223355904'));
    if ((tickAbs & 0x8) != 0) ratio = mulRightShift(ratio, new BN('18439367220385607680'));
    if ((tickAbs & 0x10) != 0) ratio = mulRightShift(ratio, new BN('18431993317065453568'));
    if ((tickAbs & 0x20) != 0) ratio = mulRightShift(ratio, new BN('18417254355718170624'));
    if ((tickAbs & 0x40) != 0) ratio = mulRightShift(ratio, new BN('18387811781193609216'));
    if ((tickAbs & 0x80) != 0) ratio = mulRightShift(ratio, new BN('18329067761203558400'));
    if ((tickAbs & 0x100) != 0) ratio = mulRightShift(ratio, new BN('18212142134806163456'));
    if ((tickAbs & 0x200) != 0) ratio = mulRightShift(ratio, new BN('17980523815641700352'));
    if ((tickAbs & 0x400) != 0) ratio = mulRightShift(ratio, new BN('17526086738831433728'));
    if ((tickAbs & 0x800) != 0) ratio = mulRightShift(ratio, new BN('16651378430235570176'));
    if ((tickAbs & 0x1000) != 0) ratio = mulRightShift(ratio, new BN('15030750278694412288'));
    if ((tickAbs & 0x2000) != 0) ratio = mulRightShift(ratio, new BN('12247334978884435968'));
    if ((tickAbs & 0x4000) != 0) ratio = mulRightShift(ratio, new BN('8131365268886854656'));
    if ((tickAbs & 0x8000) != 0) ratio = mulRightShift(ratio, new BN('3584323654725218816'));
    if ((tickAbs & 0x10000) != 0) ratio = mulRightShift(ratio, new BN('696457651848324352'));
    if ((tickAbs & 0x20000) != 0) ratio = mulRightShift(ratio, new BN('26294789957507116'));
    if ((tickAbs & 0x40000) != 0) ratio = mulRightShift(ratio, new BN('37481735321082'));

    if (tick > 0) ratio = MaxUint128.div(ratio);
    return ratio;
  }

  public static getTickFromPrice(price: Decimal, decimalsA: number, decimalsB: number): number {
    return SqrtPriceMath.getTickFromSqrtPriceX64(
      SqrtPriceMath.priceToSqrtPriceX64(price, decimalsA, decimalsB)
    );
  }

  public static getTickFromSqrtPriceX64(sqrtPriceX64: BN): number {
    if (sqrtPriceX64.gt(MAX_SQRT_PRICE_X64) || sqrtPriceX64.lt(MIN_SQRT_PRICE_X64)) {
      throw new Error('Provided sqrtPrice is not within the supported sqrtPrice range.');
    }

    const msb = sqrtPriceX64.bitLength() - 1;
    const adjustedMsb = new BN(msb - 64);
    const log2pIntegerX32 = signedLeftShift(adjustedMsb, 32, 128);

    let bit = new BN('8000000000000000', 'hex');
    let precision = 0;
    let log2pFractionX64 = new BN(0);

    let r = msb >= 64 ? sqrtPriceX64.shrn(msb - 63) : sqrtPriceX64.shln(63 - msb);

    while (bit.gt(new BN(0)) && precision < BIT_PRECISION) {
      r = r.mul(r);
      const rMoreThanTwo = r.shrn(127);
      r = r.shrn(63 + rMoreThanTwo.toNumber());
      log2pFractionX64 = log2pFractionX64.add(bit.mul(rMoreThanTwo));
      bit = bit.shrn(1);
      precision += 1;
    }

    const log2pFractionX32 = log2pFractionX64.shrn(32);

    const log2pX32 = log2pIntegerX32.add(log2pFractionX32);
    const logbpX64 = log2pX32.mul(new BN(LOG_B_2_X32));

    const tickLow = signedRightShift(
      logbpX64.sub(new BN(LOG_B_P_ERR_MARGIN_LOWER_X64)),
      64,
      128
    ).toNumber();
    const tickHigh = signedRightShift(
      logbpX64.add(new BN(LOG_B_P_ERR_MARGIN_UPPER_X64)),
      64,
      128
    ).toNumber();

    if (tickLow == tickHigh) {
      return tickLow;
    } else {
      const derivedTickHighSqrtPriceX64 = SqrtPriceMath.getSqrtPriceX64FromTick(tickHigh);
      return derivedTickHighSqrtPriceX64.lte(sqrtPriceX64) ? tickHigh : tickLow;
    }
  }
}
