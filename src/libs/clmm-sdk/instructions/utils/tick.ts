import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
import { Decimal } from 'decimal.js';

import { TICK_ARRAY_SIZE, TICK_ARRAY_BITMAP_SIZE } from '../../constants.js';
import { MAX_TICK, MIN_TICK } from '../constants.js';
import { IPoolLayout } from '../layout.js';
import { TickArrayBitmapExtensionUtils } from './tickarrayBitmap.js';
import { getPdaTickArrayAddress } from '../pda.js';

import {
  ReturnTypeGetPriceAndTick,
  Tick,
  TickArray,
  TickArrayBitmapExtensionType,
  TickArrayState,
  TickState,
  TickArrayContainer,
  DynTickArray,
} from './models.js';
import { SqrtPriceMath } from './sqrtPriceMath.js';
import { TickMath } from './tickMath.js';

export class TickUtils {
  // Calculate the address of the TickArray corresponding to the given tick index
  public static getTickArrayAddressByTick(
    programId: PublicKey,
    poolId: PublicKey,
    tickIndex: number,
    tickSpacing: number
  ): PublicKey {
    const startIndex = TickUtils.getTickArrayStartIndexByTick(tickIndex, tickSpacing);
    const { publicKey: tickArrayAddress } = getPdaTickArrayAddress(programId, poolId, startIndex);
    return tickArrayAddress;
  }

  // Calculate the offset of the given tick index within the corresponding TickArray
  public static getTickOffsetInArray(tickIndex: number, tickSpacing: number): number {
    if (tickIndex % tickSpacing != 0) {
      throw new Error('tickIndex % tickSpacing not equal 0');
    }
    const startTickIndex = TickUtils.getTickArrayStartIndexByTick(tickIndex, tickSpacing);
    const offsetInArray = Math.floor((tickIndex - startTickIndex) / tickSpacing);
    if (offsetInArray < 0 || offsetInArray >= TICK_ARRAY_SIZE) {
      throw new Error('tick offset in array overflow');
    }
    return offsetInArray;
  }

  // Calculate the index position of the TickArray corresponding to the given tick index in the bitmap.
  public static getTickArrayBitIndex(tickIndex: number, tickSpacing: number): number {
    const ticksInArray = TickQuery.tickCount(tickSpacing);

    let startIndex: number = tickIndex / ticksInArray;
    if (tickIndex < 0 && tickIndex % ticksInArray != 0) {
      startIndex = Math.ceil(startIndex) - 1;
    } else {
      startIndex = Math.floor(startIndex);
    }
    return startIndex;
  }

  // Calculate the start index of the TickArray corresponding to the given tick index
  public static getTickArrayStartIndexByTick(tickIndex: number, tickSpacing: number): number {
    return this.getTickArrayBitIndex(tickIndex, tickSpacing) * TickQuery.tickCount(tickSpacing);
  }

  // Calculate the offset of the TickArray corresponding to the given tick index in the default bitmap
  public static getTickArrayOffsetInBitmapByTick(tick: number, tickSpacing: number): number {
    const multiplier = tickSpacing * TICK_ARRAY_SIZE;
    const compressed = Math.floor(tick / multiplier) + 512;
    return Math.abs(compressed);
  }

  // Check if the TickArray corresponding to the given tick index has been initialized
  public static checkTickArrayIsInitialized(
    bitmap: BN,
    tick: number,
    tickSpacing: number
  ): {
    isInitialized: boolean;
    startIndex: number;
  } {
    const multiplier = tickSpacing * TICK_ARRAY_SIZE;
    const compressed = Math.floor(tick / multiplier) + 512;
    const bitPos = Math.abs(compressed);
    return {
      isInitialized: bitmap.testn(bitPos),
      startIndex: (bitPos - 512) * multiplier,
    };
  }

  // Calculate the start index of the next TickArray
  // Can be ignored, referenced by nextInitializedTick, but nextInitializedTick is not used
  public static getNextTickArrayStartIndex(
    lastTickArrayStartIndex: number,
    tickSpacing: number,
    zeroForOne: boolean
  ): number {
    return zeroForOne
      ? lastTickArrayStartIndex - tickSpacing * TICK_ARRAY_SIZE
      : lastTickArrayStartIndex + tickSpacing * TICK_ARRAY_SIZE;
  }

