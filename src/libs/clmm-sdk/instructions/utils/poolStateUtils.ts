import { Connection, PublicKey } from '@solana/web3.js';

import { RawDataUtils } from '../getRawData.js';
import { IPoolLayout } from '../layout.js';

/**
 * Pool State Utilities for querying pool information with decay fee support
 */
export class PoolStateUtils {
  /**
   * Check if the pool has decay fee enabled
   * @param poolInfo Pool layout information
   * @returns boolean indicating if decay fee is enabled
   */
  static isDecayFeeEnabled(poolInfo: IPoolLayout): boolean {
    return (poolInfo.decayFeeFlag & (1 << 0)) !== 0;
  }

  /**
   * Check if decay fee is enabled for selling mint0
   * @param poolInfo Pool layout information
   * @returns boolean indicating if decay fee is enabled for mint0 sell
   */
  static isDecayFeeOnSellMint0(poolInfo: IPoolLayout): boolean {
    return (poolInfo.decayFeeFlag & (1 << 1)) !== 0;
  }

  /**
   * Check if decay fee is enabled for selling mint1
   * @param poolInfo Pool layout information
   * @returns boolean indicating if decay fee is enabled for mint1 sell
   */
  static isDecayFeeOnSellMint1(poolInfo: IPoolLayout): boolean {
    return (poolInfo.decayFeeFlag & (1 << 2)) !== 0;
  }

  /**
   * Calculate the current decay fee rate based on the current time
   * @param poolInfo Pool layout information
   * @param currentTimestamp Current timestamp in seconds
   * @returns Decay fee rate in hundredths of a bip (10^-6)
   */
  static getDecayFeeRate(poolInfo: IPoolLayout, currentTimestamp: number): number {
    if (!this.isDecayFeeEnabled(poolInfo)) {
      return 0;
    }

    // Pool is not open yet
    if (currentTimestamp < poolInfo.openTime.toNumber()) {
      return 0;
    }

    const intervalCount = Math.floor(
      (currentTimestamp - poolInfo.openTime.toNumber()) / poolInfo.decayFeeDecreaseInterval
    );

    const decayFeeDecreaseRate = poolInfo.decayFeeDecreaseRate * 10000; // Convert to basis points
    const FEE_RATE_DENOMINATOR_VALUE = 1000000; // 10^6
    const hundredthsOfABip = FEE_RATE_DENOMINATOR_VALUE;
    let rate = hundredthsOfABip;

    // Fast power calculation: (1 - x)^c
    // where x = decayFeeDecreaseRate / 10^6, c = intervalCount
    if (intervalCount > 0) {
      let exp = intervalCount;
      let base = hundredthsOfABip - decayFeeDecreaseRate;

      while (exp > 0) {
        if (exp % 2 === 1) {
          rate = Math.ceil((rate * base) / hundredthsOfABip);
        }
        base = Math.ceil((base * base) / hundredthsOfABip);
        exp = Math.floor(exp / 2);
      }
    }

    // Apply initial fee rate (convert from percentage)
    rate = Math.ceil((rate * poolInfo.decayFeeInitFeeRate) / 100);

    return rate;
  }

  /**
   * Get comprehensive decay fee information for a pool
   * @param poolInfo Pool layout information
   * @param currentTimestamp Current timestamp in seconds
   * @returns Object containing all decay fee related information
   */
  static getDecayFeeInfo(poolInfo: IPoolLayout, currentTimestamp?: number) {
    const timestamp = currentTimestamp || Math.floor(Date.now() / 1000);

    return {
      isEnabled: this.isDecayFeeEnabled(poolInfo),
      onSellMint0: this.isDecayFeeOnSellMint0(poolInfo),
      onSellMint1: this.isDecayFeeOnSellMint1(poolInfo),
      initFeeRate: poolInfo.decayFeeInitFeeRate, // Percentage (1 = 1%)
      decreaseRate: poolInfo.decayFeeDecreaseRate, // Percentage (1 = 1%)
      decreaseInterval: poolInfo.decayFeeDecreaseInterval, // Seconds
      currentFeeRate: this.getDecayFeeRate(poolInfo, timestamp), // In hundredths of a bip (10^-6)
      openTime: poolInfo.openTime.toNumber(),
    };
  }

  /**
   * Get pool state with decay fee information from chain
   * @param connection Solana connection
   * @param poolId Pool address
   * @param currentTimestamp Optional current timestamp
   * @returns Pool information with decay fee details
   */
  static async getPoolStateWithDecayFee(
    connection: Connection,
    poolId: string | PublicKey,
    currentTimestamp?: number
  ) {
    const poolInfo = await RawDataUtils.getRawPoolInfoByPoolId({
      connection,
      poolId,
    });

    if (!poolInfo) {
      throw new Error(`Pool not found: ${poolId}`);
    }

    const decayFeeInfo = this.getDecayFeeInfo(poolInfo, currentTimestamp);

    return {
      ...poolInfo,
      decayFeeInfo,
    };
  }

  /**
   * Check if decay fee is currently active for a specific direction
   * @param poolInfo Pool layout information
   * @param zeroForOne True if swapping token0 for token1 (selling token0)
   * @param currentTimestamp Current timestamp in seconds
   * @returns Object with active status and current fee rate
   */
  static getDecayFeeForDirection(
    poolInfo: IPoolLayout,
    zeroForOne: boolean,
    currentTimestamp?: number
  ) {
    const timestamp = currentTimestamp || Math.floor(Date.now() / 1000);

    if (!this.isDecayFeeEnabled(poolInfo)) {
      return {
        isActive: false,
        feeRate: 0,
      };
    }

    const isActiveForDirection = zeroForOne
      ? this.isDecayFeeOnSellMint0(poolInfo)
      : this.isDecayFeeOnSellMint1(poolInfo);

    if (!isActiveForDirection) {
      return {
        isActive: false,
        feeRate: 0,
      };
    }

    const currentFeeRate = this.getDecayFeeRate(poolInfo, timestamp);

    return {
      isActive: true,
      feeRate: currentFeeRate,
    };
  }
}
