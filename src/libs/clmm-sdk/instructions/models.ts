import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';

import { IPoolLayout } from './layout.js';

// Get transfer amount and fee
export interface IGetTransferAmountFee {
  amount: BN;
  fee: BN | undefined;
  expirationTime: number | undefined;
}

// Transfer fee configuration
export interface TransferFeeDataBaseType {
  transferFeeConfigAuthority: string;
  withdrawWithheldAuthority: string;
  withheldAmount: string;
  olderTransferFee: {
    epoch: string;
    maximumFee: string;
    transferFeeBasisPoints: number;
  };
  newerTransferFee: {
    epoch: string;
    maximumFee: string;
    transferFeeBasisPoints: number;
  };
}

// Token information
export interface ITokenInfo {
  decimals: number;
  address: string;
  programId: string;
  // extensions: {
  //   feeConfig: TransferFeeDataBaseType;
  // };
}

export type IPoolLayoutWithId = IPoolLayout & {
  currentPrice: number;
  programId: PublicKey;
  poolId: PublicKey;
};

export interface IAccountInfo {
  pubkey: PublicKey;
  isSigner: boolean;
  isWritable: boolean;
}

// Pool information (to be completed and improved)
// export interface IPoolInfo {
//   id: string;
//   programId: string;
//   tickSpacing: number;
//   tickCurrent: number;
//   sqrtPriceX64: BN;
//   mintA: ITokenInfo;
//   mintB: ITokenInfo;
//   vaultA: PublicKey;
//   vaultB: PublicKey;
// }
