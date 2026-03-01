import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
import { Decimal } from 'decimal.js';

export interface ReturnTypeGetPriceAndTick {
  tick: number;
  price: Decimal;
}

export type Tick = {
  tick: number;
  liquidityNet: BN;
  liquidityGross: BN;
  feeGrowthOutsideX64A: BN;
  feeGrowthOutsideX64B: BN;
  rewardGrowthsOutsideX64: BN[];
};

export type TickArray = {
  address: PublicKey;
  poolId: PublicKey;
  startTickIndex: number;
  ticks: Tick[];
  initializedTickCount: number;
};

/**
 * Dynamic Tick Array type
 * Uses sparse storage with a mapping table to track allocated tick positions
 */
export type DynTickArray = {
  address: PublicKey;
  poolId: PublicKey;
  startTickIndex: number;
  tickOffsetIndex: number[]; // Mapping table: tickOffsetIndex[offset] = position + 1 (0 = unallocated)
  allocTickCount: number; // Number of allocated ticks
  initializedTickCount: number; // Number of initialized ticks
  ticks: Tick[]; // Dynamic array of tick states (length = allocTickCount)
};

/**
 * Unified Tick Array Container
 * Discriminated union to handle both fixed and dynamic tick arrays
 */
export type TickArrayContainer =
  | { type: 'Fixed'; data: TickArray }
  | { type: 'Dynamic'; data: DynTickArray };

/**
 * Type guard to check if a container is a fixed tick array
 */
export function isFixedTickArray(
  container: TickArrayContainer
): container is { type: 'Fixed'; data: TickArray } {
  return container.type === 'Fixed';
}

/**
 * Type guard to check if a container is a dynamic tick array
 */
export function isDynamicTickArray(
  container: TickArrayContainer
): container is { type: 'Dynamic'; data: DynTickArray } {
  return container.type === 'Dynamic';
}

export type TickState = {
  tick: number;
  liquidityNet: BN;
  liquidityGross: BN;
  feeGrowthOutsideX64A: BN;
  feeGrowthOutsideX64B: BN;
  tickCumulativeOutside: BN;
  secondsPerLiquidityOutsideX64: BN;
  secondsOutside: number;
  rewardGrowthsOutside: BN[];
};

export type TickArrayState = {
  ammPool: PublicKey;
  startTickIndex: number;
  ticks: TickState[];
  initializedTickCount: number;
};

export interface TickArrayBitmapExtensionType {
  poolId: PublicKey;
  exBitmapAddress: PublicKey;
  positiveTickArrayBitmap: BN[][];
  negativeTickArrayBitmap: BN[][];
}

export interface StepComputations {
  sqrtPriceStartX64: BN;
  tickNext: number;
  initialized: boolean;
  sqrtPriceNextX64: BN;
  amountIn: BN;
  amountOut: BN;
  feeAmount: BN;
}
