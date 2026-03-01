import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';

import {
  FEE_RATE_DENOMINATOR,
  MAX_SQRT_PRICE_X64,
  MAX_TICK,
  MIN_SQRT_PRICE_X64,
  MIN_TICK,
  NEGATIVE_ONE,
  ONE,
  ZERO,
} from '../constants.js';
import { getPdaTickArrayAddress } from '../pda.js';

import { LiquidityMath } from './liquidityMath.js';
import { MathUtils } from './mathUtils.js';
import {
  StepComputations,
  Tick,
  TickArrayContainer,
  TickArrayBitmapExtensionType,
} from './models.js';
import { PoolUtils } from './poolUtils.js';
import { SqrtPriceMath } from './sqrtPriceMath.js';
import { TickQuery, TickUtils } from './tick.js';

type SwapStep = {
  sqrtPriceX64Next: BN;
  amountIn: BN;
  amountOut: BN;
  feeAmount: BN;
};

export abstract class SwapMath {
  /**
   * Calculate swap path and output amount
   *
   * @param programId - Public key address of the CLMM program
   * @param poolId - Public key address of the liquidity pool
   * @param tickArrayCache - Tick array cache with keys as tick array start indices
   * @param tickArrayBitmap - Tick array bitmap for quickly finding initialized ticks
   * @param tickarrayBitmapExtension - Tick array bitmap extension information
   * @param zeroForOne - Swap direction: true means token0 to token1, false means token1 to token0
   * @param fee - Transaction fee rate (base 1000000)
   * @param liquidity - Current liquidity amount
   * @param currentTick - Current tick position
   * @param tickSpacing - Tick spacing
   * @param currentSqrtPriceX64 - Square root of current price (Q64.64 format)
   * @param amountSpecified - Specified swap amount (positive for input amount, negative for output amount)
   * @param lastSavedTickArrayStartIndex - Last saved tick array start index
   * @param sqrtPriceLimitX64 - Square root of price limit (Q64.64 format), optional parameter
   * @param catchLiquidityInsufficient - Whether to catch liquidity insufficient errors, default false
   *
   * @returns Swap calculation result object
   * @returns allTrade - Whether all trades were completed
   * @returns amountSpecifiedRemaining - Remaining untraded amount
   * @returns amountCalculated - Calculated amount of the other token
   * @returns feeAmount - Total fees
   * @returns sqrtPriceX64 - Square root of price after swap (Q64.64 format)
   * @returns liquidity - Liquidity after swap
   * @returns tickCurrent - Tick position after swap
   * @returns accounts - List of tick array accounts that need to be accessed
   */
  public static swapCompute(
    programId: PublicKey,
    poolId: PublicKey,
    tickArrayInfo: { [key: string]: TickArrayContainer },
    tickArrayBitmap: BN[],
    tickarrayBitmapExtension: TickArrayBitmapExtensionType,
    zeroForOne: boolean,
    fee: number,
    liquidity: BN,
    currentTick: number,
    tickSpacing: number,
    currentSqrtPriceX64: BN,
    amountSpecified: BN,
    lastSavedTickArrayStartIndex: number,
    sqrtPriceLimitX64?: BN,
    catchLiquidityInsufficient = false
  ): {
    allTrade: boolean;
    amountSpecifiedRemaining: BN;
    amountCalculated: BN;
    feeAmount: BN;
    sqrtPriceX64: BN;
    liquidity: BN;
    tickCurrent: number;
    accounts: PublicKey[];
  } {
    if (amountSpecified.eq(ZERO)) {
      throw new Error('amountSpecified must not be 0');
    }
    if (!sqrtPriceLimitX64)
      sqrtPriceLimitX64 = zeroForOne ? MIN_SQRT_PRICE_X64.add(ONE) : MAX_SQRT_PRICE_X64.sub(ONE);

    if (zeroForOne) {
      if (sqrtPriceLimitX64.lt(MIN_SQRT_PRICE_X64)) {
        throw new Error('sqrtPriceX64 must greater than MIN_SQRT_PRICE_X64');
      }

      if (sqrtPriceLimitX64.gte(currentSqrtPriceX64)) {
        throw new Error('sqrtPriceX64 must smaller than current');
      }
    } else {
      if (sqrtPriceLimitX64.gt(MAX_SQRT_PRICE_X64)) {
        throw new Error('sqrtPriceX64 must smaller than MAX_SQRT_PRICE_X64');
      }

      if (sqrtPriceLimitX64.lte(currentSqrtPriceX64)) {
        throw new Error('sqrtPriceX64 must greater than current');
      }
    }

    const baseInput = amountSpecified.gt(ZERO);

    const state = {
      amountSpecifiedRemaining: amountSpecified,
      amountCalculated: ZERO,
      sqrtPriceX64: currentSqrtPriceX64,
      tick:
        currentTick > lastSavedTickArrayStartIndex
          ? Math.min(
              lastSavedTickArrayStartIndex + TickQuery.tickCount(tickSpacing) - 1,
              currentTick
            )
          : lastSavedTickArrayStartIndex,
      accounts: [] as PublicKey[],
      liquidity,
      feeAmount: new BN(0),
    };
    let tickAarrayStartIndex = lastSavedTickArrayStartIndex;
    let tickArrayCurrent = tickArrayInfo[lastSavedTickArrayStartIndex];

    // Verify if tickArrayInfo contains necessary data
    if (!tickArrayCurrent) {
      throw new Error(
        `TickArray not found in cache for startIndex: ${lastSavedTickArrayStartIndex}. Please ensure tickArrayCache is properly initialized.`
      );
    }

    let loopCount = 0;
    let t = !zeroForOne && tickArrayCurrent.data.startTickIndex === state.tick;
    while (
      !state.amountSpecifiedRemaining.eq(ZERO) &&
      !state.sqrtPriceX64.eq(sqrtPriceLimitX64)
      // state.tick < MAX_TICK &&
      // state.tick > MIN_TICK
    ) {
      if (loopCount > 10) {
        // throw Error('liquidity limit')
      }
      const step: Partial<StepComputations> = {};
      step.sqrtPriceStartX64 = state.sqrtPriceX64;

      const tickState: Tick | null = TickUtils.nextInitTick(
        tickArrayCurrent,
        state.tick,
        tickSpacing,
        zeroForOne,
        t
      );

      let nextInitTick: Tick | null = tickState ? tickState : null; // TickUtils.firstInitializedTick(tickArrayCurrent, zeroForOne)
      let tickArrayAddress: null | PublicKey = null;

      if (!nextInitTick?.liquidityGross.gtn(0)) {
        const nextInitTickArrayIndex = PoolUtils.nextInitializedTickArrayStartIndex(
          {
            tickCurrent: state.tick,
            tickSpacing,
            tickArrayBitmap,
            exBitmapInfo: tickarrayBitmapExtension,
          },
          tickAarrayStartIndex,
          zeroForOne
        );
        if (!nextInitTickArrayIndex.isExist) {
          if (catchLiquidityInsufficient) {
            return {
              allTrade: false,
              amountSpecifiedRemaining: state.amountSpecifiedRemaining,
              amountCalculated: state.amountCalculated,
              feeAmount: state.feeAmount,
              sqrtPriceX64: state.sqrtPriceX64,
              liquidity: state.liquidity,
              tickCurrent: state.tick,
              accounts: state.accounts,
            };
          }
          throw Error('swapCompute LiquidityInsufficient');
        }
        tickAarrayStartIndex = nextInitTickArrayIndex.nextStartIndex;

        const { publicKey: expectedNextTickArrayAddress } = getPdaTickArrayAddress(
          programId,
          poolId,
          tickAarrayStartIndex
        );
        tickArrayAddress = expectedNextTickArrayAddress;
        tickArrayCurrent = tickArrayInfo[tickAarrayStartIndex];

        // Verify if new tick array is in cache
        if (!tickArrayCurrent) {
          throw new Error(
            `TickArray not found in cache for startIndex: ${tickAarrayStartIndex}. Missing tick array data during swap computation.`
          );
        }

        try {
          nextInitTick = TickUtils.firstInitializedTick(tickArrayCurrent, zeroForOne);
        } catch (error) {
          throw new Error(
            `Failed to find initialized tick in array ${tickAarrayStartIndex}: ${
              error instanceof Error ? error.message : 'Unknown error'
            }`
          );
        }
      }

      step.tickNext = nextInitTick.tick;
      step.initialized = nextInitTick.liquidityGross.gtn(0);
      if (lastSavedTickArrayStartIndex !== tickAarrayStartIndex && tickArrayAddress) {
        state.accounts.push(tickArrayAddress);
        lastSavedTickArrayStartIndex = tickAarrayStartIndex;
      }
      if (step.tickNext < MIN_TICK) {
        step.tickNext = MIN_TICK;
      } else if (step.tickNext > MAX_TICK) {
        step.tickNext = MAX_TICK;
      }

      step.sqrtPriceNextX64 = SqrtPriceMath.getSqrtPriceX64FromTick(step.tickNext);
      let targetPrice: BN;
      if (
        (zeroForOne && step.sqrtPriceNextX64.lt(sqrtPriceLimitX64)) ||
        (!zeroForOne && step.sqrtPriceNextX64.gt(sqrtPriceLimitX64))
      ) {
        targetPrice = sqrtPriceLimitX64;
      } else {
        targetPrice = step.sqrtPriceNextX64;
      }
      [state.sqrtPriceX64, step.amountIn, step.amountOut, step.feeAmount] =
        SwapMath.swapStepCompute(
          state.sqrtPriceX64,
          targetPrice,
          state.liquidity,
          state.amountSpecifiedRemaining,
          fee,
          zeroForOne
        );

      state.feeAmount = state.feeAmount.add(step.feeAmount);

      if (baseInput) {
        state.amountSpecifiedRemaining = state.amountSpecifiedRemaining.sub(
          step.amountIn.add(step.feeAmount)
        );
        state.amountCalculated = state.amountCalculated.sub(step.amountOut);
      } else {
        state.amountSpecifiedRemaining = state.amountSpecifiedRemaining.add(step.amountOut);
        state.amountCalculated = state.amountCalculated.add(step.amountIn.add(step.feeAmount));
      }
      if (state.sqrtPriceX64.eq(step.sqrtPriceNextX64)) {
        if (step.initialized) {
          let liquidityNet = nextInitTick.liquidityNet;
          if (zeroForOne) liquidityNet = liquidityNet.mul(NEGATIVE_ONE);
          state.liquidity = LiquidityMath.addDelta(state.liquidity, liquidityNet);
        }

        t =
          step.tickNext != state.tick &&
          !zeroForOne &&
          tickArrayCurrent.data.startTickIndex === step.tickNext;
        state.tick = zeroForOne ? step.tickNext - 1 : step.tickNext; //
      } else if (state.sqrtPriceX64 != step.sqrtPriceStartX64) {
        const _T = SqrtPriceMath.getTickFromSqrtPriceX64(state.sqrtPriceX64);
        t = _T != state.tick && !zeroForOne && tickArrayCurrent.data.startTickIndex === _T;
        state.tick = _T;
      }
      ++loopCount;
    }

    try {
      const { nextStartIndex: tickAarrayStartIndex, isExist } = TickQuery.nextInitializedTickArray(
        state.tick,
        tickSpacing,
        zeroForOne,
        tickArrayBitmap,
        tickarrayBitmapExtension
      );
      if (isExist && lastSavedTickArrayStartIndex !== tickAarrayStartIndex) {
        state.accounts.push(
          getPdaTickArrayAddress(programId, poolId, tickAarrayStartIndex).publicKey
        );
        lastSavedTickArrayStartIndex = tickAarrayStartIndex;
      }
    } catch {
      /* empty */
    }

    return {
      allTrade: true,
      amountSpecifiedRemaining: ZERO,
      amountCalculated: state.amountCalculated,
      feeAmount: state.feeAmount,
      sqrtPriceX64: state.sqrtPriceX64,
      liquidity: state.liquidity,
      tickCurrent: state.tick,
      accounts: state.accounts,
    };
  }