  // Merge bitmaps of multiple TickArrays
  public static mergeTickArrayBitmap(bns: BN[]): BN {
    let b = new BN(0);
    for (let i = 0; i < bns.length; i++) {
      b = b.add(bns[i].shln(64 * i));
    }
    return b;
  }

  /**
   * Search for initialized TickArrays around the current position to find the starting indices of a specified number of initialized TickArrays
   *
   * @param tickArrayBitmap - Main tick array bitmap used to mark initialized tick arrays
   * @param exTickArrayBitmap - Extended tick array bitmap containing positive and negative direction extension bitmap information
   * @param tickSpacing - Tick spacing
   * @param tickArrayStartIndex - Starting tick array index for the search
   * @param expectedCount - Expected number of initialized TickArrays to find
   *
   * @returns Array of initialized TickArray starting indices
   *
   * @description
   * This function is used to locate active liquidity around the current price. It searches on both sides of the given starting position:
   * - Search right (higher tick positions)
   * - Search left (lower tick positions)
   * By combining the search results from both directions, it provides the liquidity distribution around the current price
   */
  public static getInitializedTickArrayInRange(
    tickArrayBitmap: BN[],
    exTickArrayBitmap: TickArrayBitmapExtensionType,
    tickSpacing: number,
    tickArrayStartIndex: number,
    expectedCount: number
  ): number[] {
    const tickArrayOffset = Math.floor(tickArrayStartIndex / (tickSpacing * TICK_ARRAY_SIZE));
    return [
      // find right of currenct offset
      ...TickUtils.searchLowBitFromStart(
        tickArrayBitmap,
        exTickArrayBitmap,
        tickArrayOffset - 1,
        expectedCount,
        tickSpacing
      ),

      // find left of current offset
      ...TickUtils.searchHightBitFromStart(
        tickArrayBitmap,
        exTickArrayBitmap,
        tickArrayOffset,
        expectedCount,
        tickSpacing
      ),
    ];
  }

  // Get start indices of all initialized TickArrays
  public static getAllInitializedTickArrayStartIndex(
    tickArrayBitmap: BN[],
    exTickArrayBitmap: TickArrayBitmapExtensionType,
    tickSpacing: number
  ): number[] {
    // find from offset 0 to 1024
    return TickUtils.searchHightBitFromStart(
      tickArrayBitmap,
      exTickArrayBitmap,
      -7680,
      TICK_ARRAY_BITMAP_SIZE,
      tickSpacing
    );
  }

  // Get information of all initialized TickArrays
  public static getAllInitializedTickArrayInfo(
    programId: PublicKey,
    poolId: PublicKey,
    tickArrayBitmap: BN[],
    exTickArrayBitmap: TickArrayBitmapExtensionType,
    tickSpacing: number
  ): {
    tickArrayStartIndex: number;
    tickArrayAddress: PublicKey;
  }[] {
    const result: {
      tickArrayStartIndex: number;
      tickArrayAddress: PublicKey;
    }[] = [];
    const allInitializedTickArrayIndex: number[] = TickUtils.getAllInitializedTickArrayStartIndex(
      tickArrayBitmap,
      exTickArrayBitmap,
      tickSpacing
    );
    for (const startIndex of allInitializedTickArrayIndex) {
      const { publicKey: address } = getPdaTickArrayAddress(programId, poolId, startIndex);
      result.push({
        tickArrayStartIndex: startIndex,
        tickArrayAddress: address,
      });
    }
    return result;
  }

  // Get all initialized Ticks in the given TickArray
  public static getAllInitializedTickInTickArray(tickArray: TickArrayState): TickState[] {
    return tickArray.ticks.filter((i) => i.liquidityGross.gtn(0));
  }

