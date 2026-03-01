/**
 * Decrease liquidity proportionally, and display the estimated tokenA and tokenB amounts
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

  const decreasePercentage = 50; // decrease 50% of the liquidity

  const liquidityToDecrease = liquidity.mul(new BN(decreasePercentage)).div(new BN(100));

  console.log('Current liquidity amount:', liquidity.toString());
  console.log('Liquidity to decrease:', liquidityToDecrease.toString());

  const sqrtPriceLowerX64 = SqrtPriceMath.getSqrtPriceX64FromTick(tickLower);
  const sqrtPriceUpperX64 = SqrtPriceMath.getSqrtPriceX64FromTick(tickUpper);

  const poolInfo = await chain.getRawPoolInfoByPoolId(positionInfo.poolId);

  const amounts = LiquidityMath.getAmountsFromLiquidity(
    poolInfo.sqrtPriceX64,
    sqrtPriceLowerX64,
    sqrtPriceUpperX64,
    liquidityToDecrease,
    true
  );

  console.log(
    'Estimated tokenA amount:',
    new Decimal(amounts.amountA.toString())
      .div(new Decimal(10 ** poolInfo.mintDecimalsA))
      .toFixed(poolInfo.mintDecimalsA)
  );
  console.log(
    'Estimated tokenB amount:',
    new Decimal(amounts.amountB.toString())
      .div(new Decimal(10 ** poolInfo.mintDecimalsB))
      .toFixed(poolInfo.mintDecimalsB)
  );

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
