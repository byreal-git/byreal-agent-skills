import { TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { Keypair, PublicKey, Signer, TransactionInstruction } from '@solana/web3.js';
import BN from 'bn.js';

import { BaseInstruction } from './baseInstruction.js';
import { IPersonalPositionLayout } from './layout.js';
import { IPoolLayoutWithId, ITokenInfo } from './models.js';
import {
  getATAAddress,
  getPdaExBitmapAccount,
  getPdaPersonalPositionAddress,
  getPdaProtocolPositionAddress,
  getPdaTickArrayAddress,
} from './pda.js';
import { PoolUtils } from './utils/poolUtils.js';
import { TickUtils } from './utils/tick.js';

export class Instruction {
  static async createPoolInstruction(props: {
    programId: PublicKey;
    owner: PublicKey;
    poolManager: PublicKey;
    mintA: ITokenInfo;
    mintB: ITokenInfo;
    ammConfigId: PublicKey;
    initialPriceX64: BN;
    openTime?: BN;
    extendMintAccount?: PublicKey[];
  }): Promise<{
    instructions: TransactionInstruction[];
  }> {
    // console.log('[clmm sdk] createPoolInstruction fn params:', JSON.stringify(props, null, 2));

    const {
      programId,
      owner,
      poolManager,
      mintA,
      mintB,
      ammConfigId,
      initialPriceX64,
      extendMintAccount,
      openTime,
    } = props;

    const mintAAddress = new PublicKey(mintA.address);
    const mintBAddress = new PublicKey(mintB.address);

    const instruction = await BaseInstruction.createPoolInstruction(
      programId,
      owner,
      poolManager,
      ammConfigId,
      mintAAddress,
      new PublicKey(mintA.programId),
      mintBAddress,
      new PublicKey(mintB.programId),
      initialPriceX64,
      openTime,
      extendMintAccount
    );

    return {
      instructions: [instruction],
    };
  }

  static async openPositionFromLiquidityInstruction(params: {
    poolInfo: IPoolLayoutWithId;
    ownerInfo: {
      feePayer: PublicKey;
      wallet: PublicKey;
      tokenAccountA: PublicKey;
      tokenAccountB: PublicKey;
    };
    tickLower: number;
    tickUpper: number;
    liquidity: BN;
    amountMaxA: BN;
    amountMaxB: BN;
    withMetadata: 'create' | 'no-create';
  }): Promise<{
    instructions: TransactionInstruction[];
    signers: Signer[];
  }> {
    // console.log('[clmm sdk] openPositionFromLiquidityInstruction fn params:', JSON.stringify(params, null, 2));

    const {
      poolInfo,
      ownerInfo,
      tickLower,
      tickUpper,
      liquidity,
      amountMaxA,
      amountMaxB,
      withMetadata,
    } = params;
    const signers: Signer[] = [];

    const { programId, poolId, tickSpacing } = poolInfo;

    const keypair = Keypair.generate();
    signers.push(keypair);
    const nftMintAccount = keypair.publicKey;

    const tickArrayLowerStartIndex = TickUtils.getTickArrayStartIndexByTick(tickLower, tickSpacing);
    const tickArrayUpperStartIndex = TickUtils.getTickArrayStartIndexByTick(tickUpper, tickSpacing);

    const { publicKey: tickArrayLower } = getPdaTickArrayAddress(
      programId,
      poolId,
      tickArrayLowerStartIndex
    );
    const { publicKey: tickArrayUpper } = getPdaTickArrayAddress(
      programId,
      poolId,
      tickArrayUpperStartIndex
    );

    const { publicKey: positionNftAccount } = getATAAddress(
      ownerInfo.wallet,
      nftMintAccount,
      TOKEN_2022_PROGRAM_ID
    );

    const { publicKey: personalPosition } = getPdaPersonalPositionAddress(
      programId,
      nftMintAccount
    );
    const { publicKey: protocolPosition } = getPdaProtocolPositionAddress(
      programId,
      poolId,
      tickLower,
      tickUpper
    );

    const instruction = await BaseInstruction.openPositionFromLiquidityInstruction22(
      programId,
      ownerInfo.feePayer,
      poolId,
      ownerInfo.wallet,
      nftMintAccount,
      positionNftAccount,
      protocolPosition,
      tickArrayLower,
      tickArrayUpper,
      personalPosition,
      ownerInfo.tokenAccountA,
      ownerInfo.tokenAccountB,
      poolInfo.vaultA,
      poolInfo.vaultB,
      poolInfo.mintA,
      poolInfo.mintB,
      tickLower,
      tickUpper,
      tickArrayLowerStartIndex,
      tickArrayUpperStartIndex,
      liquidity,
      amountMaxA,
      amountMaxB,
      withMetadata,
      PoolUtils.isOverflowDefaultTickarrayBitmap(tickSpacing, [
        tickArrayLowerStartIndex,
        tickArrayUpperStartIndex,
      ])
        ? getPdaExBitmapAccount(programId, poolId).publicKey
        : undefined
    );

    return {
      signers,
      instructions: [instruction],
    };
  }

  static async openPositionFromBaseInstruction(params: {
    poolInfo: IPoolLayoutWithId;
    ownerInfo: {
      feePayer: PublicKey;
      wallet: PublicKey;
      tokenAccountA: PublicKey;
      tokenAccountB: PublicKey;
    };
    tickLower: number;
    tickUpper: number;
    base: 'MintA' | 'MintB';
    baseAmount: BN;
    otherAmountMax: BN;
    withMetadata: 'create' | 'no-create';
  }): Promise<{
    instructions: TransactionInstruction[];
    signers: Signer[];
  }> {
    // console.log('[clmm sdk] openPositionFromBaseInstruction fn params:', JSON.stringify(params, null, 2));

    const {
      poolInfo,
      ownerInfo,
      tickLower,
      tickUpper,
      base,
      baseAmount,
      otherAmountMax,
      withMetadata,
    } = params;
    const signers: Signer[] = [];

    const { programId, poolId, tickSpacing } = poolInfo;

    const keypair = Keypair.generate();
    signers.push(keypair);
    const nftMintAccount = keypair.publicKey;

    const tickArrayLowerStartIndex = TickUtils.getTickArrayStartIndexByTick(tickLower, tickSpacing);
    const tickArrayUpperStartIndex = TickUtils.getTickArrayStartIndexByTick(tickUpper, tickSpacing);

    const { publicKey: tickArrayLower } = getPdaTickArrayAddress(
      programId,
      poolId,
      tickArrayLowerStartIndex
    );
    const { publicKey: tickArrayUpper } = getPdaTickArrayAddress(
      programId,
      poolId,
      tickArrayUpperStartIndex
    );

    const { publicKey: positionNftAccount } = getATAAddress(
      ownerInfo.wallet,
      nftMintAccount,
      TOKEN_2022_PROGRAM_ID
    );
    const { publicKey: personalPosition } = getPdaPersonalPositionAddress(
      programId,
      nftMintAccount
    );
    const { publicKey: protocolPosition } = getPdaProtocolPositionAddress(
      programId,
      poolId,
      tickLower,
      tickUpper
    );

    const instruction = await BaseInstruction.openPositionFromBaseInstruction22(
      programId,
      ownerInfo.feePayer,
      poolId,
      ownerInfo.wallet,
      nftMintAccount,
      positionNftAccount,
      protocolPosition,
      tickArrayLower,
      tickArrayUpper,
      personalPosition,
      ownerInfo.tokenAccountA,
      ownerInfo.tokenAccountB,
      poolInfo.vaultA,
      poolInfo.vaultB,
      poolInfo.mintA,
      poolInfo.mintB,
      tickLower,
      tickUpper,
      tickArrayLowerStartIndex,
      tickArrayUpperStartIndex,
      withMetadata,
      base,
      baseAmount,
      otherAmountMax,
      PoolUtils.isOverflowDefaultTickarrayBitmap(tickSpacing, [
        tickArrayLowerStartIndex,
        tickArrayUpperStartIndex,
      ])
        ? getPdaExBitmapAccount(programId, poolId).publicKey
        : undefined
    );

    return {
      instructions: [instruction],
      signers,
    };
  }

  static async closePositionInstruction(params: {
    programId: PublicKey;
    nftMint: PublicKey;
    ownerWallet: PublicKey;
  }): Promise<{
    instructions: TransactionInstruction[];
  }> {
    // console.log('[clmm sdk] closePositionInstruction fn params:', JSON.stringify(params, null, 2));

    const { programId, nftMint, ownerWallet } = params;
    const positionNftAccount = getATAAddress(ownerWallet, nftMint, TOKEN_2022_PROGRAM_ID).publicKey;

    const instruction = await BaseInstruction.closePositionInstruction(
      programId,
      ownerWallet,
      nftMint,
      positionNftAccount,
      true
    );

    return {
      instructions: [instruction],
    };
  }

  static async increasePositionFromLiquidityInstructions(params: {
    poolInfo: IPoolLayoutWithId;
    ownerPosition: IPersonalPositionLayout;
    ownerInfo: {
      wallet: PublicKey;
      tokenAccountA: PublicKey;
      tokenAccountB: PublicKey;
    };

    liquidity: BN;
    amountMaxA: BN;
    amountMaxB: BN;
  }): Promise<{
    instructions: TransactionInstruction[];
  }> {
    // console.log('[clmm sdk] increasePositionFromLiquidityInstructions fn params:', JSON.stringify(params, null, 2));

    const { poolInfo, ownerPosition, ownerInfo, liquidity, amountMaxA, amountMaxB } = params;
    const { programId, poolId, tickSpacing } = poolInfo;

    const tickArrayLowerStartIndex = TickUtils.getTickArrayStartIndexByTick(
      ownerPosition.tickLower,
      tickSpacing
    );
    const tickArrayUpperStartIndex = TickUtils.getTickArrayStartIndexByTick(
      ownerPosition.tickUpper,
      tickSpacing
    );

    const { publicKey: tickArrayLower } = getPdaTickArrayAddress(
      programId,
      poolId,
      tickArrayLowerStartIndex
    );
    const { publicKey: tickArrayUpper } = getPdaTickArrayAddress(
      programId,
      poolId,
      tickArrayUpperStartIndex
    );

    const { publicKey: positionNftAccount } = getATAAddress(
      ownerInfo.wallet,
      ownerPosition.nftMint,
      TOKEN_2022_PROGRAM_ID
    );

    const { publicKey: personalPosition } = getPdaPersonalPositionAddress(
      programId,
      ownerPosition.nftMint
    );
    const { publicKey: protocolPosition } = getPdaProtocolPositionAddress(
      programId,
      poolId,
      ownerPosition.tickLower,
      ownerPosition.tickUpper
    );

    const instruction = await BaseInstruction.increasePositionFromLiquidityInstruction(
      programId,
      ownerInfo.wallet,
      positionNftAccount,
      personalPosition,
      poolId,
      protocolPosition,
      tickArrayLower,
      tickArrayUpper,
      ownerInfo.tokenAccountA,
      ownerInfo.tokenAccountB,
      poolInfo.vaultA,
      poolInfo.vaultB,
      poolInfo.mintA,
      poolInfo.mintB,
      liquidity,
      amountMaxA,
      amountMaxB,
      PoolUtils.isOverflowDefaultTickarrayBitmap(tickSpacing, [
        tickArrayLowerStartIndex,
        tickArrayUpperStartIndex,
      ])
        ? getPdaExBitmapAccount(programId, poolId).publicKey
        : undefined
    );

    return {
      instructions: [instruction],
    };
  }

  static async increasePositionFromBaseInstructions(params: {
    poolInfo: IPoolLayoutWithId;
    ownerPosition: IPersonalPositionLayout;
    ownerInfo: {
      wallet: PublicKey;
      tokenAccountA: PublicKey;
      tokenAccountB: PublicKey;
    };
    base: 'MintA' | 'MintB';
    baseAmount: BN;
    otherAmountMax: BN;
  }): Promise<{
    instructions: TransactionInstruction[];
  }> {
    // console.log('[clmm sdk] increasePositionFromBaseInstructions fn params:', JSON.stringify(params, null, 2));

    const { poolInfo, ownerPosition, ownerInfo, base, baseAmount, otherAmountMax } = params;
    const { programId, poolId, tickSpacing } = poolInfo;

    const tickArrayLowerStartIndex = TickUtils.getTickArrayStartIndexByTick(
      ownerPosition.tickLower,
      tickSpacing
    );
    const tickArrayUpperStartIndex = TickUtils.getTickArrayStartIndexByTick(
      ownerPosition.tickUpper,
      tickSpacing
    );

    const { publicKey: tickArrayLower } = getPdaTickArrayAddress(
      programId,
      poolId,
      tickArrayLowerStartIndex
    );
    const { publicKey: tickArrayUpper } = getPdaTickArrayAddress(
      programId,
      poolId,
      tickArrayUpperStartIndex
    );

    const { publicKey: positionNftAccount } = getATAAddress(
      ownerInfo.wallet,
      ownerPosition.nftMint,
      TOKEN_2022_PROGRAM_ID
    );

    const { publicKey: personalPosition } = getPdaPersonalPositionAddress(
      programId,
      ownerPosition.nftMint
    );
    const { publicKey: protocolPosition } = getPdaProtocolPositionAddress(
      programId,
      poolId,
      ownerPosition.tickLower,
      ownerPosition.tickUpper
    );

    const instruction = await BaseInstruction.increasePositionFromBaseInstruction(
      programId,
      ownerInfo.wallet,
      positionNftAccount,
      personalPosition,
      poolId,
      protocolPosition,
      tickArrayLower,
      tickArrayUpper,
      ownerInfo.tokenAccountA,
      ownerInfo.tokenAccountB,
      poolInfo.vaultA,
      poolInfo.vaultB,
      poolInfo.mintA,
      poolInfo.mintB,
      base,
      baseAmount,
      otherAmountMax,
      PoolUtils.isOverflowDefaultTickarrayBitmap(tickSpacing, [
        tickArrayLowerStartIndex,
        tickArrayUpperStartIndex,
      ])
        ? getPdaExBitmapAccount(programId, poolId).publicKey
        : undefined
    );

    return {
      instructions: [instruction],
    };
  }

  static async decreaseLiquidityInstructions(params: {
    poolInfo: IPoolLayoutWithId;
    ownerPosition: IPersonalPositionLayout;
    ownerInfo: {
      wallet: PublicKey;
      tokenAccountA: PublicKey;
      tokenAccountB: PublicKey;
      // rewardAccounts: PublicKey[];
    };
    liquidity: BN;
    amountMinA: BN;
    amountMinB: BN;
  }): Promise<{
    instructions: TransactionInstruction[];
  }> {
    // console.log('[clmm sdk] decreaseLiquidityInstructions fn params:', JSON.stringify(params, null, 2));

    const { poolInfo, ownerPosition, ownerInfo, liquidity, amountMinA, amountMinB } = params;
    const { programId, poolId, tickSpacing } = poolInfo;

    const tickArrayLowerStartIndex = TickUtils.getTickArrayStartIndexByTick(
      ownerPosition.tickLower,
      tickSpacing
    );
    const tickArrayUpperStartIndex = TickUtils.getTickArrayStartIndexByTick(
      ownerPosition.tickUpper,
      tickSpacing
    );

    const { publicKey: tickArrayLower } = getPdaTickArrayAddress(
      programId,
      poolId,
      tickArrayLowerStartIndex
    );
    const { publicKey: tickArrayUpper } = getPdaTickArrayAddress(
      programId,
      poolId,
      tickArrayUpperStartIndex
    );
    const { publicKey: positionNftAccount } = getATAAddress(
      ownerInfo.wallet,
      ownerPosition.nftMint,
      TOKEN_2022_PROGRAM_ID
    );
    const { publicKey: personalPosition } = getPdaPersonalPositionAddress(
      programId,
      ownerPosition.nftMint
    );
    const { publicKey: protocolPosition } = getPdaProtocolPositionAddress(
      programId,
      poolId,
      ownerPosition.tickLower,
      ownerPosition.tickUpper
    );

    const rewardAccounts = poolInfo.rewardInfos
      .filter((info) => !info.openTime.isZero() && !info.tokenMint.equals(PublicKey.default))
      .map((rewardInfo) => ({
        poolRewardVault: rewardInfo.tokenVault,
        ownerRewardVault: getATAAddress(ownerInfo.wallet, rewardInfo.tokenMint).publicKey,
        rewardMint: rewardInfo.tokenMint,
      }));

    const instruction = await BaseInstruction.decreaseLiquidityInstruction(
      programId,
      ownerInfo.wallet,
      positionNftAccount,
      personalPosition,
      poolId,
      protocolPosition,
      tickArrayLower,
      tickArrayUpper,
      ownerInfo.tokenAccountA,
      ownerInfo.tokenAccountB,
      poolInfo.vaultA,
      poolInfo.vaultB,
      poolInfo.mintA,
      poolInfo.mintB,
      rewardAccounts,

      liquidity,
      amountMinA,
      amountMinB,
      PoolUtils.isOverflowDefaultTickarrayBitmap(tickSpacing, [
        tickArrayLowerStartIndex,
        tickArrayUpperStartIndex,
      ])
        ? getPdaExBitmapAccount(programId, poolId).publicKey
        : undefined
    );

    return {
      instructions: [instruction],
    };
  }

  static async swapBaseInInstruction(params: {
    poolInfo: IPoolLayoutWithId;
    ownerInfo: {
      wallet: PublicKey;
      tokenAccountA: PublicKey;
      tokenAccountB: PublicKey;
    };
    amount: BN;
    otherAmountThreshold: BN;
    sqrtPriceLimitX64: BN;
    isInputMintA: boolean;
    exTickArrayBitmap?: PublicKey;
    tickArray: PublicKey[];
  }) {
    const {
      poolInfo,
      ownerInfo,
      amount,
      otherAmountThreshold,
      sqrtPriceLimitX64,
      exTickArrayBitmap,
      tickArray,
      isInputMintA,
    } = params;

    const instruction = await BaseInstruction.swapInstruction(
      poolInfo.programId,
      ownerInfo.wallet,
      poolInfo.poolId,
      poolInfo.ammConfig,
      isInputMintA ? ownerInfo.tokenAccountA : ownerInfo.tokenAccountB,
      isInputMintA ? ownerInfo.tokenAccountB : ownerInfo.tokenAccountA,
      isInputMintA ? poolInfo.vaultA : poolInfo.vaultB,
      isInputMintA ? poolInfo.vaultB : poolInfo.vaultA,
      isInputMintA ? poolInfo.mintA : poolInfo.mintB,
      isInputMintA ? poolInfo.mintB : poolInfo.mintA,
      tickArray,
      poolInfo.observationId,
      amount,
      otherAmountThreshold,
      sqrtPriceLimitX64,
      true,
      exTickArrayBitmap
    );

    return {
      instructions: [instruction],
    };
  }

  static async swapBaseOutInstruction(params: {
    poolInfo: IPoolLayoutWithId;
    ownerInfo: {
      wallet: PublicKey;
      tokenAccountA: PublicKey;
      tokenAccountB: PublicKey;
    };
    amount: BN;
    otherAmountThreshold: BN;
    sqrtPriceLimitX64: BN;
    isOutputMintA: boolean;
    exTickArrayBitmap?: PublicKey;
    tickArray: PublicKey[];
  }) {
    const {
      poolInfo,
      ownerInfo,
      amount,
      otherAmountThreshold,
      sqrtPriceLimitX64,
      exTickArrayBitmap,
      tickArray,
      isOutputMintA,
    } = params;

    // For exact output, input and output are reversed
    // If output is mintA, then input is mintB
    const instruction = await BaseInstruction.swapInstruction(
      poolInfo.programId,
      ownerInfo.wallet,
      poolInfo.poolId,
      poolInfo.ammConfig,
      isOutputMintA ? ownerInfo.tokenAccountB : ownerInfo.tokenAccountA,
      isOutputMintA ? ownerInfo.tokenAccountA : ownerInfo.tokenAccountB,
      isOutputMintA ? poolInfo.vaultB : poolInfo.vaultA,
      isOutputMintA ? poolInfo.vaultA : poolInfo.vaultB,
      isOutputMintA ? poolInfo.mintB : poolInfo.mintA,
      isOutputMintA ? poolInfo.mintA : poolInfo.mintB,
      tickArray,
      poolInfo.observationId,
      amount,
      otherAmountThreshold,
      sqrtPriceLimitX64,
      false, // isBaseInput = false for exact output
      exTickArrayBitmap
    );

    return {
      instructions: [instruction],
    };
  }
}