  /**
   * Search for initialized TickArrays to the left from the starting position
   * Used to locate active liquidity near the current price
   */
  public static searchLowBitFromStart(
    tickArrayBitmap: BN[],
    exTickArrayBitmap: TickArrayBitmapExtensionType,
    currentTickArrayBitStartIndex: number,
    expectedCount: number,
    tickSpacing: number
  ): number[] {
    const tickArrayBitmaps = [
      ...[...exTickArrayBitmap.negativeTickArrayBitmap].reverse(),
      tickArrayBitmap.slice(0, 8),
      tickArrayBitmap.slice(8, 16),
      ...exTickArrayBitmap.positiveTickArrayBitmap,
    ].map((i) => TickUtils.mergeTickArrayBitmap(i));
    const result: number[] = [];
    while (currentTickArrayBitStartIndex >= -7680) {
      const arrayIndex = Math.floor((currentTickArrayBitStartIndex + 7680) / 512);
      const searchIndex = (currentTickArrayBitStartIndex + 7680) % 512;

      if (tickArrayBitmaps[arrayIndex].testn(searchIndex))
        result.push(currentTickArrayBitStartIndex);

      currentTickArrayBitStartIndex--;
      if (result.length === expectedCount) break;
    }

    const tickCount = TickQuery.tickCount(tickSpacing);
    return result.map((i) => i * tickCount);
  }

  /**
   * Search for initialized TickArrays to the right from the starting position
   * Used to locate active liquidity near the current price
   */
  public static searchHightBitFromStart(
    tickArrayBitmap: BN[],
    exTickArrayBitmap: TickArrayBitmapExtensionType,
    currentTickArrayBitStartIndex: number,
    expectedCount: number,
    tickSpacing: number
  ): number[] {
    const tickArrayBitmaps = [
      ...[...exTickArrayBitmap.negativeTickArrayBitmap].reverse(),
      tickArrayBitmap.slice(0, 8),
      tickArrayBitmap.slice(8, 16),
      ...exTickArrayBitmap.positiveTickArrayBitmap,
    ].map((i) => TickUtils.mergeTickArrayBitmap(i));
    const result: number[] = [];
    while (currentTickArrayBitStartIndex < 7680) {
      const arrayIndex = Math.floor((currentTickArrayBitStartIndex + 7680) / 512);
      const searchIndex = (currentTickArrayBitStartIndex + 7680) % 512;

      if (tickArrayBitmaps[arrayIndex].testn(searchIndex))
        result.push(currentTickArrayBitStartIndex);

      currentTickArrayBitStartIndex++;
      if (result.length === expectedCount) break;
    }

    const tickCount = TickQuery.tickCount(tickSpacing);
    return result.map((i) => i * tickCount);
  }

  // Check if the given tick index is out of bounds
  public static checkIsOutOfBoundary(tick: number): boolean {
    return tick < MIN_TICK || tick > MAX_TICK;
  }

  /**
   * Get the next initialized Tick
   * Used to locate active liquidity near the current price
   * Now supports both fixed and dynamic tick arrays through the container pattern
   */
  public static nextInitTick(
    tickArrayCurrent: TickArrayContainer,
    currentTickIndex: number,
    tickSpacing: number,
    zeroForOne: boolean,
    t: boolean
  ): Tick | null {
    if (tickArrayCurrent.type === 'Fixed') {
      return this._nextInitTickFixed(
        tickArrayCurrent.data,
        currentTickIndex,
        tickSpacing,
        zeroForOne,
        t
      );
    } else {
      return this._nextInitTickDynamic(
        tickArrayCurrent.data,
        currentTickIndex,
        tickSpacing,
        zeroForOne,
        t
      );
    }
  }

  /**
   * Fixed tick array implementation (original logic)
   */
  private static _nextInitTickFixed(
    tickArray: TickArray,
    currentTickIndex: number,
    tickSpacing: number,
    zeroForOne: boolean,
    t: boolean
  ): Tick | null {
    const currentTickArrayStartIndex = TickQuery.getArrayStartIndex(currentTickIndex, tickSpacing);
    if (currentTickArrayStartIndex != tickArray.startTickIndex) {
      return null;
    }
    let offsetInArray = Math.floor((currentTickIndex - tickArray.startTickIndex) / tickSpacing);

    if (zeroForOne) {
      while (offsetInArray >= 0) {
        if (tickArray.ticks[offsetInArray].liquidityGross.gtn(0)) {
          return tickArray.ticks[offsetInArray];
        }
        offsetInArray = offsetInArray - 1;
      }
    } else {
      if (!t) offsetInArray = offsetInArray + 1;
      while (offsetInArray < TICK_ARRAY_SIZE) {
        if (tickArray.ticks[offsetInArray].liquidityGross.gtn(0)) {
          return tickArray.ticks[offsetInArray];
        }
        offsetInArray = offsetInArray + 1;
      }
    }
    return null;
  }

