import { MintLayout } from '@solana/spl-token';
import { Connection, PublicKey } from '@solana/web3.js';
import BN from 'bn.js';

import {
  AmmConfigLayout,
  IAmmConfigLayout,
  IObservationLayout,
  IPersonalPositionLayout,
  ObservationLayout,
  PersonalPositionLayout,
  PoolLayout,
} from './layout.js';
import { IPoolLayoutWithId } from './models.js';
import { getPdaPersonalPositionAddress } from './pda.js';
import { fetchWalletTokenAccounts } from './utils/fetchWalletTokenAccounts.js';
import { SqrtPriceMath } from './utils/index.js';

export class RawDataUtils {
  /**
   * Get position list for specified account
   */
  static async getRawPositionInfoListByUserAddress(params: {
    connection: Connection;
    programId: PublicKey;
    userAddress: PublicKey;
  }): Promise<IPersonalPositionLayout[]> {
    const { connection, programId, userAddress } = params;
    const { rawTokenAccountInfos } = await fetchWalletTokenAccounts(connection, userAddress);
    const balanceMints = rawTokenAccountInfos.filter((acc) => acc.accountInfo.amount.eq(new BN(1)));
    const allPositionKey = balanceMints.map(
      (acc) =>
        getPdaPersonalPositionAddress(new PublicKey(programId), acc.accountInfo.mint).publicKey
    );

    const accountInfo = await connection.getMultipleAccountsInfo(allPositionKey);
    const allPosition: IPersonalPositionLayout[] = [];
    accountInfo.forEach((positionRes) => {
      if (!positionRes) return;
      const position = PersonalPositionLayout.decode(positionRes.data);
      allPosition.push(position);
    });

    return allPosition;
  }

  /**
   * Get position information from specified position list
   */
  static async getRawPositionInfoByNftMint(params: {
    connection: Connection;
    programId: PublicKey;
    nftMint: PublicKey;
  }): Promise<IPersonalPositionLayout | null> {
    const { connection, programId, nftMint } = params;
    const positionKey = getPdaPersonalPositionAddress(new PublicKey(programId), nftMint).publicKey;
    const positionRes = await connection.getAccountInfo(positionKey);
    if (!positionRes) return null;
    const position = PersonalPositionLayout.decode(positionRes.data);
    return position;
  }

  /**
   * Get on-chain information for a single CLMM pool
   */
  static async getRawPoolInfoByPoolId(params: {
    connection: Connection;
    poolId: string | PublicKey;
  }): Promise<IPoolLayoutWithId | null> {
    const { connection, poolId } = params;
    const poolPublicKey = new PublicKey(poolId);

    const accountInfo = await connection.getAccountInfo(poolPublicKey);

    if (!accountInfo || !accountInfo.data) return null;

    const poolRawInfo = PoolLayout.decode(accountInfo.data);

    const currentPrice = SqrtPriceMath.sqrtPriceX64ToPrice(
      poolRawInfo.sqrtPriceX64,
      poolRawInfo.mintDecimalsA,
      poolRawInfo.mintDecimalsB
    ).toNumber();

    return {
      ...poolRawInfo,
      currentPrice,
      programId: accountInfo.owner,
      poolId: poolPublicKey,
    };
  }

  /**
   * Get on-chain information for specified token
   */
  static async getRawTokenInfoByMint(params: {
    connection: Connection;
    mintAddress: PublicKey;
  }): Promise<(ReturnType<typeof MintLayout.decode> & { owner: PublicKey }) | null> {
    const { connection, mintAddress } = params;
    const accountInfo = await connection.getAccountInfo(mintAddress);
    if (!accountInfo || !accountInfo.data) return null;
    const tokenInfo = MintLayout.decode(accountInfo.data);
    return {
      ...tokenInfo,
      owner: accountInfo.owner,
    };
  }

  /**
   * Get AMM configuration on-chain information
   */
  static async getRawAmmConfigByConfigId(params: {
    connection: Connection;
    configId: string | PublicKey;
  }): Promise<(IAmmConfigLayout & { configId: PublicKey; owner: PublicKey }) | null> {
    const { connection, configId } = params;
    const configPublicKey = new PublicKey(configId);

    const accountInfo = await connection.getAccountInfo(configPublicKey);

    if (!accountInfo || !accountInfo.data) return null;

    const configRawInfo = AmmConfigLayout.decode(accountInfo.data);

    return {
      ...configRawInfo,
      configId: configPublicKey,
      owner: accountInfo.owner,
    };
  }

  /**
   * Get observation account on-chain information
   * Observation account is used to record historical data of price changes in the pool
   */
  static async getRawObservationByObservationId(params: {
    connection: Connection;
    observationId: string | PublicKey;
  }): Promise<(IObservationLayout & { observationId: PublicKey; owner: PublicKey }) | null> {
    const { connection, observationId } = params;
    const observationPublicKey = new PublicKey(observationId);

    const accountInfo = await connection.getAccountInfo(observationPublicKey);

    if (!accountInfo || !accountInfo.data) return null;

    const observationRawInfo = ObservationLayout.decode(accountInfo.data);

    return {
      ...observationRawInfo,
      observationId: observationPublicKey,
      owner: accountInfo.owner,
    };
  }
}
