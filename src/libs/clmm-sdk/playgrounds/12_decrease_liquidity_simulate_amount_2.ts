/**
 * User manually inputs the amount of token to be decreased, and calculates the amount of token to be decreased on the other side
 */

import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
import { Decimal } from 'decimal.js';

import { LiquidityMath, SqrtPriceMath } from '../index.js';

import { chain } from './config.js';

async function main(): Promise<void> {
  // Change to your own NFT mint address
  const nftMint = new PublicKey('CjouQkvVP5XkABWYQYzCAJMpB3g8yJhADtRcRtEZTj8M');

  const positionInfo = await chain.getRawPositionInfoByNftMint(nftMint);

  if (!positionInfo) {
    throw new Error('Position not found');
  }

  const { liquidity, tickLower, tickUpper } = positionInfo;

  const sqrtPriceLowerX64 = SqrtPriceMath.getSqrtPriceX64FromTick(tickLower);
  const sqrtPriceUpperX64 = SqrtPriceMath.getSqrtPriceX64FromTick(tickUpper);

  const poolInfo = await chain.getRawPoolInfoByPoolId(positionInfo.poolId);

  const amounts = LiquidityMath.getAmountsFromLiquidity(
    poolInfo.sqrtPriceX64,
    sqrtPriceLowerX64,
    sqrtPriceUpperX64,
    liquidity,
    true
  );

  console.log('Amount of tokenA in the position:', new Decimal(amounts.amountA.toString()));
  console.log('Amount of tokenB in the position:', new Decimal(amounts.amountB.toString()));

  console.log('==== User manually inputs the amount of token to be decreased ====');

  // For example, decrease 70% of the liquidity
  const userInputAmountA = amounts.amountA.mul(new BN(70)).div(new BN(100));

  const userGetAmountB = LiquidityMath.getAmountBFromAmountA(
    sqrtPriceLowerX64,
    sqrtPriceUpperX64,
    poolInfo.sqrtPriceX64,
    userInputAmountA
  );

  console.log(
    `After inputting the amount of tokenA: ${new Decimal(
      userInputAmountA.toString()
    )} , the estimated amount of tokenB: ${new Decimal(userGetAmountB.toString())}`
  );

  const decreaseLiquidity = LiquidityMath.getLiquidityFromTokenAmounts(
    poolInfo.sqrtPriceX64,
    sqrtPriceLowerX64,
    sqrtPriceUpperX64,
    userInputAmountA,
    userGetAmountB
  );

  console.log(
    'Decrease ratio:',
    new Decimal(decreaseLiquidity.toString()).div(new Decimal(liquidity.toString())).toFixed(2)
  );

  // const liquidity = LiquidityMath.getLiquidityFromTokenAmounts(
  //   poolInfo.sqrtPriceX64,
  //   sqrtPriceLowerX64,
  //   sqrtPriceUpperX64,
  //   amountA,
  //   amountB,
  // );

  // const amounts = LiquidityMath.getAmountsFromLiquidity(
  //   poolInfo.sqrtPriceX64,
  //   sqrtPriceLowerX64,
  //   sqrtPriceUpperX64,
  //   liquidity,
  //   true,
  // );

  // console.log("Estimated liquidity amount:", new Decimal(liquidity.toString()));

  // const txid = chain.decreaseLiquidity({
  //   userAddress,
  //   nftMint,
  //   // Decrease half of the liquidity
  //   liquidity: liquidityToDecrease,
  //   signerCallback,
  // });

  // console.log(txid);
}

main();
