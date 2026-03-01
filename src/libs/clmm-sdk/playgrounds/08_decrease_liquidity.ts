/**
 * Decrease liquidity proportionally
 */

import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';

import { chain, signerCallback, userAddress } from './config.js';

async function main(): Promise<void> {
  // Change to your own NFT mint address
  const nftMint = new PublicKey('3eunC8kdMEwBRQHd91cyQ36FVQFXDuicGk7xuVS6hFfk');

  const positionInfo = await chain.getRawPositionInfoByNftMint(nftMint);

  if (!positionInfo) {
    throw new Error('Position not found');
  }

  const { liquidity } = positionInfo;

  const decreasePercentage = 50; // Decrease 50% of the liquidity

  const liquidityToDecrease = liquidity.mul(new BN(decreasePercentage)).div(new BN(100));

  console.log('Current liquidity amount:', liquidity.toString());
  console.log('Liquidity to decrease:', liquidityToDecrease.toString());

  const txid = await chain.decreaseLiquidity({
    userAddress,
    nftMint,
    // Decrease half of the liquidity
    liquidity: liquidityToDecrease,
    signerCallback,
  });

  console.log('Decrease liquidity successfully, txid:', txid);
}

main();
