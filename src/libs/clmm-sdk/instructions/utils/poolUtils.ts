import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';

import { MAX_TICK, MIN_TICK, NEGATIVE_ONE } from '../constants.js';
import { IAmmConfigLayout } from '../layout.js';
import { IPoolLayoutWithId } from '../models.js';
import { getPdaTickArrayAddress } from '../pda.js';

import { TickArrayContainer, TickArrayBitmapExtensionType } from './models.js';
import { SwapMath } from './swapMath.js';
import { TickQuery, TickUtils } from './tick.js';
import { TickArrayBitmap, TickArrayBitmapExtensionUtils } from './tickarrayBitmap.js';

export class PoolUtils {
  // Used to check if a set of tickarray start indices exceed the boundary range of the default bitmap
  public static isOverflowDefaultTickarrayBitmap(
    tickSpacing: number,
    tickarrayStartIndexs: number[]
  ): boolean {
    const { maxTickBoundary, minTickBoundary } = this._tickRange(tickSpacing);

    for (const tickIndex of tickarrayStartIndexs) {
      const tickarrayStartIndex = TickUtils.getTickArrayStartIndexByTick(tickIndex, tickSpacing);

      if (tickarrayStartIndex >= maxTickBoundary || tickarrayStartIndex < minTickBoundary) {
        return true;
      }
    }

    return false;
  }

  public static _tickRange(tickSpacing: number): {
    maxTickBoundary: number;
    minTickBoundary: number;
  } {
    let maxTickBoundary = TickArrayBitmap.maxTickInTickarrayBitmap(tickSpacing);
    let minTickBoundary = -maxTickBoundary;

    if (maxTickBoundary > MAX_TICK) {
      maxTickBoundary =
        TickQuery.getArrayStartIndex(MAX_TICK, tickSpacing) + TickQuery.tickCount(tickSpacing);
    }
    if (minTickBoundary < MIN_TICK) {
      minTickBoundary = TickQuery.getArrayStartIndex(MIN_TICK, tickSpacing);
    }
    return { maxTickBoundary, minTickBoundary };
  }

  /**
   * Calculate the maximum and minimum ticks selectable by users in the UI
   * Unlike _tickRange, this method directly returns the available tick value range, not the tickarray boundaries
   *
   * @param tickSpacing tick spacing
   * @returns Maximum and minimum tick values selectable by users
   */
  public static tickRange(tickSpacing: number): {
    maxTickBoundary: number;
    minTickBoundary: number;
  } {
    // Use protocol-defined hard boundaries
    let maxTickBoundary = MAX_TICK;
    let minTickBoundary = MIN_TICK;

    // Ensure returned tick values are divisible by tickSpacing to meet UI selection requirements
    maxTickBoundary = Math.floor(maxTickBoundary / tickSpacing) * tickSpacing;
    minTickBoundary = Math.ceil(minTickBoundary / tickSpacing) * tickSpacing;

    return { maxTickBoundary, minTickBoundary };
  }

  public static nextInitializedTickArrayStartIndex(
    poolInfo: {
      tickCurrent: number;
      tickSpacing: number;
      tickArrayBitmap: BN[];
      exBitmapInfo: TickArrayBitmapExtensionType;
    },
    lastTickArrayStartIndex: number,
    zeroForOne: boolean
  ): { isExist: boolean; nextStartIndex: number } {
    // Start scanning from the provided lastTickArrayStartIndex instead of recomputing from tickCurrent
    // This avoids skipping the immediate adjacent array when tickCurrent happens to equal a start index.

    while (true) {
      const { isInit: startIsInit, tickIndex: startIndex } =
        TickArrayBitmap.nextInitializedTickArrayStartIndex(
          TickUtils.mergeTickArrayBitmap(poolInfo.tickArrayBitmap),
          lastTickArrayStartIndex,
          poolInfo.tickSpacing,
          zeroForOne
        );
      if (startIsInit) {
        return { isExist: true, nextStartIndex: startIndex };
      }
      lastTickArrayStartIndex = startIndex;

      const { isInit, tickIndex } =
        TickArrayBitmapExtensionUtils.nextInitializedTickArrayFromOneBitmap(
          lastTickArrayStartIndex,
          poolInfo.tickSpacing,
          zeroForOne,
          poolInfo.exBitmapInfo
        );
      if (isInit) return { isExist: true, nextStartIndex: tickIndex };

      lastTickArrayStartIndex = tickIndex;

      if (lastTickArrayStartIndex < MIN_TICK || lastTickArrayStartIndex > MAX_TICK)
        return { isExist: false, nextStartIndex: 0 };
    }
  }

