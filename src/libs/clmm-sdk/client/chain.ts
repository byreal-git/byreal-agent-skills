import {
  TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  createInitializeAccountInstruction,
  createCloseAccountInstruction,
  createAssociatedTokenAccountIdempotentInstruction,
  AccountLayout,
  MintLayout,
  TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token';
import {
  Connection,
  PublicKey,
  VersionedTransaction,
  SystemProgram,
  TransactionInstruction,
} from '@solana/web3.js';
import BN from 'bn.js';
import { Decimal } from 'decimal.js';

import { BYREAL_CLMM_PROGRAM_ID, MEMO_PROGRAM_ID, U64_IGNORE_RANGE } from '../constants.js';
import {
  IPoolLayoutWithId,
  IPersonalPositionLayout,
  PositionUtils,
  RawDataUtils,
  SqrtPriceMath,
  TickMath,
  TickUtils,
  Instruction,
  getATAAddress,
  ITokenInfo,
  getPdaMintExAccount,
  getPdaTickArrayAddress,
  PoolUtils,
  getTickArrayBitmapExtension,
  getTickArrayInfo,
  getPdaExBitmapAccount,
  MIN_SQRT_PRICE_X64,
  MAX_SQRT_PRICE_X64,
  TickArrayUtils,
} from '../instructions/index';
import { generatePubKey } from '../utils/generatePubKey';
import {
  makeTransaction,
  sendTransaction,
  estimateComputeUnits,
  DEFAULT_COMPUTE_UNIT_PRICE,
} from '../utils/index';

import {
  IAddLiquidityParams,
  IClosePositionParams,
  ICollectFeesParams,
  ICreatePoolParams,
  IQuoteSwapExactOutParams,
  IQuoteSwapExactOutReturn,
  ISwapExactOutParams,
  ICreatePositionParams,
  IDecreaseFullLiquidityParams,
  IDecreaseLiquidityParams,
  IInstructionReturn,
  ParamsWithSignerCallback,
  ICollectAllFeesParams,
  SignerCallback,
  IGetPositionInfoByNftMintReturn,
  ICalculateCreatePositionFee,
  IQouteSwapParams,
  IQouteSwapReturn,
  ISwapParams,
} from './models';
import {
  alignPriceToTickPrice,
  calculateApr,
  calculateRewardApr,
  calculateRangeAprs,
  getAmountAFromAmountB,
  getAmountBFromAmountA,
  getTokenProgramId,
} from './utils';

/*
 * Chain class: Encapsulates chain-level operations related to CLMM (Concentrated Liquidity Market Maker)

 * Includes position, pool, token information retrieval, liquidity operations, fee collection, etc.
 * Mainly depends on Solana web3.js, @solana/spl-token instruction tools
 */
export class Chain {
  public connection: Connection;
  public programId: PublicKey;
  // Cache rent fee calculation results
  private rentFeeCache: { [key: number]: number } = {};

  /**
   * Constructor
   * @param params.connection Solana chain connection object
   * @param params.programId CLMM program ID, default is CLMM_PROGRAM_ID
   */
  constructor(params: { connection: Connection; programId?: PublicKey }) {
    const { connection, programId = BYREAL_CLMM_PROGRAM_ID } = params;
    this.connection = connection;
    this.programId = programId;
  }

  /**
   * Get all CLMM position information for a specified account
   * @param userAddress User wallet address
   * @returns Promise<IPersonalPositionLayout[]> Position information list
   */
  public async getRawPositionInfoListByUserAddress(
    userAddress: PublicKey
  ): Promise<IPersonalPositionLayout[]> {
    return RawDataUtils.getRawPositionInfoListByUserAddress({
      connection: this.connection,
      programId: this.programId,
      userAddress,
    });
  }

  /**
   * Get the corresponding position information based on the NFT mint address
   * @param nftMint NFT mint address
   * @returns Promise<IPersonalPositionLayout | null> Position information
   */
  public async getRawPositionInfoByNftMint(
    nftMint: PublicKey
  ): Promise<IPersonalPositionLayout | null> {
    return RawDataUtils.getRawPositionInfoByNftMint({
      connection: this.connection,
      programId: this.programId,
      nftMint,
    });
  }

  /**
   * Get the corresponding pool information based on the pool address
   * @param poolId Pool address or PublicKey
   * @returns Promise<IPoolLayoutWithId> Pool information
   */
  public async getRawPoolInfoByPoolId(poolId: string | PublicKey): Promise<IPoolLayoutWithId> {
    const poolInfo = await RawDataUtils.getRawPoolInfoByPoolId({
      connection: this.connection,
      poolId,
    });
    if (!poolInfo) throw new Error(`pool info not found, poolId: ${String(poolId)}`);
    return poolInfo;
  }

  /**
   * Get the corresponding token information based on the token mint address
   * @param mintAddress Token mint address
   * @returns Promise<...> Token information
   */
  public async getRawTokenInfoByMint(
    mintAddress: PublicKey
  ): Promise<(ReturnType<typeof MintLayout.decode> & { owner: PublicKey }) | null> {
    const tokenInfo = await RawDataUtils.getRawTokenInfoByMint({
      connection: this.connection,
      mintAddress,
    });
    if (!tokenInfo) throw new Error(`token info not found, mintAddress: ${String(mintAddress)}`);
    return tokenInfo;
  }

  /**
   * Get the simplified token information (including address, precision, and programId)
   * @param mintAddress Token mint address
   * @returns Promise<ITokenInfo>
   */
  public async getTokenInfoByMint(mintAddress: PublicKey): Promise<ITokenInfo> {
    const tokenInfo = await this.getRawTokenInfoByMint(mintAddress);
    if (!tokenInfo) throw new Error(`token info not found, mintAddress: ${String(mintAddress)}`);
    return {
      address: mintAddress.toBase58(),
      decimals: tokenInfo.decimals,
      programId: tokenInfo.owner.toBase58(),
    };
  }

  /**
   * Get the detailed position information, including price range, token amount, fee, etc.
   * @param nftMint NFT mint address
   * @returns Promise<{...}> Detailed position information
   */
  public async getPositionInfoByNftMint(
    nftMint: PublicKey
  ): Promise<IGetPositionInfoByNftMintReturn | null> {
    const rawPositionInfo = await this.getRawPositionInfoByNftMint(nftMint);
    if (!rawPositionInfo) return null;
    const rawPoolInfo = await this.getRawPoolInfoByPoolId(rawPositionInfo.poolId);
    const { mintDecimalsA, mintDecimalsB, tickSpacing, programId } = rawPoolInfo;

    // Calculate the price corresponding to tickLower/tickUpper
    const priceLower = TickMath.getPriceFromTick({
      tick: rawPositionInfo.tickLower,
      decimalsA: mintDecimalsA,
      decimalsB: mintDecimalsB,
    });
    const priceUpper = TickMath.getPriceFromTick({
      tick: rawPositionInfo.tickUpper,
      decimalsA: mintDecimalsA,
      decimalsB: mintDecimalsB,
    });
    // Calculate the actual token amount held in the position
    const { amountA, amountB } = PositionUtils.getAmountsFromLiquidity({
      poolInfo: rawPoolInfo,
      ownerPosition: rawPositionInfo,
      liquidity: rawPositionInfo.liquidity,
      slippage: 0,
      add: false,
      epochInfo: await this.connection.getEpochInfo(),
    });
    // Calculate the amount of tokens displayed on the UI
    const [pooledAmountA, pooledAmountB] = [
      new Decimal(amountA.amount.toString()).div(10 ** mintDecimalsA),
      new Decimal(amountB.amount.toString()).div(10 ** mintDecimalsB),
    ];
    // Get the tickArray address
    const [tickLowerArrayAddress, tickUpperArrayAddress] = [
      TickUtils.getTickArrayAddressByTick(
        new PublicKey(programId),
        new PublicKey(rawPositionInfo.poolId),
        rawPositionInfo.tickLower,
        tickSpacing
      ),
      TickUtils.getTickArrayAddressByTick(
        new PublicKey(programId),
        new PublicKey(rawPositionInfo.poolId),
        rawPositionInfo.tickUpper,
        tickSpacing
      ),
    ];
    // Get the tickArray data
    const tickArrayRes = await this.connection.getMultipleAccountsInfo([
      tickLowerArrayAddress,
      tickUpperArrayAddress,
    ]);
    if (!tickArrayRes[0] || !tickArrayRes[1]) throw new Error('tick data not found');

    // Parse as containers (supports both fixed and dynamic tick arrays)
    const tickArrayLowerContainer = TickArrayUtils.parseTickArrayContainer(
      tickArrayRes[0].data,
      tickLowerArrayAddress
    );
    const tickArrayUpperContainer = TickArrayUtils.parseTickArrayContainer(
      tickArrayRes[1].data,
      tickUpperArrayAddress
    );

    // Get the tick state using container helper
    const tickLowerState = TickArrayUtils.getTickStateFromContainer(
      tickArrayLowerContainer,
      rawPositionInfo.tickLower,
      rawPoolInfo.tickSpacing
    );
    const tickUpperState = TickArrayUtils.getTickStateFromContainer(
      tickArrayUpperContainer,
      rawPositionInfo.tickUpper,
      rawPoolInfo.tickSpacing
    );

    // Validate tick states
    if (!tickLowerState || !tickUpperState) {
      throw new Error('Tick state not found in tick array');
    }

    // Calculate the fee (original logic unchanged)
    const tokenFees = PositionUtils.getPositionFees(
      rawPoolInfo,
      rawPositionInfo,
      tickLowerState,
      tickUpperState
    );
    // Filter out abnormal fees
    const [tokenFeeAmountA, tokenFeeAmountB] = [
      tokenFees.tokenFeeAmountA.gte(new BN(0)) && tokenFees.tokenFeeAmountA.lt(U64_IGNORE_RANGE)
        ? tokenFees.tokenFeeAmountA
        : new BN(0),
      tokenFees.tokenFeeAmountB.gte(new BN(0)) && tokenFees.tokenFeeAmountB.lt(U64_IGNORE_RANGE)
        ? tokenFees.tokenFeeAmountB
        : new BN(0),
    ];
    return {
      priceLower,
      priceUpper,
      uiPriceLower: priceLower.toFixed(mintDecimalsA),
      uiPriceUpper: priceUpper.toFixed(mintDecimalsB),
      tokenA: {
        address: rawPoolInfo.mintA,
        decimals: rawPoolInfo.mintDecimalsA,
        amount: amountA.amount,
        feeAmount: tokenFeeAmountA,
        uiAmount: pooledAmountA.toString(),
        uiFeeAmount: new Decimal(tokenFeeAmountA.toString())
          .dividedBy(new Decimal(10).pow(mintDecimalsA))
          .toFixed(mintDecimalsA),
      },
      tokenB: {
        address: rawPoolInfo.mintB,
        decimals: rawPoolInfo.mintDecimalsB,
        amount: amountB.amount,
        feeAmount: tokenFeeAmountB,
        uiAmount: pooledAmountB.toString(),
        uiFeeAmount: new Decimal(tokenFeeAmountB.toString())
          .dividedBy(new Decimal(10).pow(mintDecimalsB))
          .toFixed(mintDecimalsB),
      },
      rawPositionInfo,
      rawPoolInfo,
    };
  }

  /**
   * Create position instructions on the chain (does not directly send transactions)
   * @param params Parameters required for creating a position
   * @returns IInstructionReturn Contains instructions, signers, and transaction objects
   */
  public async createPositionInstructions(
    params: ICreatePositionParams
  ): Promise<IInstructionReturn> {
    const {
      userAddress,
      poolInfo,
      tickLower,
      tickUpper,
      base,
      baseAmount,
      otherAmountMax,
      transactionOptions,
      refererPosition,
    } = params;
    const { mintA, mintB } = poolInfo;

    // Calculate the actual required tokenA/B amount
    const amountA = base === 'MintA' ? baseAmount : otherAmountMax;
    const amountB = base === 'MintB' ? baseAmount : otherAmountMax;

    const { tokenAccountA, tokenAccountB, preInstructions, endInstructions } =
      await this.handleTokenAccount({
        userAddress,
        mintA,
        mintB,
        amountA,
        amountB,
      });

    // Generate position creation instructions
    const { instructions: positionInstructions, signers: positionSigners } =
      await Instruction.openPositionFromBaseInstruction({
        poolInfo,
        ownerInfo: {
          feePayer: userAddress,
          wallet: userAddress,
          tokenAccountA,
          tokenAccountB,
        },
        tickLower,
        tickUpper,
        base,
        baseAmount,
        otherAmountMax,
        withMetadata: 'create',
      });

    const memoInstruction = refererPosition
      ? createMemoInstruction(`referer_position=${refererPosition}`, [userAddress])
      : null;

    // Merge all instructions: pre → position → memo → cleanup
    const instructions = [
      ...preInstructions, // SOL/WSOL handling
      ...positionInstructions, // Position creation
      ...(memoInstruction ? [memoInstruction] : []), // Referral tracking
      ...endInstructions, // Cleanup
    ];

    const signers = [...positionSigners];

    // Construct transaction object
    const transaction = await makeTransaction({
      connection: this.connection,
      payerPublicKey: userAddress,
      instructions,
      signers,
      options: transactionOptions,
    });

    return {
      instructions,
      signers,
      nftAddress: positionSigners[0].publicKey.toString(),
      transaction,
    };
  }

  /**
   * Calculate the rent fee required for creating a position
   *
   * @param params Parameters required for creating a position and options
   */
  public async calculateCreatePositionFee(
    params: ICreatePositionParams & {
      useCache?: boolean; // Whether to use cache, if true, the rent fee will not be recalculated through rpc; default is true
    }
  ): Promise<ICalculateCreatePositionFee> {
    const {
      userAddress,
      poolInfo,
      tickLower,
      tickUpper,
      base,
      baseAmount,
      otherAmountMax,
      transactionOptions,
      refererPosition,
      useCache = true,
    } = params;

    const computeUnitPrice = transactionOptions?.computeUnitPrice || DEFAULT_COMPUTE_UNIT_PRICE;

    // Define account size constants (this is fixed hardcode)
    const ACCOUNT_SIZES = {
      NFT_MINT: 480,
      NFT_HOLDER: 170,
      PERSONAL_POSITION: 281,
      TICK_ARRAY: 10240,
    };

    const { programId, poolId, tickSpacing } = poolInfo;
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

    const [
      blockhashData,
      tickArrayLowerInfo,
      tickArrayUpperInfo,
      nftMintRentLamports,
      nftHolderRentLamports,
      personalPositionRentLamports,
      tickArrayRentLamports,
    ] = await Promise.all([
      this.connection.getLatestBlockhash(),
      this.connection.getAccountInfo(tickArrayLower),
      this.connection.getAccountInfo(tickArrayUpper),
      this.estimateRentFee(ACCOUNT_SIZES.NFT_MINT, useCache),
      this.estimateRentFee(ACCOUNT_SIZES.NFT_HOLDER, useCache),
      this.estimateRentFee(ACCOUNT_SIZES.PERSONAL_POSITION, useCache),
      this.estimateRentFee(ACCOUNT_SIZES.TICK_ARRAY, useCache),
    ]);

    // Check if the tick array exists
    const isTickArrayLowerExists = !!tickArrayLowerInfo;
    const isTickArrayUpperExists = !!tickArrayUpperInfo;

    // Prepare instructions to estimate compute units
    const { mintA, mintB } = poolInfo;
    const amountA = base === 'MintA' ? baseAmount : otherAmountMax;
    const amountB = base === 'MintB' ? baseAmount : otherAmountMax;

    const { tokenAccountA, tokenAccountB, preInstructions, endInstructions } =
      await this.handleTokenAccount({
        userAddress,
        mintA,
        mintB,
        amountA,
        amountB,
      });

    let positionInstructions: TransactionInstruction[] = [];

    // Try to generate position creation instructions
    try {
      const { instructions } = await Instruction.openPositionFromBaseInstruction({
        poolInfo,
        ownerInfo: {
          feePayer: userAddress,
          wallet: userAddress,
          tokenAccountA,
          tokenAccountB,
        },
        tickLower,
        tickUpper,
        base,
        baseAmount,
        otherAmountMax,
        withMetadata: 'create',
      });
      positionInstructions = instructions;
    } catch {
      // console.error('error ==> ', error);
    }

    const memoInstruction = refererPosition
      ? createMemoInstruction(`referer_position=${refererPosition}`, [userAddress])
      : null;

    // Estimate compute units and transaction fees
    const computeUnits = await estimateComputeUnits(
      this.connection,
      [
        ...preInstructions,
        ...positionInstructions,
        ...(memoInstruction ? [memoInstruction] : []),
        ...endInstructions,
      ],
      userAddress,
      blockhashData.blockhash
    );

    // 1 SOL = 10^9 lamports, 1 lamport = 10^6 microLamports
    const transactionNetFee = (computeUnits * computeUnitPrice) / 10 ** 15;

    const refundableFees =
      (nftMintRentLamports + nftHolderRentLamports + personalPositionRentLamports) / 10 ** 9;

    // Unrefundable fees include transaction fees and newly created shared tick array accounts
    let createTickFee = 0;

    if (!isTickArrayLowerExists) {
      createTickFee += tickArrayRentLamports / 10 ** 9;
    }
    if (!isTickArrayUpperExists) {
      createTickFee += tickArrayRentLamports / 10 ** 9;
    }

    return {
      unRefundableFees: transactionNetFee + createTickFee, // Unrefundable fees
      transactionNetFee, // Transaction network fee
      refundableFees, // Refundable fees
      createTickFee, // Create tick array account fee
    };
  }

  /**
   * Create a new position and send a transaction
   * @param params Parameters required for creating a position, including a signature callback
   * @returns Promise<string> Transaction signature
   */
  public async createPosition(
    params: ParamsWithSignerCallback<ICreatePositionParams>
  ): Promise<string> {
    const { signerCallback } = params;
    const { transaction } = await this.createPositionInstructions(params);
    return sendTransaction({
      connection: this.connection,
      signTx: () => signerCallback(transaction),
    });
  }

  /**
   * Close the specified position (only when the liquidity is 0, it can be closed)
   * @param params.userAddress User wallet address
   * @param params.nftMint NFT mint address
   * @returns IInstructionReturn Contains instructions and transaction objects
   */
  public async closePositionInstructions(
    params: IClosePositionParams
  ): Promise<IInstructionReturn> {
    const { userAddress, nftMint } = params;
    // Get position detailed information
    const positionInfo = await this.getPositionInfoByNftMint(nftMint);
    if (!positionInfo) throw new Error('Position not found');
    const mintA = positionInfo.rawPoolInfo.mintA;
    const mintB = positionInfo.rawPoolInfo.mintB;
    // Handle SOL/WSOL packaging
    const { preInstructions, endInstructions } = await this.handleTokenAccount({
      userAddress,
      mintA,
      mintB,
    });
    // Generate close position instructions
    const { instructions: closeInstructions } = await Instruction.closePositionInstruction({
      programId: this.programId,
      nftMint,
      ownerWallet: userAddress,
    });
    // Merge all instructions
    const instructions = [...preInstructions, ...closeInstructions, ...endInstructions];
    // Construct transaction object
    const transaction = await makeTransaction({
      connection: this.connection,
      payerPublicKey: userAddress,
      instructions,
    });
    return {
      instructions,
      transaction,
    };
  }

  /**
   * Close the specified position and send a transaction
   * @param params.userAddress User wallet address
   * @param params.nftMint NFT mint address
   * @param params.signerCallback Signature callback
   * @returns Promise<string> Transaction signature
   */
  public async closePosition(params: {
    userAddress: PublicKey;
    nftMint: PublicKey;
    signerCallback: SignerCallback;
  }): Promise<string> {
    const { userAddress, nftMint, signerCallback } = params;
    const { transaction } = await this.closePositionInstructions({
      userAddress,
      nftMint,
    });
    return sendTransaction({
      connection: this.connection,
      signTx: () => signerCallback(transaction),
    });
  }

  /**
   * Partially remove position liquidity, generate chain instructions
   * @param params Contains user, position, removed liquidity amount, slippage, etc.
   * @returns IInstructionReturn
   */
  public async decreaseLiquidityInstructions(
    params: IDecreaseLiquidityParams
  ): Promise<IInstructionReturn> {
    // Slippage is set to 2% by default
    const { userAddress, nftMint, liquidity, slippage = 0.02 } = params;
    // Get position raw information
    const positionInfo = await this.getRawPositionInfoByNftMint(nftMint);
    if (!positionInfo) throw new Error('Position not found');
    // Check if the removed liquidity amount is valid
    if (liquidity.gt(positionInfo.liquidity))
      throw new Error('Liquidity is greater than position liquidity');
    // Get pool information
    const poolInfo = await this.getRawPoolInfoByPoolId(positionInfo.poolId);
    // Handle SOL/WSOL packaging
    const { tokenAccountA, tokenAccountB, preInstructions, endInstructions } =
      await this.handleTokenAccount({
        userAddress,
        mintA: poolInfo.mintA,
        mintB: poolInfo.mintB,
      });
    // Calculate the expected token amount after removing liquidity (considering slippage)
    const { amountSlippageA, amountSlippageB } = PositionUtils.getAmountsFromLiquidity({
      poolInfo,
      ownerPosition: positionInfo,
      liquidity,
      slippage,
      add: false,
      epochInfo: await this.connection.getEpochInfo(),
    });
    // Calculate the minimum accepted token amount
    const amountMinA = amountSlippageA.amount;
    const amountMinB = amountSlippageB.amount;
    // Generate remove liquidity instructions
    const { instructions: decreaseInstructions } = await Instruction.decreaseLiquidityInstructions({
      poolInfo,
      ownerPosition: positionInfo,
      ownerInfo: {
        wallet: userAddress,
        tokenAccountA,
        tokenAccountB,
      },
      liquidity,
      amountMinA,
      amountMinB,
    });
    // Merge all instructions
    const instructions = [...preInstructions, ...decreaseInstructions, ...endInstructions];
    // Construct transaction object
    const transaction = await makeTransaction({
      connection: this.connection,
      payerPublicKey: userAddress,
      instructions,
    });
    return {
      instructions,
      transaction,
    };
  }

  /**
   * Partially remove position liquidity and send a transaction
   * @param params Contains signature callback, etc.
   * @returns Promise<string> Transaction signature
   */
  public async decreaseLiquidity(
    params: ParamsWithSignerCallback<IDecreaseLiquidityParams>
  ): Promise<string> {
    const { signerCallback } = params;
    const { transaction } = await this.decreaseLiquidityInstructions(params);
    return sendTransaction({
      connection: this.connection,
      signTx: () => signerCallback(transaction),
    });
  }

  /**
   * Remove all position liquidity (optional to automatically close position)
   * @param params.closePosition Whether to close position automatically
   * @param params Other parameters are the same as decreaseLiquidityInstructions
   * @returns IInstructionReturn
   */
  public async decreaseFullLiquidityInstructions(
    params: IDecreaseFullLiquidityParams
  ): Promise<IInstructionReturn> {
    // Slippage is set to 2% by default
    const { userAddress, nftMint, closePosition = true, slippage = 0.02 } = params;
    // Get position raw information
    const positionInfo = await this.getRawPositionInfoByNftMint(nftMint);
    if (!positionInfo) throw new Error('Position not found');
    // Get pool information
    const poolInfo = await this.getRawPoolInfoByPoolId(positionInfo.poolId);
    // Handle SOL/WSOL packaging
    const { tokenAccountA, tokenAccountB, preInstructions, endInstructions } =
      await this.handleTokenAccount({
        userAddress,
        mintA: poolInfo.mintA,
        mintB: poolInfo.mintB,
      });
    // Use all position liquidity
    const liquidity = positionInfo.liquidity;
    // Calculate the expected token amount after removing liquidity (considering slippage)
    const { amountSlippageA, amountSlippageB } = PositionUtils.getAmountsFromLiquidity({
      poolInfo,
      ownerPosition: positionInfo,
      liquidity,
      slippage,
      add: false, // When reducing liquidity, set to false
      epochInfo: await this.connection.getEpochInfo(),
    });
    // Minimum token amount after slippage adjustment
    const amountMinA = amountSlippageA.amount;
    const amountMinB = amountSlippageB.amount;
    // Generate remove liquidity instructions
    const { instructions: decreaseInstructions } = await Instruction.decreaseLiquidityInstructions({
      poolInfo,
      ownerPosition: positionInfo,
      ownerInfo: {
        wallet: userAddress,
        tokenAccountA,
        tokenAccountB,
      },
      liquidity,
      amountMinA,
      amountMinB,
    });
    // Merge all instructions
    const instructions = [...preInstructions, ...decreaseInstructions, ...endInstructions];
    // If you need to close the position, append the close instruction
    if (closePosition) {
      const { instructions: closeInstructions } = await Instruction.closePositionInstruction({
        programId: this.programId,
        nftMint,
        ownerWallet: userAddress,
      });
      instructions.push(...closeInstructions);
    }
    // Construct transaction object
    const transaction = await makeTransaction({
      connection: this.connection,
      payerPublicKey: userAddress,
      instructions,
    });
    return {
      instructions,
      transaction,
    };
  }

  /**
   * Remove all position liquidity and send a transaction
   * @param params Contains signature callback, etc.
   * @returns Promise<string> Transaction signature
   */
  public async decreaseFullLiquidity(
    params: ParamsWithSignerCallback<IDecreaseFullLiquidityParams>
  ): Promise<string> {
    const { signerCallback } = params;
    const { transaction } = await this.decreaseFullLiquidityInstructions(params);
    return sendTransaction({
      connection: this.connection,
      signTx: () => signerCallback(transaction),
    });
  }

  /**
   * Collect fees for a single position (essentially removing 0 liquidity)
   * @param params Contains user, position, etc.
   * @returns IInstructionReturn
   */
  public async collectFeesInstructions(params: ICollectFeesParams): Promise<IInstructionReturn> {
    const { userAddress, nftMint } = params;
    // Reuse the decreaseLiquidity function, pass in liquidity as 0
    return await this.decreaseLiquidityInstructions({
      userAddress,
      nftMint,
      liquidity: new BN(0),
    });
  }

  /**
   * Collect fees for all positions of a user, automatically batch to avoid exceeding transaction size limit
   * @param params.userAddress User wallet address
   * @param params.nftMintList NFT mint list
   * @returns { instructionsList, transactions } Batch instructions and transaction objects
   */
  public async collectAllPositionFeesInstructions(params: ICollectAllFeesParams): Promise<{
    instructionsList: TransactionInstruction[][];
    transactions: VersionedTransaction[];
  }> {
    const { userAddress, nftMintList } = params;
    // Cache pool information to avoid duplicate requests
    const poolInfoMap: Map<string, IPoolLayoutWithId> = new Map();
    const allInstructions: TransactionInstruction[][] = [];
    // let currentInstructions: TransactionInstruction[] = [];
    // Get rent exemption lamports
    const rentExemptLamports = await this.estimateRentFee(AccountLayout.span);
    for (const nftMint of nftMintList) {
      try {
        const positionInfo = await this.getRawPositionInfoByNftMint(nftMint);
        if (!positionInfo) throw new Error(`Position not found: ${nftMint.toBase58()}`);
        const poolId = positionInfo.poolId.toBase58();
        // Get or cache pool information
        if (!poolInfoMap.has(poolId)) {
          poolInfoMap.set(poolId, await this.getRawPoolInfoByPoolId(positionInfo.poolId));
        }
        const poolInfo = poolInfoMap.get(poolId);
        if (!poolInfo) throw new Error(`Pool not found: ${poolId}`);
        // Handle SOL/WSOL related
        const { tokenAccountA, tokenAccountB, preInstructions, endInstructions } =
          await this.handleTokenAccount({
            userAddress,
            mintA: poolInfo.mintA,
            mintB: poolInfo.mintB,
            rentExemptLamports,
          });
        // Generate instructions to collect fees (essentially removing 0 liquidity)
        const { instructions: decreaseInstructions } =
          await Instruction.decreaseLiquidityInstructions({
            poolInfo,
            ownerPosition: positionInfo,
            ownerInfo: {
              wallet: userAddress,
              tokenAccountA,
              tokenAccountB,
            },
            liquidity: new BN(0),
            amountMinA: new BN(0),
            amountMinB: new BN(0),
          });
        // All instructions for the current NFT
        const nftInstructions = [...preInstructions, ...decreaseInstructions, ...endInstructions];

        // Check if adding this NFT's instructions will exceed the transaction size limit
        // const tempInstructions = [...currentInstructions, ...nftInstructions];
        // const isValidSize = checkV0TxSize({
        //   instructions: tempInstructions,
        //   payer: userAddress,
        // });
        // if (!isValidSize && currentInstructions.length > 0) {
        // If adding will exceed the limit and there are existing instructions, save the current batch and start a new batch
        allInstructions.push(nftInstructions);
        // currentInstructions = nftInstructions;
        // } else {
        //   // If it doesn't exceed the limit or the current batch is empty, add to the current batch
        //   currentInstructions.push(...nftInstructions);
        // }
      } catch (error) {
        console.error('[collectAllPositionFeesInstructions] Collect position fees failed:', {
          nftMint: nftMint.toBase58(),
          error,
        });
      }
    }
    // Ensure the last batch of instructions is also added
    // if (currentInstructions.length > 0) {
    //   allInstructions.push(currentInstructions);
    // }
    // Create a transaction for each batch of instructions
    const transactions: VersionedTransaction[] = [];
    for (const instructions of allInstructions) {
      try {
        const transaction = await makeTransaction({
          connection: this.connection,
          payerPublicKey: userAddress,
          instructions,
        });
        transactions.push(transaction);
      } catch (error) {
        console.error('[collectAllPositionFeesInstructions] Create transaction failed:', error);
      }
    }
    return { instructionsList: allInstructions, transactions };
  }

  /**
   * Collect fees for a single position and send a transaction
   * @param params Contains signature callback, etc.
   * @returns Promise<string> Transaction signature
   */
  public async collectFees(params: ParamsWithSignerCallback<ICollectFeesParams>): Promise<string> {
    try {
      const { signerCallback } = params;
      const { transaction } = await this.collectFeesInstructions(params);
      return await sendTransaction({
        connection: this.connection,
        signTx: async () => await signerCallback(transaction),
      });
    } catch (error) {
      console.warn('collectFees failed:', error);
      throw error;
    }
  }

  /**
   * Add liquidity to an existing position, generate chain instructions
   * @param params Contains user, position, liquidity amount, etc.
   * @returns IInstructionReturn
   */
  public async addLiquidityInstructions(params: IAddLiquidityParams): Promise<IInstructionReturn> {
    const {
      userAddress,
      nftMint,
      base,
      baseAmount,
      otherAmountMax,
      computeBudgetOptions = {},
    } = params;
    // Get position raw information
    const ownerPosition = await this.getRawPositionInfoByNftMint(nftMint);
    if (!ownerPosition) throw new Error('Position not found');
    // Get pool information
    const poolInfo = await this.getRawPoolInfoByPoolId(ownerPosition.poolId);
    // Calculate the required amount
    const amountA = base === 'MintA' ? baseAmount : otherAmountMax;
    const amountB = base === 'MintB' ? baseAmount : otherAmountMax;
    // Handle SOL/WSOL packaging
    const { tokenAccountA, tokenAccountB, preInstructions, endInstructions } =
      await this.handleTokenAccount({
        userAddress,
        mintA: poolInfo.mintA,
        mintB: poolInfo.mintB,
        amountA,
        amountB,
      });
    // Generate add liquidity instructions
    const { instructions: increaseInstructions } =
      await Instruction.increasePositionFromBaseInstructions({
        poolInfo,
        ownerPosition,
        ownerInfo: {
          wallet: userAddress,
          tokenAccountA,
          tokenAccountB,
        },
        base,
        baseAmount,
        otherAmountMax,
      });
    // Merge all instructions
    const instructions = [...preInstructions, ...increaseInstructions, ...endInstructions];
    // Construct transaction object
    const transaction = await makeTransaction({
      connection: this.connection,
      payerPublicKey: userAddress,
      instructions,
      options: {
        ...computeBudgetOptions,
      },
    });
    return {
      instructions,
      transaction,
    };
  }

  /**
   * Add liquidity to an existing position and send a transaction
   * @param params Contains signature callback, etc.
   * @returns Promise<string> Transaction signature
   */
  public async addLiquidity(
    params: ParamsWithSignerCallback<IAddLiquidityParams>
  ): Promise<string> {
    const { signerCallback } = params;
    const { transaction } = await this.addLiquidityInstructions(params);
    return sendTransaction({
      connection: this.connection,
      signTx: () => signerCallback(transaction),
    });
  }

  /**
   * Create pool instructions
   * @param params Create pool parameters
   * @returns IInstructionReturn
   */
  public async createPoolInstructions(params: ICreatePoolParams): Promise<IInstructionReturn> {
    const { userAddress, poolManager, openTime, mintA, mintB, ammConfigId, initialPrice } = params;
    // Convert price to BN format
    const initialPriceDecimal = new Decimal(initialPrice);
    const initialPriceX64 = SqrtPriceMath.priceToSqrtPriceX64(
      initialPriceDecimal,
      mintA.decimals,
      mintB.decimals
    );
    const mintAAddress = new PublicKey(mintA.address);
    const mintBAddress = new PublicKey(mintB.address);
    // Handle Token-2022 extension account
    const extendMintAccount: PublicKey[] = [];
    const fetchAccounts: PublicKey[] = [];
    if (mintA.programId === TOKEN_2022_PROGRAM_ID.toBase58()) {
      fetchAccounts.push(getPdaMintExAccount(this.programId, mintAAddress).publicKey);
    }
    if (mintB.programId === TOKEN_2022_PROGRAM_ID.toBase58()) {
      fetchAccounts.push(getPdaMintExAccount(this.programId, mintBAddress).publicKey);
    }

    // Verify account existence
    if (fetchAccounts.length > 0) {
      const extMintRes = await this.connection.getMultipleAccountsInfo(fetchAccounts);
      extMintRes.forEach((r, idx) => {
        if (r) extendMintAccount.push(fetchAccounts[idx]);
      });
    }

    // Generate pool creation instructions
    const { instructions } = await Instruction.createPoolInstruction({
      programId: this.programId,
      owner: userAddress,
      poolManager,
      mintA,
      mintB,
      ammConfigId,
      initialPriceX64,
      openTime,
      extendMintAccount,
    });
    // Construct transaction object
    const transaction = await makeTransaction({
      connection: this.connection,
      payerPublicKey: userAddress,
      instructions,
    });
    return {
      instructions,
      transaction,
    };
  }

  /**
   * Create a new pool and send a transaction
   * @param params Contains signature callback, etc.
   * @returns Promise<string> Transaction signature
   */
  public async createPool(params: ParamsWithSignerCallback<ICreatePoolParams>): Promise<string> {
    const { signerCallback } = params;
    const { transaction } = await this.createPoolInstructions(params);
    return sendTransaction({
      connection: this.connection,
      signTx: () => signerCallback(transaction),
    });
  }

  public async qouteSwap(params: IQouteSwapParams): Promise<IQouteSwapReturn> {
    // Slippage is set to 2% by default
    const {
      poolInfo,
      inputTokenMint,
      amountIn,
      priceLimit = new Decimal(0),
      slippage = 0.02,
      catchLiquidityInsufficient,
    } = params;

    let sqrtPriceLimitX64: BN;
    const isInputMintA = inputTokenMint.toBase58() === poolInfo.mintA.toBase58();

    if (priceLimit.equals(new Decimal(0))) {
      sqrtPriceLimitX64 = isInputMintA
        ? MIN_SQRT_PRICE_X64.add(new BN(1))
        : MAX_SQRT_PRICE_X64.sub(new BN(1));
    } else {
      sqrtPriceLimitX64 = SqrtPriceMath.priceToSqrtPriceX64(
        priceLimit,
        poolInfo.mintDecimalsA,
        poolInfo.mintDecimalsB
      );
    }

    const exBitmapInfo = await getTickArrayBitmapExtension(
      this.programId,
      poolInfo.poolId,
      this.connection
    );

    const ammConfig = await RawDataUtils.getRawAmmConfigByConfigId({
      connection: this.connection,
      configId: poolInfo.ammConfig,
    });

    const tickArrayInfo = await getTickArrayInfo({
      connection: this.connection,
      poolInfo,
      exBitmapInfo,
    });

    if (!exBitmapInfo || !ammConfig)
      throw new Error('Failed to get tick array bitmap extension or amm config');

    const { allTrade, expectedAmountOut, remainingAccounts, executionPrice, feeAmount } =
      await PoolUtils.getOutputAmountAndRemainAccounts({
        poolInfo,
        exBitmapInfo,
        ammConfig,
        tickArrayInfo,
        inputTokenMint,
        inputAmount: amountIn,
        sqrtPriceLimitX64,
        catchLiquidityInsufficient,
      });

    const minAmountOut = expectedAmountOut
      .mul(new BN(Math.floor((1 - slippage) * 10000000000)))
      .div(new BN(10000000000));

    return {
      allTrade,
      isInputMintA,
      amountIn,
      expectedAmountOut,
      minAmountOut,
      remainingAccounts,
      executionPrice,
      feeAmount,
    };
  }

  public async swapInstructions(params: ISwapParams): Promise<IInstructionReturn> {
    const { poolInfo, quoteReturn, userAddress } = params;

    // Determine amounts based on which token is input
    const amountA = quoteReturn.isInputMintA ? quoteReturn.amountIn : new BN(0);
    const amountB = !quoteReturn.isInputMintA ? quoteReturn.amountIn : new BN(0);

    const { tokenAccountA, tokenAccountB, preInstructions, endInstructions } =
      await this.handleTokenAccount({
        userAddress,
        mintA: poolInfo.mintA,
        mintB: poolInfo.mintB,
        amountA,
        amountB,
      });

    const exBitmapAddress = getPdaExBitmapAccount(poolInfo.programId, poolInfo.poolId).publicKey;

    // quoteReturn.isBaseIn
    const { instructions: swapInstruction } = await Instruction.swapBaseInInstruction({
      poolInfo,
      ownerInfo: {
        wallet: userAddress,
        tokenAccountA,
        tokenAccountB,
      },
      amount: quoteReturn.amountIn,
      // The minimum output amount after slippage calculation is passed here
      otherAmountThreshold: quoteReturn.minAmountOut,
      sqrtPriceLimitX64: quoteReturn.executionPrice,
      isInputMintA: quoteReturn.isInputMintA,
      tickArray: quoteReturn.remainingAccounts,
      exTickArrayBitmap: exBitmapAddress,
    });

    const instructions = [...preInstructions, ...swapInstruction, ...endInstructions];

    const transaction = await makeTransaction({
      connection: this.connection,
      payerPublicKey: userAddress,
      instructions,
    });

    return {
      transaction,
      instructions,
    };
  }

  /**
   * Create swap exact out instructions
   * @param params Contains pool info, quote return, and user address
   * @returns IInstructionReturn
   */
  public async swapExactOutInstructions(params: {
    poolInfo: IPoolLayoutWithId;
    quoteReturn: IQuoteSwapExactOutReturn;
    userAddress: PublicKey;
  }): Promise<IInstructionReturn> {
    const { poolInfo, quoteReturn, userAddress } = params;

    // For exact output, we need to determine input amounts
    // If outputting tokenA, we input tokenB
    // If outputting tokenB, we input tokenA
    const isInputMintA = !quoteReturn.isOutputMintA;
    const amountA = isInputMintA ? quoteReturn.maxAmountIn : new BN(0);
    const amountB = !isInputMintA ? quoteReturn.maxAmountIn : new BN(0);

    const { tokenAccountA, tokenAccountB, preInstructions, endInstructions } =
      await this.handleTokenAccount({
        userAddress,
        mintA: poolInfo.mintA,
        mintB: poolInfo.mintB,
        amountA,
        amountB,
      });

    const exBitmapAddress = getPdaExBitmapAccount(poolInfo.programId, poolInfo.poolId).publicKey;

    // For exact output, we need to use swapBaseOutInstruction
    const { instructions: swapInstruction } = await Instruction.swapBaseOutInstruction({
      poolInfo,
      ownerInfo: {
        wallet: userAddress,
        tokenAccountA,
        tokenAccountB,
      },
      amount: quoteReturn.amountOut,
      // The maximum input amount (including slippage) is passed here
      otherAmountThreshold: quoteReturn.maxAmountIn,
      sqrtPriceLimitX64: quoteReturn.executionPrice,
      isOutputMintA: quoteReturn.isOutputMintA,
      tickArray: quoteReturn.remainingAccounts,
      exTickArrayBitmap: exBitmapAddress,
    });

    const instructions = [...preInstructions, ...swapInstruction, ...endInstructions];

    const transaction = await makeTransaction({
      connection: this.connection,
      payerPublicKey: userAddress,
      instructions,
    });

    return {
      transaction,
      instructions,
    };
  }

  public async swap(params: ParamsWithSignerCallback<ISwapParams>): Promise<string> {
    const { signerCallback } = params;
    const { transaction } = await this.swapInstructions(params);
    return sendTransaction({
      connection: this.connection,
      signTx: () => signerCallback(transaction),
    });
  }

  /**
   * Execute swap exact out transaction
   * @param params Contains signature callback, etc.
   * @returns Promise<string> Transaction signature
   */
  public async swapExactOut(
    params: ParamsWithSignerCallback<ISwapExactOutParams>
  ): Promise<string> {
    const { signerCallback } = params;
    const { transaction } = await this.swapExactOutInstructions(params);
    return sendTransaction({
      connection: this.connection,
      signTx: () => signerCallback(transaction),
    });
  }

  /**
   * Quote swap exact output - calculate required input amount for desired output
   * @param params Quote parameters including output amount and slippage
   * @returns Quote result with expected input amount and other swap details
   */
  public async quoteSwapExactOut(
    params: IQuoteSwapExactOutParams
  ): Promise<IQuoteSwapExactOutReturn> {
    const {
      poolInfo,
      outputTokenMint,
      amountOut,
      priceLimit = new Decimal(0),
      slippage = 0.02,
      catchLiquidityInsufficient,
    } = params;

    let sqrtPriceLimitX64: BN;
    const isOutputMintA = outputTokenMint.toBase58() === poolInfo.mintA.toBase58();

    // For exact output, we need to determine if we're inputting token A or B
    // If outputting A, we input B (zeroForOne = false)
    // If outputting B, we input A (zeroForOne = true)
    const zeroForOne = !isOutputMintA;

    if (priceLimit.equals(new Decimal(0))) {
      sqrtPriceLimitX64 = zeroForOne
        ? MIN_SQRT_PRICE_X64.add(new BN(1))
        : MAX_SQRT_PRICE_X64.sub(new BN(1));
    } else {
      sqrtPriceLimitX64 = SqrtPriceMath.priceToSqrtPriceX64(
        priceLimit,
        poolInfo.mintDecimalsA,
        poolInfo.mintDecimalsB
      );
    }

    const exBitmapInfo = await getTickArrayBitmapExtension(
      this.programId,
      poolInfo.poolId,
      this.connection
    );

    const ammConfig = await RawDataUtils.getRawAmmConfigByConfigId({
      connection: this.connection,
      configId: poolInfo.ammConfig,
    });

    const tickArrayInfo = await getTickArrayInfo({
      connection: this.connection,
      poolInfo,
      exBitmapInfo,
    });

    if (!exBitmapInfo || !ammConfig)
      throw new Error('Failed to get tick array bitmap extension or amm config');

    const { allTrade, expectedAmountIn, remainingAccounts, executionPrice, feeAmount } =
      await PoolUtils.getInputAmountAndRemainAccounts({
        poolInfo,
        exBitmapInfo,
        ammConfig,
        tickArrayInfo,
        outputTokenMint,
        outputAmount: amountOut,
        sqrtPriceLimitX64,
        catchLiquidityInsufficient,
      });

    // For exact output, we calculate max input amount with slippage
    // This is the maximum amount user is willing to pay
    const maxAmountIn = expectedAmountIn
      .mul(new BN(Math.ceil((1 + slippage) * 10000000000)))
      .div(new BN(10000000000));

    return {
      allTrade,
      isOutputMintA,
      amountOut,
      expectedAmountIn,
      maxAmountIn,
      remainingAccounts,
      executionPrice,
      feeAmount,
    };
  }

  /**
   * Handle SOL/WSOL packaging logic, automatically generate related instructions
   *
   * @param params.userAddress User wallet address
   * @param params.mintA Pool tokenA mint
   * @param params.mintB Pool tokenB mint
   * @param params.amountA Optional, tokenA quantity
   * @param params.amountB Optional, tokenB quantity
   * @param params.rentExemptLamports Optional, WSOL account rent exemption lamports
   * @returns tokenAccountA/B, pre-instructions, post-instructions
   */
  public async handleTokenAccount(params: {
    userAddress: PublicKey;
    mintA: PublicKey;
    mintB: PublicKey;
    amountA?: BN;
    amountB?: BN;
    rentExemptLamports?: number;
  }): Promise<{
    tokenAccountA: PublicKey;
    tokenAccountB: PublicKey;
    tokenProgramIdA: PublicKey;
    tokenProgramIdB: PublicKey;
    preInstructions: TransactionInstruction[];
    endInstructions: TransactionInstruction[];
  }> {
    const { userAddress, mintA, mintB, amountA, amountB } = params;
    // Check if there is SOL involved
    const isTokenASOL = mintA.toString() === NATIVE_MINT.toString();
    const isTokenBSOL = mintB.toString() === NATIVE_MINT.toString();
    // Default to use ATA account
    const tokenProgramIdA = await getTokenProgramId(this.connection, mintA);
    const tokenProgramIdB = await getTokenProgramId(this.connection, mintB);
    let tokenAccountA = getATAAddress(userAddress, mintA, tokenProgramIdA).publicKey;
    let tokenAccountB = getATAAddress(userAddress, mintB, tokenProgramIdB).publicKey;
    const preInstructions: TransactionInstruction[] = [];
    const endInstructions: TransactionInstruction[] = [];

    if (!isTokenASOL) {
      const accA = await this.connection.getAccountInfo(tokenAccountA);
      if (!accA) {
        preInstructions.push(
          createAssociatedTokenAccountIdempotentInstruction(
            userAddress,
            tokenAccountA,
            userAddress,
            mintA,
            tokenProgramIdA
          )
        );
      }
    }

    if (!isTokenBSOL) {
      const accB = await this.connection.getAccountInfo(tokenAccountB);
      if (!accB) {
        preInstructions.push(
          createAssociatedTokenAccountIdempotentInstruction(
            userAddress,
            tokenAccountB,
            userAddress,
            mintB,
            tokenProgramIdB
          )
        );
      }
    }

    if (!isTokenASOL && !isTokenBSOL) {
      return {
        tokenAccountA,
        tokenAccountB,
        preInstructions,
        endInstructions,
        tokenProgramIdA,
        tokenProgramIdB,
      };
    }
    // Handle SOL -> WSOL packaging
    if (isTokenASOL || isTokenBSOL) {
      const newAccount = generatePubKey({
        fromPublicKey: userAddress,
        programId: TOKEN_PROGRAM_ID,
      });
      const wsolAccount = newAccount.publicKey;
      const rentExemptLamports =
        params.rentExemptLamports || (await this.estimateRentFee(AccountLayout.span));
      // Calculate how much SOL is needed
      let amountNeeded = 0;
      if (isTokenASOL && amountA) {
        amountNeeded = amountA.toNumber();
      } else if (isTokenBSOL && amountB) {
        amountNeeded = amountB.toNumber();
      }

      // Create WSOL account
      preInstructions.push(
        SystemProgram.createAccountWithSeed({
          fromPubkey: userAddress,
          basePubkey: userAddress,
          seed: newAccount.seed,
          newAccountPubkey: wsolAccount,
          space: AccountLayout.span,
          lamports: rentExemptLamports + amountNeeded,
          programId: TOKEN_PROGRAM_ID,
        })
      );
      // Initialize WSOL account
      preInstructions.push(
        createInitializeAccountInstruction(wsolAccount, NATIVE_MINT, userAddress)
      );
      // Add instructions to close WSOL account
      endInstructions.push(
        createCloseAccountInstruction(wsolAccount, userAddress, userAddress, [])
      );
      // Update the corresponding token account
      if (isTokenASOL) {
        tokenAccountA = wsolAccount;
      }
      if (isTokenBSOL) {
        tokenAccountB = wsolAccount;
      }
    }
    return {
      tokenAccountA,
      tokenAccountB,
      preInstructions,
      endInstructions,
      tokenProgramIdA,
      tokenProgramIdB,
    };
  }

  private async estimateRentFee(space: number, useCache = true): Promise<number> {
    if (useCache && this.rentFeeCache[space] !== undefined) {
      return this.rentFeeCache[space];
    }
    const lamports = await this.connection.getMinimumBalanceForRentExemption(space);
    this.rentFeeCache[space] = lamports;
    return lamports;
  }

  public calculateApr = calculateApr;
  public calculateRewardApr = calculateRewardApr;
  public calculateRangeAprs = calculateRangeAprs;
  public alignPriceToTickPrice = alignPriceToTickPrice;
  public getAmountBFromAmountA = getAmountBFromAmountA;
  public getAmountAFromAmountB = getAmountAFromAmountB;
}

function createMemoInstruction(memo: string, signers: PublicKey[]): TransactionInstruction {
  return new TransactionInstruction({
    programId: MEMO_PROGRAM_ID,
    keys: signers.map((pubkey) => ({
      pubkey,
      isSigner: true,
      isWritable: false,
    })),
    data: Buffer.from(memo, 'utf-8'),
  });
}
