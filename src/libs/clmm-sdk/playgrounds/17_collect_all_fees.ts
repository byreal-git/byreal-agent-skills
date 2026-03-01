/**
 * Collect fees from all positions of the specified user
 */

import { PublicKey } from '@solana/web3.js';

import { makeTransaction, sendTransaction } from '../index.js';

import { connection, chain, userAddress, signerCallback } from './config.js';

async function main(): Promise<void> {
  // Get the list of positions under the specified account
  // const positionList = await chain.getRawPositionInfoListByUserAddress(userAddress);

  // const nftMintList = positionList.map((position) => position.nftMint);

  const nftMintList = [
    new PublicKey('C4y5bhKwD7ai9iJ5h5XP1ct4GQPusS4MsV4mYaSKuxAu'),
    new PublicKey('FSNhhUH1qxDk5ZHbGCcsRJzqaFGqvjE46DP2Z8RsM1is'),
    new PublicKey('2N92457ubvpj1Q1mVpbSuw5QDmDb6dpzNUa6PwVuCvSm'),
    new PublicKey('3piGZRqykLKmKob42id8E61NnHqyrhWE2kziWmHZ7zqV'),
    new PublicKey('Frpbn2b7sA6Vy1Zbz35kbgVNRkXu3tSexqJJXJRwPV6w'),
  ];

  console.log(
    'nftMintList ==>',
    nftMintList.map((nftMint) => nftMint.toBase58())
  );

  const { instructionsList } = await chain.collectAllPositionFeesInstructions({
    userAddress,
    nftMintList,
  });

  for (const instructions of instructionsList) {
    console.log('Start sending transaction ==>');
    const transaction = await makeTransaction({
      connection,
      payerPublicKey: userAddress,
      instructions,
    });
    const txid = await sendTransaction({
      connection,
      signTx: () => signerCallback(transaction),
    });
    console.log('Collect fees successfully, txid:', txid);
  }
}

main();
