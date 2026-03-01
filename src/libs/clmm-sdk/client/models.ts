import { PublicKey, Signer, TransactionInstruction, VersionedTransaction } from '@solana/web3.js';
import BN from 'bn.js';
import { Decimal } from 'decimal.js';

import { IPersonalPositionLayout, IPoolLayoutWithId, ITokenInfo } from '../instructions/index.js';
import { IMakeTransactionOptions } from '../utils/index.js';

export type SignerCallback = (transaction: VersionedTransaction) => Promise<VersionedTransaction>;

export type ParamsWithSignerCallback<T> = T & {
  signerCallback: SignerCallback;
};

export interface IInstructionReturn {
  instructions: TransactionInstruction[];
  signers?: Signer[];
  transaction: VersionedTransaction;
  nftAddress?: string;
}

export interface ICreatePositionParams {
  userAddress: PublicKey;
  poolInfo: IPoolLayoutWithId;
  tickLower: number;
  tickUpper: number;
  base: 'MintA' | 'MintB';
  baseAmount: BN;
  otherAmountMax: BN;
  transactionOptions?: IMakeTransactionOptions;
  refererPosition?: string;
}

export interface IClosePositionParams {
  userAddress: PublicKey;
  nftMint: PublicKey;
}

export interface IDecreaseLiquidityParams {
  userAddress: PublicKey;
  nftMint: PublicKey;
  liquidity: BN;
  slippage?: number;
}

export interface IDecreaseFullLiquidityParams {
  userAddress: PublicKey;
  nftMint: PublicKey;
  closePosition?: boolean;
  slippage?: number;
}

export interface IAddLiquidityParams {
  userAddress: PublicKey;
  nftMint: PublicKey;
  base: 'MintA' | 'MintB';
  baseAmount: BN;
  otherAmountMax: BN;
  computeBudgetOptions?: IComputeBudgetOptions;
}

export interface ICreatePoolParams {
  userAddress: PublicKey;
  poolManager: PublicKey;
  mintA: ITokenInfo;
  mintB: ITokenInfo;
  ammConfigId: PublicKey;
  initialPrice: number;
  openTime?: BN;
  computeBudgetOptions?: IComputeBudgetOptions;
}

export interface ICollectFeesParams {
  userAddress: PublicKey;
  nftMint: PublicKey;
}

export interface ICollectAllFeesParams {
  userAddress: PublicKey;
  nftMintList: PublicKey[];
}

export interface IGetPositionInfoByNftMintReturn {
  priceLower: Decimal;
  priceUpper: Decimal;
  uiPriceLower: string;
  uiPriceUpper: string;
  tokenA: {
    address: PublicKey;
    decimals: number;
    amount: BN;
    feeAmount: BN;
    uiAmount: string;
    uiFeeAmount: string;
  };
  tokenB: {
    address: PublicKey;
    decimals: number;
    amount: BN;
    feeAmount: BN;
    uiAmount: string;
    uiFeeAmount: string;
  };
  rawPositionInfo: IPersonalPositionLayout;
  rawPoolInfo: IPoolLayoutWithId;
}

export interface ICalculateCreatePositionFee {
  transactionNetFee: number; // Transaction fee
  refundableFees: number; // Refundable fees (NFT minting fee + NFT holder fee + personal position fee)
  unRefundableFees: number; // Unrefundable fees (Newly created tick array account + transaction fee)

  createTickFee: number; // Create tick array account fee
}

/**
 * maxFee and exactFee are mutually exclusive
 */
export type IComputeBudgetOptions =
  | { maxFee: number; exactFee?: never; computeUnitPrice?: number }
  | { maxFee?: never; exactFee: number; computeUnitPrice?: never }
  | { maxFee?: undefined; exactFee?: undefined; computeUnitPrice?: number };

export interface IQouteSwapParams {
  poolInfo: IPoolLayoutWithId;
  inputTokenMint: PublicKey;
  amountIn: BN;
  slippage?: number;
  priceLimit?: Decimal;
  catchLiquidityInsufficient?: boolean;
}

export interface IQouteSwapReturn {
  allTrade: boolean;
  amountIn: BN;
  isInputMintA: boolean;
  expectedAmountOut: BN;
  minAmountOut: BN;
  remainingAccounts: PublicKey[];
  executionPrice: BN;
  feeAmount: BN;
}

export interface ISwapParams {
  poolInfo: IPoolLayoutWithId;
  userAddress: PublicKey;
  quoteReturn: IQouteSwapReturn;
}

export interface ISwapExactOutParams {
  poolInfo: IPoolLayoutWithId;
  userAddress: PublicKey;
  quoteReturn: IQuoteSwapExactOutReturn;
}

export interface IQuoteSwapExactOutParams {
  poolInfo: IPoolLayoutWithId;
  outputTokenMint: PublicKey;
  amountOut: BN;
  slippage?: number;
  priceLimit?: Decimal;
  catchLiquidityInsufficient?: boolean;
}

export interface IQuoteSwapExactOutReturn {
  allTrade: boolean;
  amountOut: BN;
  isOutputMintA: boolean;
  expectedAmountIn: BN;
  maxAmountIn: BN;
  remainingAccounts: PublicKey[];
  executionPrice: BN;
  feeAmount: BN;
}
