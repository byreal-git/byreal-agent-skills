import { TICK_ARRAY_SIZE, EXTENSION_TICKARRAY_BITMAP_SIZE } from '../constants.js';

import {
  blob,
  bool,
  i128,
  i64,
  publicKey,
  s32,
  seq,
  struct,
  u128,
  u16,
  u32,
  u64,
  u8,
} from './libs/marshmallow/index.js';

/**
 * @description Pool configuration layout
 *
 * @example https://solscan.io/account/EdPxg8QaeFSrTYqdWJn6Kezwy9McWncTYueD9eMGCuzR#anchorData
 */
export const AmmConfigLayout = struct([
  blob(8),
  u8('bump'),
  u16('index'),
  publicKey('owner'),
  u32('protocolFeeRate'),
  u32('tradeFeeRate'),
  u16('tickSpacing'),
  u32('fundFeeRate'),
  u32('padding'),
  publicKey('fundOwner'),
]);

export type IAmmConfigLayout = ReturnType<typeof AmmConfigLayout.decode>;

/**
 * @description Observation account layout
 *
 * @example https://solscan.io/account/AA5RaVvyGyZgtmAsJJHT5ZVBxVPtAXuYaMwfgeFJW4Mk#anchorData
 */
export const ObservationLayout = struct([
  blob(8),
  bool('initialized'),
  u64('recentEpoch'),
  u16('observationIndex'),
  publicKey('poolId'),
  seq(struct([u32('blockTimestamp'), i64('tickCumulative'), seq(u64(), 4)]), 100, 'observations'),
]);

export type IObservationLayout = ReturnType<typeof ObservationLayout.decode>;

/**
 * @description Pool information layout
 *
 * @example https://solscan.io/account/CYbD9RaToYMtWKA7QZyoLahnHdWq553Vm62Lh6qWtuxq#anchorData
 */
export const PoolLayout = struct([
  blob(8),
  u8('bump'),
  publicKey('ammConfig'),
  publicKey('creator'),
  publicKey('mintA'),
  publicKey('mintB'),
  publicKey('vaultA'),
  publicKey('vaultB'),
  publicKey('observationId'),
  u8('mintDecimalsA'),
  u8('mintDecimalsB'),
  u16('tickSpacing'),
  u128('liquidity'),
  u128('sqrtPriceX64'),
  s32('tickCurrent'),
  u32(),
  u128('feeGrowthGlobalX64A'),
  u128('feeGrowthGlobalX64B'),
  u64('protocolFeesTokenA'),
  u64('protocolFeesTokenB'),

  u128('swapInAmountTokenA'),
  u128('swapOutAmountTokenB'),
  u128('swapInAmountTokenB'),
  u128('swapOutAmountTokenA'),

  u8('status'),

  seq(u8(), 7, ''),

  seq(
    struct([
      u8('rewardState'),
      u64('openTime'),
      u64('endTime'),
      u64('lastUpdateTime'),
      u128('emissionsPerSecondX64'),
      u64('rewardTotalEmissioned'),
      u64('rewardClaimed'),
      publicKey('tokenMint'),
      publicKey('tokenVault'),
      publicKey('creator'),
      u128('rewardGrowthGlobalX64'),
    ]),
    3,
    'rewardInfos'
  ),
  seq(u64(), 16, 'tickArrayBitmap'),

  u64('totalFeesTokenA'),
  u64('totalFeesClaimedTokenA'),
  u64('totalFeesTokenB'),
  u64('totalFeesClaimedTokenB'),

  u64('fundFeesTokenA'),
  u64('fundFeesTokenB'),

  u64('openTime'),
  u64('recentEpoch'),

  u8('decayFeeFlag'),
  u8('decayFeeInitFeeRate'),
  u8('decayFeeDecreaseRate'),
  u8('decayFeeDecreaseInterval'),
  seq(u8(), 4, 'padding1_1'),
  seq(u64(), 23, 'padding1'),
  seq(u64(), 32, 'padding2'),
]);

export type IPoolLayout = ReturnType<typeof PoolLayout.decode>;

/**
 * @description Personal position information layout
 *
 * @example https://solscan.io/account/CLYRosA3oGsx6WjuebDYmEL3kukTCSsncmYU6at8nDsn#anchorData
 */
