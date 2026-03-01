/**
 * Remove all liquidity from the position, and close the position
 */

import { PublicKey } from '@solana/web3.js';

import { chain, signerCallback, userAddress } from './config.js';

async function main(): Promise<void> {
  const nftMint = new PublicKey('3eunC8kdMEwBRQHd91cyQ36FVQFXDuicGk7xuVS6hFfk');

  const txid = await chain.decreaseFullLiquidity({
    userAddress,
    nftMint,
    signerCallback,
  });

  console.log('Decrease liquidity successfully, txid:', txid);
}

main();
