import { EpochInfo } from '@solana/web3.js';
import BN from 'bn.js';
import { Decimal } from 'decimal.js';

import { Q64 } from '../constants.js';
import { IPersonalPositionLayout, IPoolLayout } from '../layout.js';

import { LiquidityMath } from './liquidityMath.js';
import { MathUtils } from './mathUtils.js';
import { SqrtPriceMath } from './sqrtPriceMath.js';
import { getTransferAmountFee, minExpirationTime } from './transfer.js';
import { Tick } from './models.js';

export interface GetTransferAmountFee {
  amount: BN;
  fee: BN | undefined;
  expirationTime: number | undefined;
}

export interface ReturnTypeGetLiquidityAmountOut {
  liquidity: BN;
  amountSlippageA: GetTransferAmountFee;
  amountSlippageB: GetTransferAmountFee;
  amountA: GetTransferAmountFee;
  amountB: GetTransferAmountFee;
  expirationTime: number | undefined;
}

export class PositionUtils {
  static getfeeGrowthInside(
    poolInfo: Pick<IPoolLayout, 'tickCurrent' | 'feeGrowthGlobalX64A' | 'feeGrowthGlobalX64B'>,
    tickLowerState: Tick,
    tickUpperState: Tick
  ): { feeGrowthInsideX64A: BN; feeGrowthInsideBX64: BN } {
    let feeGrowthBelowX64A = new BN(0);
    let feeGrowthBelowX64B = new BN(0);
    if (poolInfo.tickCurrent >= tickLowerState.tick) {
      feeGrowthBelowX64A = tickLowerState.feeGrowthOutsideX64A;
      feeGrowthBelowX64B = tickLowerState.feeGrowthOutsideX64B;
    } else {
      feeGrowthBelowX64A = poolInfo.feeGrowthGlobalX64A.sub(tickLowerState.feeGrowthOutsideX64A);
      feeGrowthBelowX64B = poolInfo.feeGrowthGlobalX64B.sub(tickLowerState.feeGrowthOutsideX64B);
    }

    let feeGrowthAboveX64A = new BN(0);
    let feeGrowthAboveX64B = new BN(0);
    if (poolInfo.tickCurrent < tickUpperState.tick) {
      feeGrowthAboveX64A = tickUpperState.feeGrowthOutsideX64A;
      feeGrowthAboveX64B = tickUpperState.feeGrowthOutsideX64B;
    } else {
      feeGrowthAboveX64A = poolInfo.feeGrowthGlobalX64A.sub(tickUpperState.feeGrowthOutsideX64A);
      feeGrowthAboveX64B = poolInfo.feeGrowthGlobalX64B.sub(tickUpperState.feeGrowthOutsideX64B);
    }

    const feeGrowthInsideX64A = MathUtils.wrappingSubU128(
      MathUtils.wrappingSubU128(poolInfo.feeGrowthGlobalX64A, feeGrowthBelowX64A),
      feeGrowthAboveX64A
    );
    const feeGrowthInsideBX64 = MathUtils.wrappingSubU128(
      MathUtils.wrappingSubU128(poolInfo.feeGrowthGlobalX64B, feeGrowthBelowX64B),
      feeGrowthAboveX64B
    );
    return { feeGrowthInsideX64A, feeGrowthInsideBX64 };
  }

  static getPositionFees(
    poolInfo: Pick<IPoolLayout, 'tickCurrent' | 'feeGrowthGlobalX64A' | 'feeGrowthGlobalX64B'>,
    positionState: IPersonalPositionLayout,
    tickLowerState: Tick,
    tickUpperState: Tick
  ): { tokenFeeAmountA: BN; tokenFeeAmountB: BN } {
    const { feeGrowthInsideX64A, feeGrowthInsideBX64 } = this.getfeeGrowthInside(
      poolInfo,
      tickLowerState,
      tickUpperState
    );

    const feeGrowthdeltaA = MathUtils.mulDivFloor(
      MathUtils.wrappingSubU128(feeGrowthInsideX64A, positionState.feeGrowthInsideLastX64A),
      positionState.liquidity,
      Q64
    );
    const tokenFeeAmountA = positionState.tokenFeesOwedA.add(feeGrowthdeltaA);

    const feeGrowthdelta1 = MathUtils.mulDivFloor(
      MathUtils.wrappingSubU128(feeGrowthInsideBX64, positionState.feeGrowthInsideLastX64B),
      positionState.liquidity,
      Q64
    );
    const tokenFeeAmountB = positionState.tokenFeesOwedB.add(feeGrowthdelta1);

    return { tokenFeeAmountA, tokenFeeAmountB };
  }

  static getAmountsFromLiquidity(params: {
    poolInfo: IPoolLayout;
    ownerPosition: IPersonalPositionLayout;
    liquidity: BN;
    slippage: number;
    add: boolean;
    epochInfo: EpochInfo;
  }): ReturnTypeGetLiquidityAmountOut {
    const { poolInfo, ownerPosition, liquidity, slippage, add, epochInfo } = params;
    const sqrtPriceX64 = poolInfo.sqrtPriceX64;
    const sqrtPriceX64A = SqrtPriceMath.getSqrtPriceX64FromTick(ownerPosition.tickLower);
    const sqrtPriceX64B = SqrtPriceMath.getSqrtPriceX64FromTick(ownerPosition.tickUpper);

    const coefficientRe = add ? 1 + slippage : 1 - slippage;

    const amounts = LiquidityMath.getAmountsFromLiquidity(
      sqrtPriceX64,
      sqrtPriceX64A,
      sqrtPriceX64B,
      liquidity,
      add
    );

    const [amountA, amountB] = [
      getTransferAmountFee(amounts.amountA, undefined, epochInfo, true),
      getTransferAmountFee(amounts.amountB, undefined, epochInfo, true),
    ];
    const [amountSlippageA, amountSlippageB] = [
      getTransferAmountFee(
        new BN(new Decimal(amounts.amountA.toString()).mul(coefficientRe).toFixed(0)),
        undefined,
        epochInfo,
        true
      ),
      getTransferAmountFee(
        new BN(new Decimal(amounts.amountB.toString()).mul(coefficientRe).toFixed(0)),
        undefined,
        epochInfo,
        true
      ),
    ];

    // const [amountA, amountB] = [
    //   getTransferAmountFee(amounts.amountA, poolInfo.mintA.extensions?.feeConfig, epochInfo, true),
    //   getTransferAmountFee(amounts.amountB, poolInfo.mintB.extensions?.feeConfig, epochInfo, true),
    // ];
    // const [amountSlippageA, amountSlippageB] = [
    //   getTransferAmountFee(
    //     new BN(new Decimal(amounts.amountA.toString()).mul(coefficientRe).toFixed(0)),
    //     poolInfo.mintA.extensions?.feeConfig,
    //     epochInfo,
    //     true,
    //   ),
    //   getTransferAmountFee(
    //     new BN(new Decimal(amounts.amountB.toString()).mul(coefficientRe).toFixed(0)),
    //     poolInfo.mintB.extensions?.feeConfig,
    //     epochInfo,
    //     true,
    //   ),
    // ];

    return {
      liquidity,
      amountA,
      amountB,
      amountSlippageA,
      amountSlippageB,
      expirationTime: minExpirationTime(amountA.expirationTime, amountB.expirationTime),
    };
  }
}
