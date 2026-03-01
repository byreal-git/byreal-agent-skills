/**
 * Collect fees from the specified position
 */

import { PublicKey } from '@solana/web3.js';

import { chain, signerCallback, userAddress } from './config.js';

async function main(): Promise<void> {
  // Change to your own NFT mint address
  const nftMint = new PublicKey('CVqLrFi5n3HLzRJdGHdChtoXhycNeveShYkmGfeaXGHC');
  const txid = await chain.collectFees({
    userAddress,
    nftMint,
    signerCallback,
  });

  console.log('Collect fees successfully, txid:', txid);
}

main();