  public static getFirstInitializedTickArray(
    poolInfo: {
      programId: PublicKey;
      poolId: PublicKey;
      tickCurrent: number;
      tickSpacing: number;
      tickArrayBitmap: BN[];
      exBitmapInfo: TickArrayBitmapExtensionType;
    },
    zeroForOne: boolean
  ):
    | { isExist: true; startIndex: number; nextAccountMeta: PublicKey }
    | { isExist: false; startIndex: undefined; nextAccountMeta: undefined } {
    const { isInitialized, startIndex } = PoolUtils.isOverflowDefaultTickarrayBitmap(
      poolInfo.tickSpacing,
      [poolInfo.tickCurrent]
    )
      ? TickArrayBitmapExtensionUtils.checkTickArrayIsInit(
          TickQuery.getArrayStartIndex(poolInfo.tickCurrent, poolInfo.tickSpacing),
          poolInfo.tickSpacing,
          poolInfo.exBitmapInfo
        )
      : TickUtils.checkTickArrayIsInitialized(
          TickUtils.mergeTickArrayBitmap(poolInfo.tickArrayBitmap),
          poolInfo.tickCurrent,
          poolInfo.tickSpacing
        );

    if (isInitialized) {
      const { publicKey: address } = getPdaTickArrayAddress(
        poolInfo.programId,
        poolInfo.poolId,
        startIndex
      );
      return {
        isExist: true,
        startIndex,
        nextAccountMeta: address,
      };
    }
    const { isExist, nextStartIndex } = this.nextInitializedTickArrayStartIndex(
      poolInfo,
      TickQuery.getArrayStartIndex(poolInfo.tickCurrent, poolInfo.tickSpacing),
      zeroForOne
    );
    if (isExist) {
      const { publicKey: address } = getPdaTickArrayAddress(
        poolInfo.programId,
        poolInfo.poolId,
        nextStartIndex
      );
      return {
        isExist: true,
        startIndex: nextStartIndex,
        nextAccountMeta: address,
      };
    }
    return { isExist: false, nextAccountMeta: undefined, startIndex: undefined };
  }