  /**
   * Dynamic tick array implementation
   * Uses the mapping table (tickOffsetIndex) to find allocated ticks
   */
  private static _nextInitTickDynamic(
    dynTickArray: DynTickArray,
    currentTickIndex: number,
    tickSpacing: number,
    zeroForOne: boolean,
    t: boolean
  ): Tick | null {
    const currentTickArrayStartIndex = TickQuery.getArrayStartIndex(currentTickIndex, tickSpacing);
    if (currentTickArrayStartIndex !== dynTickArray.startTickIndex) {
      return null;
    }

    let offsetInArray = Math.floor((currentTickIndex - dynTickArray.startTickIndex) / tickSpacing);

    if (zeroForOne) {
      while (offsetInArray >= 0) {
        // Check mapping table
        const physicalIndex = dynTickArray.tickOffsetIndex[offsetInArray];

        if (physicalIndex > 0) {
          const tick = dynTickArray.ticks[physicalIndex - 1];
          if (tick.liquidityGross.gtn(0)) {
            return tick;
          }
        }

        offsetInArray = offsetInArray - 1;
      }
    } else {
      if (!t) offsetInArray = offsetInArray + 1;

      while (offsetInArray < TICK_ARRAY_SIZE) {
        const physicalIndex = dynTickArray.tickOffsetIndex[offsetInArray];

        if (physicalIndex > 0) {
          const tick = dynTickArray.ticks[physicalIndex - 1];
          if (tick.liquidityGross.gtn(0)) {
            return tick;
          }
        }

        offsetInArray = offsetInArray + 1;
      }
    }

    return null;
  }

  /**
   * Find the first initialized Tick in the given TickArray, where "first" is defined based on the trading direction (zeroForOne)
   * Now supports both fixed and dynamic tick arrays through the container pattern
   */
  public static firstInitializedTick(
    tickArrayCurrent: TickArrayContainer,
    zeroForOne: boolean
  ): Tick {
    if (tickArrayCurrent.type === 'Fixed') {
      return this._firstInitializedTickFixed(tickArrayCurrent.data, zeroForOne);
    } else {
      return this._firstInitializedTickDynamic(tickArrayCurrent.data, zeroForOne);
    }
  }

  /**
   * Fixed tick array implementation (original logic)
   */
  private static _firstInitializedTickFixed(tickArray: TickArray, zeroForOne: boolean): Tick {
    if (zeroForOne) {
      let i = TICK_ARRAY_SIZE - 1;
      while (i >= 0) {
        if (tickArray.ticks[i].liquidityGross.gtn(0)) {
          return tickArray.ticks[i];
        }
        i = i - 1;
      }
    } else {
      let i = 0;
      while (i < TICK_ARRAY_SIZE) {
        if (tickArray.ticks[i].liquidityGross.gtn(0)) {
          return tickArray.ticks[i];
        }
        i = i + 1;
      }
    }

    throw Error(`firstInitializedTick check error: ${tickArray} - ${zeroForOne}`);
  }

  /**
   * Dynamic tick array implementation
   * Uses the mapping table (tickOffsetIndex) to find the first allocated tick
   */
  private static _firstInitializedTickDynamic(
    dynTickArray: DynTickArray,
    zeroForOne: boolean
  ): Tick {
    if (zeroForOne) {
      // Search from right to left (highest tick index first)
      let i = TICK_ARRAY_SIZE - 1;
      while (i >= 0) {
        const physicalIndex = dynTickArray.tickOffsetIndex[i];

        if (physicalIndex > 0) {
          const tick = dynTickArray.ticks[physicalIndex - 1];
          if (tick.liquidityGross.gtn(0)) {
            return tick;
          }
        }

        i = i - 1;
      }
    } else {
      // Search from left to right (lowest tick index first)
      let i = 0;
      while (i < TICK_ARRAY_SIZE) {
        const physicalIndex = dynTickArray.tickOffsetIndex[i];

        if (physicalIndex > 0) {
          const tick = dynTickArray.ticks[physicalIndex - 1];
          if (tick.liquidityGross.gtn(0)) {
            return tick;
          }
        }

        i = i + 1;
      }
    }

    throw Error(`firstInitializedTick check error: ${dynTickArray} - ${zeroForOne}`);
  }

