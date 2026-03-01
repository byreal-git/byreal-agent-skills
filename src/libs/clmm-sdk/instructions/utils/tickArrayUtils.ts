import { PublicKey } from '@solana/web3.js';

import { DYN_TICK_ARRAY_HEADER_LEN, TICK_STATE_LEN } from '../../constants.js';
import { DynTickArrayLayout, TickArrayLayout, TickStateLayout } from '../layout.js';

import { Tick, DynTickArray, TickArrayContainer } from './models.js';
import { TickUtils } from './tick.js';
import BN from 'bn.js';

/**
 * Tick Array 工具类
 * 处理固定和动态 Tick Array 的统一操作
 */
export class TickArrayUtils {
  /**
   * Discriminator 常量
   * 这些值通过 Anchor 框架自动生成（SHA256("account:<StructName>") 的前 8 字节）
   */
  private static readonly FIXED_TICK_ARRAY_DISCRIMINATOR = Buffer.from('c09b55cd31f9812a', 'hex');
  private static readonly DYN_TICK_ARRAY_DISCRIMINATOR = Buffer.from('6a8b98247599b838', 'hex');

  /**
   * 识别 Tick Array 的类型
   * @param accountData 账户数据
   * @returns 'Fixed' 或 'Dynamic'
   */
  public static identifyTickArrayType(accountData: Buffer): 'Fixed' | 'Dynamic' {
    if (accountData.length < 8) {
      throw new Error('Invalid tick array data: too short to contain discriminator');
    }

    const discriminator = accountData.slice(0, 8);

    if (discriminator.equals(this.FIXED_TICK_ARRAY_DISCRIMINATOR)) {
      return 'Fixed';
    } else if (discriminator.equals(this.DYN_TICK_ARRAY_DISCRIMINATOR)) {
      return 'Dynamic';
    } else {
      throw new Error(
        `Unknown tick array discriminator: ${discriminator.toString('hex')}. ` +
          `Expected Fixed: ${this.FIXED_TICK_ARRAY_DISCRIMINATOR.toString('hex')} ` +
          `or Dynamic: ${this.DYN_TICK_ARRAY_DISCRIMINATOR.toString('hex')}`
      );
    }
  }

  /**
   * 解码动态 Tick Array
   * @param accountData 账户数据
   * @param address 账户地址（可选）
   * @returns DynTickArray
   */
  public static decodeDynTickArray(accountData: Buffer, address?: PublicKey): DynTickArray {
    // DynTickArrayState Header 长度：8 (discriminator) + 208 (struct) = 216 bytes

    if (accountData.length < DYN_TICK_ARRAY_HEADER_LEN) {
      throw new Error(
        `Invalid dyn tick array data: expected at least ${DYN_TICK_ARRAY_HEADER_LEN} bytes, got ${accountData.length}`
      );
    }

    // 1. 解析 header
    const headerData = accountData.slice(0, DYN_TICK_ARRAY_HEADER_LEN);
    const header = DynTickArrayLayout.decode(headerData);

    // 2. 验证数据长度
    const expectedSize = DYN_TICK_ARRAY_HEADER_LEN + header.allocTickCount * TICK_STATE_LEN;
    if (accountData.length !== expectedSize) {
      throw new Error(
        `Invalid dyn tick array data size: expected ${expectedSize} bytes, got ${accountData.length}`
      );
    }

    // 3. 解析 TickState 数组
    const ticksData = accountData.slice(DYN_TICK_ARRAY_HEADER_LEN);
    const ticks: Tick[] = [];

    for (let i = 0; i < header.allocTickCount; i++) {
      const offset = i * TICK_STATE_LEN;
      const tickData = ticksData.slice(offset, offset + TICK_STATE_LEN);
      const tick = TickStateLayout.decode(tickData);
      ticks.push(tick);
    }

    // 4. 构建结果
    return {
      address: address || PublicKey.default,
      poolId: header.poolId,
      startTickIndex: header.startTickIndex,
      tickOffsetIndex: Array.from(header.tickOffsetIndex),
      allocTickCount: header.allocTickCount,
      initializedTickCount: header.initializedTickCount,
      ticks,
    };
  }

  /**
   * 从容器中获取 Tick State
   * @param container TickArrayContainer
   * @param tickIndex Tick 索引
   * @param tickSpacing Tick 间距
   * @returns Tick 或 null（如果未分配）
   */
  public static getTickStateFromContainer(
    container: TickArrayContainer,
    tickIndex: number,
    tickSpacing: number
  ): Tick | null {
    if (container.type === 'Fixed') {
      // 固定 Tick Array: 直接数组访问
      const offset = TickUtils.getTickOffsetInArray(tickIndex, tickSpacing);
      return container.data.ticks[offset];
    } else {
      // 动态 Tick Array: 通过映射表访问
      return this.getTickStateFromDynArray(container.data, tickIndex, tickSpacing);
    }
  }

  /**
   * 从动态 Tick Array 中获取 Tick State
   * @param dynTickArray DynTickArray
   * @param tickIndex Tick 索引
   * @param tickSpacing Tick 间距
   * @returns Tick 或 null（如果未分配）
   */
  private static getTickStateFromDynArray(
    dynTickArray: DynTickArray,
    tickIndex: number,
    tickSpacing: number
  ): Tick | null {
    // 1. 计算逻辑偏移 (0-59)
    const logicalOffset = TickUtils.getTickOffsetInArray(tickIndex, tickSpacing);

    // 2. 查映射表
    const physicalIndexPlusOne = dynTickArray.tickOffsetIndex[logicalOffset];

    // 3. 检查是否已分配
    if (physicalIndexPlusOne === 0) {
      return null; // 未分配
    }

    // 4. 计算实际索引 (position + 1 - 1 = position)
    const actualIndex = physicalIndexPlusOne - 1;

    // 5. 边界检查
    if (actualIndex >= dynTickArray.ticks.length) {
      throw new Error(
        `Tick state index out of bounds: ${actualIndex} >= ${dynTickArray.ticks.length}. ` +
          'This indicates corrupted tick array data.'
      );
    }

    return dynTickArray.ticks[actualIndex];
  }

  /**
   * Parse tick array account data into a container
   * Supports both fixed and dynamic tick arrays
   * @private
   */
  public static parseTickArrayContainer(
    accountData: Buffer,
    address: PublicKey
  ): TickArrayContainer {
    const tickArrayType = this.identifyTickArrayType(accountData);

    if (tickArrayType === 'Fixed') {
      const decoded = TickArrayLayout.decode(accountData);
      return {
        type: 'Fixed',
        data: {
          address,
          poolId: decoded.poolId,
          startTickIndex: decoded.startTickIndex,
          ticks: decoded.ticks.map((tick: any) => ({
            tick: tick.tick,
            liquidityNet: new BN(tick.liquidityNet.toString()),
            liquidityGross: new BN(tick.liquidityGross.toString()),
            feeGrowthOutsideX64A: new BN(tick.feeGrowthOutsideX64A.toString()),
            feeGrowthOutsideX64B: new BN(tick.feeGrowthOutsideX64B.toString()),
            rewardGrowthsOutsideX64: tick.rewardGrowthsOutsideX64.map(
              (r: any) => new BN(r.toString())
            ),
          })),
          initializedTickCount: decoded.initializedTickCount,
        },
      };
    } else {
      const decoded = this.decodeDynTickArray(accountData, address);
      return {
        type: 'Dynamic',
        data: decoded,
      };
    }
  }
}