  /**
   * Calculate the output amount and required account list for token swap
   *
   * This function is the core of CLMM (Concentrated Liquidity Market Maker) swap logic, used to calculate the expected output amount for a given input amount,
   * and determine all tick array accounts that need to be accessed during trade execution.
   *
   * @param params Swap calculation parameter object
   * @param params.poolInfo - Complete information of the liquidity pool, including current price, liquidity, tick and other states
   * @param params.exBitmapInfo - Tick array bitmap extension information, used to handle ticks beyond the default range
   * @param params.ammConfig - AMM configuration information, including transaction fee rates and other parameters
   * @param params.tickArrayInfo - Loaded tick array information cache, with keys as tick array start indices
   * @param params.inputTokenMint - Input token mint address, used to determine trade direction
   * @param params.inputAmount - Input token amount (using minimum units)
   * @param params.sqrtPriceLimitX64 - Optional price limit, representing the worst price for the trade (Q64.64 format)
   * @param params.catchLiquidityInsufficient - Whether to catch liquidity insufficient situations, default false
   *
   * @returns Swap calculation result object
   * @returns allTrade - Boolean value indicating whether the specified input amount can be fully traded
   *                    true: All amount can be traded
   *                    false: Only partial trading due to insufficient liquidity or price limit
   * @returns expectedAmountOut - Expected output token amount to be obtained (using minimum units)
   * @returns remainingAccounts - List of all tick array account addresses that need to be accessed during trading
   *                             These accounts need to be passed as remaining accounts in the trade instruction
   * @returns executionPrice - Final price after trade execution (square root price in Q64.64 format)
   * @returns feeAmount - Total fees generated by the trade (using input token minimum units)
   *
   * @throws Error Throws 'Invalid tick array' error when no valid tick array is found
   */
  public static getOutputAmountAndRemainAccounts(params: {
    poolInfo: IPoolLayoutWithId;
    exBitmapInfo: TickArrayBitmapExtensionType;
    ammConfig: IAmmConfigLayout;
    tickArrayInfo: { [key: string]: TickArrayContainer };
    inputTokenMint: PublicKey;
    inputAmount: BN;
    sqrtPriceLimitX64?: BN;
    catchLiquidityInsufficient?: boolean;
  }): {
    allTrade: boolean;
    expectedAmountOut: BN;
    remainingAccounts: PublicKey[];
    executionPrice: BN;
    feeAmount: BN;
  } {
    const {
      poolInfo,
      exBitmapInfo,
      ammConfig,
      tickArrayInfo,
      inputTokenMint,
      inputAmount,
      sqrtPriceLimitX64,
      catchLiquidityInsufficient = false,
    } = params;

    // Step 1: Determine trade direction
    // zeroForOne = true: means trading tokenA (token0) for tokenB (token1), price decreases
    // zeroForOne = false: means trading tokenB (token1) for tokenA (token0), price increases
    const zeroForOne = inputTokenMint.toBase58() === poolInfo.mintA.toBase58();

    // Step 2: Initialize account list to store all tick array accounts needed during trading
    const allNeededAccounts: PublicKey[] = [];

    // Step 3: Find the first tick array that needs to be accessed
    // Based on current tick position and trade direction, find the array containing current tick or next initialized tick
    const {
      isExist,
      startIndex: firstTickArrayStartIndex,
      nextAccountMeta,
    } = this.getFirstInitializedTickArray(
      {
        programId: poolInfo.programId,
        poolId: poolInfo.poolId,
        tickCurrent: poolInfo.tickCurrent,
        tickSpacing: poolInfo.tickSpacing,
        tickArrayBitmap: poolInfo.tickArrayBitmap,
        exBitmapInfo,
      },
      zeroForOne
    );

    // If no valid tick array is found, it indicates abnormal pool state or no liquidity
    if (!isExist || firstTickArrayStartIndex === undefined || !nextAccountMeta)
      throw new Error('Invalid tick array');

    // Step 4: Add the first tick array account to the list
    allNeededAccounts.push(nextAccountMeta);

    // Step 5: Execute the core logic of swap calculation
    // SwapMath.swapCompute simulates the entire swap process, calculating:
    // - Actual tradable amount
    // - Output token amount
    // - Other tick array accounts needed on the trade path
    // - Final execution price and fees
    const {
      allTrade,
      amountCalculated: outputAmount,
      accounts: reaminAccounts,
      sqrtPriceX64: executionPrice,
      feeAmount,
    } = SwapMath.swapCompute(
      poolInfo.programId,
      poolInfo.poolId,
      tickArrayInfo,
      poolInfo.tickArrayBitmap,
      exBitmapInfo,
      zeroForOne,
      ammConfig.tradeFeeRate,
      poolInfo.liquidity,
      poolInfo.tickCurrent,
      poolInfo.tickSpacing,
      poolInfo.sqrtPriceX64,
      inputAmount,
      firstTickArrayStartIndex,
      sqrtPriceLimitX64,
      catchLiquidityInsufficient
    );

    // Step 6: Add other necessary accounts discovered during swap to the list
    allNeededAccounts.push(...reaminAccounts);

    // Step 7: Return calculation results
    // Note: outputAmount is negative (indicating outflow), needs to be multiplied by -1 to convert to positive
    return {
      allTrade,
      expectedAmountOut: outputAmount.mul(NEGATIVE_ONE),
      remainingAccounts: allNeededAccounts,
      executionPrice,
      feeAmount,
    };
  }