export const PersonalPositionLayout = struct([
  blob(8),
  u8('bump'),
  publicKey('nftMint'),
  publicKey('poolId'),

  s32('tickLower'),
  s32('tickUpper'),
  u128('liquidity'),
  u128('feeGrowthInsideLastX64A'),
  u128('feeGrowthInsideLastX64B'),
  u64('tokenFeesOwedA'),
  u64('tokenFeesOwedB'),

  seq(struct([u128('growthInsideLastX64'), u64('rewardAmountOwed')]), 3, 'rewardInfos'),
]);

export type IPersonalPositionLayout = ReturnType<typeof PersonalPositionLayout.decode>;

/**
 * @description Protocol position information layout, used to track liquidity within specific price ranges
 *
 * @example https://solscan.io/account/38GUhmh7vPyWStAV3YKEEYPHrLk2Mnw5jvaUQkMGS1hb#anchorData
 */
export const ProtocolPositionLayout = struct([
  blob(8),
  u8('bump'),
  publicKey('poolId'),
  s32('tickLowerIndex'),
  s32('tickUpperIndex'),
  u128('liquidity'),
  u128('feeGrowthInsideLastX64A'),
  u128('feeGrowthInsideLastX64B'),
  u64('tokenFeesOwedA'),
  u64('tokenFeesOwedB'),
  seq(u128(), 3, 'rewardGrowthInside'),
]);

/**
 * @description Price tick array layout
 *
 * @example https://solscan.io/account/4vGLPwfohNUd2o4NwZPMx7q8AH98DQ9Eth5tS1p8dew1#anchorData
 */
/**
 * @description TickState layout (168 bytes)
 */
export const TickStateLayout = struct([
  s32('tick'),
  i128('liquidityNet'),
  u128('liquidityGross'),
  u128('feeGrowthOutsideX64A'),
  u128('feeGrowthOutsideX64B'),
  seq(u128(), 3, 'rewardGrowthsOutsideX64'),
  seq(u32(), 13, ''),
]);

export type ITickStateLayout = ReturnType<typeof TickStateLayout.decode>;

export const TickArrayLayout = struct([
  blob(8),
  publicKey('poolId'),
  s32('startTickIndex'),
  seq(TickStateLayout, TICK_ARRAY_SIZE, 'ticks'),
  u8('initializedTickCount'),
]);

export type ITickArrayLayout = ReturnType<typeof TickArrayLayout.decode>;

/**
 * @description Dynamic Tick Array layout
 *
 * Dynamic tick arrays use a sparse storage model with a mapping table (tick_offset_index)
 * to track which logical tick positions have allocated TickStates.
 * This allows for more efficient memory usage compared to fixed tick arrays.
 *
 * Struct size: 208 bytes (32+4+4+60+1+1+2+8+96)
 * Header size: 216 bytes (8 discriminator + 208 struct)
 * Followed by dynamic number of TickStates (max 60, each 168 bytes)
 */
export const DynTickArrayLayout = struct([
  blob(8), // discriminator (8 bytes)
  publicKey('poolId'), // 32 bytes
  s32('startTickIndex'), // 4 bytes
  blob(4, 'padding0'), // 4 bytes
  seq(u8(), TICK_ARRAY_SIZE, 'tickOffsetIndex'), // 60 bytes - Mapping table: offset -> physical position + 1
  u8('allocTickCount'), // 1 byte - Number of allocated ticks
  u8('initializedTickCount'), // 1 byte - Number of initialized ticks
  blob(2, 'padding1'), // 2 bytes
  u64('recentEpoch'), // 8 bytes
  blob(96, 'padding2'), // 96 bytes
]);

export type IDynTickArrayLayout = ReturnType<typeof DynTickArrayLayout.decode>;

/**
 * @description Price tick array bitmap extension layout
 *
 * @example https://solscan.io/account/DoPuiZfJu7sypqwR4eiU7C5TMcmmiFoU4HaF5SoD8mRy#anchorData
 */
export const TickArrayBitmapExtensionLayout = struct([
  blob(8),
  publicKey('poolId'),
  seq(seq(u64(), 8), EXTENSION_TICKARRAY_BITMAP_SIZE, 'positiveTickArrayBitmap'),
  seq(seq(u64(), 8), EXTENSION_TICKARRAY_BITMAP_SIZE, 'negativeTickArrayBitmap'),
]);

export const SPLTokenAccountLayout = struct([
  publicKey('mint'),
  publicKey('owner'),
  u64('amount'),
  u32('delegateOption'),
  publicKey('delegate'),
  u8('state'),
  u32('isNativeOption'),
  u64('isNative'),
  u64('delegatedAmount'),
  u32('closeAuthorityOption'),
  publicKey('closeAuthority'),
]);