  private static swapStepCompute(
    sqrtPriceX64Current: BN,
    sqrtPriceX64Target: BN,
    liquidity: BN,
    amountRemaining: BN,
    feeRate: number, // Base 1000000
    zeroForOne: boolean
  ): [BN, BN, BN, BN] {
    const swapStep: SwapStep = {
      sqrtPriceX64Next: new BN(0),
      amountIn: new BN(0),
      amountOut: new BN(0),
      feeAmount: new BN(0),
    };

    const baseInput = amountRemaining.gte(ZERO);

    if (baseInput) {
      const amountRemainingSubtractFee = MathUtils.mulDivFloor(
        amountRemaining,
        FEE_RATE_DENOMINATOR.sub(new BN(feeRate.toString())),
        FEE_RATE_DENOMINATOR
      );
      swapStep.amountIn = zeroForOne
        ? LiquidityMath.getTokenAmountAFromLiquidity(
            sqrtPriceX64Target,
            sqrtPriceX64Current,
            liquidity,
            true
          )
        : LiquidityMath.getTokenAmountBFromLiquidity(
            sqrtPriceX64Current,
            sqrtPriceX64Target,
            liquidity,
            true
          );
      if (amountRemainingSubtractFee.gte(swapStep.amountIn)) {
        swapStep.sqrtPriceX64Next = sqrtPriceX64Target;
      } else {
        swapStep.sqrtPriceX64Next = SqrtPriceMath.getNextSqrtPriceX64FromInput(
          sqrtPriceX64Current,
          liquidity,
          amountRemainingSubtractFee,
          zeroForOne
        );
      }
    } else {
      swapStep.amountOut = zeroForOne
        ? LiquidityMath.getTokenAmountBFromLiquidity(
            sqrtPriceX64Target,
            sqrtPriceX64Current,
            liquidity,
            false
          )
        : LiquidityMath.getTokenAmountAFromLiquidity(
            sqrtPriceX64Current,
            sqrtPriceX64Target,
            liquidity,
            false
          );
      if (amountRemaining.mul(NEGATIVE_ONE).gte(swapStep.amountOut)) {
        swapStep.sqrtPriceX64Next = sqrtPriceX64Target;
      } else {
        swapStep.sqrtPriceX64Next = SqrtPriceMath.getNextSqrtPriceX64FromOutput(
          sqrtPriceX64Current,
          liquidity,
          amountRemaining.mul(NEGATIVE_ONE),
          zeroForOne
        );
      }
    }

    const reachTargetPrice = sqrtPriceX64Target.eq(swapStep.sqrtPriceX64Next);

    if (zeroForOne) {
      if (!(reachTargetPrice && baseInput)) {
        swapStep.amountIn = LiquidityMath.getTokenAmountAFromLiquidity(
          swapStep.sqrtPriceX64Next,
          sqrtPriceX64Current,
          liquidity,
          true
        );
      }

      if (!(reachTargetPrice && !baseInput)) {
        swapStep.amountOut = LiquidityMath.getTokenAmountBFromLiquidity(
          swapStep.sqrtPriceX64Next,
          sqrtPriceX64Current,
          liquidity,
          false
        );
      }
    } else {
      swapStep.amountIn =
        reachTargetPrice && baseInput
          ? swapStep.amountIn
          : LiquidityMath.getTokenAmountBFromLiquidity(
              sqrtPriceX64Current,
              swapStep.sqrtPriceX64Next,
              liquidity,
              true
            );
      swapStep.amountOut =
        reachTargetPrice && !baseInput
          ? swapStep.amountOut
          : LiquidityMath.getTokenAmountAFromLiquidity(
              sqrtPriceX64Current,
              swapStep.sqrtPriceX64Next,
              liquidity,
              false
            );
    }

    if (!baseInput && swapStep.amountOut.gt(amountRemaining.mul(NEGATIVE_ONE))) {
      swapStep.amountOut = amountRemaining.mul(NEGATIVE_ONE);
    }
    if (baseInput && !swapStep.sqrtPriceX64Next.eq(sqrtPriceX64Target)) {
      swapStep.feeAmount = amountRemaining.sub(swapStep.amountIn);
    } else {
      swapStep.feeAmount = MathUtils.mulDivCeil(
        swapStep.amountIn,
        new BN(feeRate),
        FEE_RATE_DENOMINATOR.sub(new BN(feeRate))
      );
    }
    return [swapStep.sqrtPriceX64Next, swapStep.amountIn, swapStep.amountOut, swapStep.feeAmount];
  }
}