  /**
   * Calculate the required input token amount and account list for exact output
   *
   * This function is used for "exact output" scenarios, where the user specifies the desired output token amount,
   * and the function calculates how many tokens need to be input to obtain the specified output amount.
   *
   * @param params Swap calculation parameter object
   * @param params.poolInfo - Complete information of the liquidity pool
   * @param params.exBitmapInfo - Tick array bitmap extension information
   * @param params.ammConfig - AMM configuration information
   * @param params.tickArrayInfo - Loaded tick array information cache
   * @param params.outputTokenMint - Output token mint address
   * @param params.outputAmount - Expected output token amount (using minimum units)
   * @param params.sqrtPriceLimitX64 - Optional price limit (Q64.64 format)
   * @param params.catchLiquidityInsufficient - Whether to catch liquidity insufficient situations
   *
   * @returns Swap calculation result object
   * @returns allTrade - Whether the specified output amount can be fully obtained
   * @returns expectedAmountIn - Required input token amount (including fees)
   * @returns remainingAccounts - List of tick array accounts that need to be accessed during trading
   * @returns executionPrice - Final price after trade execution
   * @returns feeAmount - Total fees generated by the trade
   */
  public static getInputAmountAndRemainAccounts(params: {
    poolInfo: IPoolLayoutWithId;
    exBitmapInfo: TickArrayBitmapExtensionType;
    ammConfig: IAmmConfigLayout;
    tickArrayInfo: { [key: string]: TickArrayContainer };
    outputTokenMint: PublicKey;
    outputAmount: BN;
    sqrtPriceLimitX64?: BN;
    catchLiquidityInsufficient?: boolean;
  }): {
    allTrade: boolean;
    expectedAmountIn: BN;
    remainingAccounts: PublicKey[];
    executionPrice: BN;
    feeAmount: BN;
  } {
    const {
      poolInfo,
      exBitmapInfo,
      ammConfig,
      tickArrayInfo,
      outputTokenMint,
      outputAmount,
      sqrtPriceLimitX64,
      catchLiquidityInsufficient = false,
    } = params;

    // 步骤1: 确定交易方向
    // 注意：对于精确输出，交易方向的判断基于输出代币
    // 如果输出 tokenB，则需要输入 tokenA（zeroForOne = true）
    // 如果输出 tokenA，则需要输入 tokenB（zeroForOne = false）
    const zeroForOne = outputTokenMint.toBase58() === poolInfo.mintB.toBase58();

    // 步骤2: 初始化账户列表
    const allNeededAccounts: PublicKey[] = [];

    // 步骤3: 查找第一个需要访问的 tick 数组
    const {
      isExist,
      startIndex: firstTickArrayStartIndex,
      nextAccountMeta,
    } = this.getFirstInitializedTickArray(
      {
        programId: poolInfo.programId,
        poolId: poolInfo.poolId,
        tickCurrent: poolInfo.tickCurrent,
        tickSpacing: poolInfo.tickSpacing,
        tickArrayBitmap: poolInfo.tickArrayBitmap,
        exBitmapInfo,
      },
      zeroForOne
    );

    if (!isExist || firstTickArrayStartIndex === undefined || !nextAccountMeta)
      throw new Error('Invalid tick array');

    // Step 4: Add the first tick array account to the list
    allNeededAccounts.push(nextAccountMeta);

    // 步骤5: 执行交换计算
    // 对于精确输出，amountSpecified 需要是负数
    const amountSpecified = outputAmount.mul(NEGATIVE_ONE);

    const {
      allTrade,
      amountCalculated: inputAmount,
      accounts: reaminAccounts,
      sqrtPriceX64: executionPrice,
      feeAmount,
    } = SwapMath.swapCompute(
      poolInfo.programId,
      poolInfo.poolId,
      tickArrayInfo,
      poolInfo.tickArrayBitmap,
      exBitmapInfo,
      zeroForOne,
      ammConfig.tradeFeeRate,
      poolInfo.liquidity,
      poolInfo.tickCurrent,
      poolInfo.tickSpacing,
      poolInfo.sqrtPriceX64,
      amountSpecified,
      firstTickArrayStartIndex,
      sqrtPriceLimitX64,
      catchLiquidityInsufficient
    );

    // 步骤6: 将其他必需账户添加到列表中
    allNeededAccounts.push(...reaminAccounts);

    // 步骤7: 返回计算结果
    // 注意：对于精确输出，inputAmount 包含了手续费
    return {
      allTrade,
      expectedAmountIn: inputAmount,
      remainingAccounts: allNeededAccounts,
      executionPrice,
      feeAmount,
    };
  }
}