  public static getPriceAndTick({
    poolInfo,
    price,
    baseIn,
  }: {
    poolInfo: IPoolLayout;
    price: Decimal;
    baseIn: boolean;
  }): ReturnTypeGetPriceAndTick {
    const _price = baseIn ? price : new Decimal(1).div(price);

    const tick = TickMath.getTickWithPriceAndTickspacing(
      _price,
      poolInfo.tickSpacing,
      poolInfo.mintDecimalsA,
      poolInfo.mintDecimalsB
    );
    const tickSqrtPriceX64 = SqrtPriceMath.getSqrtPriceX64FromTick(tick);
    const tickPrice = SqrtPriceMath.sqrtPriceX64ToPrice(
      tickSqrtPriceX64,
      poolInfo.mintDecimalsA,
      poolInfo.mintDecimalsB
    );

    return baseIn ? { tick, price: tickPrice } : { tick, price: new Decimal(1).div(tickPrice) };
  }
}

export declare type PoolVars = {
  key: PublicKey;
  tokenA: PublicKey;
  tokenB: PublicKey;
  fee: number;
};

export class TickQuery {
  /**
   * Find the next initialized TickArray
   */
  public static nextInitializedTickArray(
    tickIndex: number,
    tickSpacing: number,
    zeroForOne: boolean,
    tickArrayBitmap: BN[],
    exBitmapInfo: TickArrayBitmapExtensionType
  ): {
    isExist: boolean;
    nextStartIndex: number;
  } {
    // First, include the array that contains tickIndex itself if initialized (handles boundary inclusively)
    const startIndex = TickQuery.getArrayStartIndex(tickIndex, tickSpacing);
    const merged = TickUtils.mergeTickArrayBitmap(tickArrayBitmap);
    try {
      const { isInitialized } = TickUtils.checkTickArrayIsInitialized(
        merged,
        startIndex,
        tickSpacing
      );
      if (isInitialized) return { isExist: true, nextStartIndex: startIndex };
    } catch {
      /* ignore */
    }
    try {
      const { isInitialized } = TickArrayBitmapExtensionUtils.checkTickArrayIsInit(
        startIndex,
        tickSpacing,
        exBitmapInfo
      );
      if (isInitialized) return { isExist: true, nextStartIndex: startIndex };
    } catch {
      /* ignore */
    }

    // Otherwise, search outward in the given direction
    const currentOffset = TickUtils.getTickArrayBitIndex(tickIndex, tickSpacing);
    const result: number[] = zeroForOne
      ? TickUtils.searchLowBitFromStart(
          tickArrayBitmap,
          exBitmapInfo,
          currentOffset - 1,
          1,
          tickSpacing
        )
      : TickUtils.searchHightBitFromStart(
          tickArrayBitmap,
          exBitmapInfo,
          currentOffset + 1,
          1,
          tickSpacing
        );

    return result.length > 0
      ? { isExist: true, nextStartIndex: result[0] }
      : { isExist: false, nextStartIndex: 0 };
  }

  // Calculate the start index of the TickArray corresponding to the given tick index
  public static getArrayStartIndex(tickIndex: number, tickSpacing: number): number {
    const ticksInArray = this.tickCount(tickSpacing);
    const start = Math.floor(tickIndex / ticksInArray);

    return start * ticksInArray;
  }

  // Check if the given tick index is a valid start index
  public static checkIsValidStartIndex(tickIndex: number, tickSpacing: number): boolean {
    if (TickUtils.checkIsOutOfBoundary(tickIndex)) {
      if (tickIndex > MAX_TICK) {
        return false;
      }
      // In extreme scenarios, tickIndex may be less than MIN_TICK
      const minStartIndex = TickUtils.getTickArrayStartIndexByTick(MIN_TICK, tickSpacing);
      return tickIndex == minStartIndex;
    }
    return tickIndex % this.tickCount(tickSpacing) == 0;
  }

  // Calculate the number of ticks contained in one tickarray
  public static tickCount(tickSpacing: number): number {
    return TICK_ARRAY_SIZE * tickSpacing;
  }
}
