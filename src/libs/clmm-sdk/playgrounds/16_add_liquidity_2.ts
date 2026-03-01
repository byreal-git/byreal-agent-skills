/**
 * Add liquidity to an existing position (user inputs the amount of TokenA, and calculates the amount of TokenB needed)
 */

import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
import { Decimal } from 'decimal.js';

import { SignerCallback } from '../client/models.js';

import { chain, userKeypair, userAddress } from './config.js';

async function main(): Promise<void> {
  // step 1: Select the position to add liquidity
  // Change to your own NFT mint address
  const nftMint = new PublicKey('CjouQkvVP5XkABWYQYzCAJMpB3g8yJhADtRcRtEZTj8M');

  const positionInfo = await chain.getPositionInfoByNftMint(nftMint);
  if (!positionInfo) {
    console.error('Position does not exist');
    return;
  }

  console.log('========= step 1: Select the position =========');
  console.log('Position NFT address:', nftMint.toBase58());
  console.log(`Price range: ${positionInfo.uiPriceLower} - ${positionInfo.uiPriceUpper}`);
  console.log(`Current TokenA: ${positionInfo.tokenA.uiAmount}`);
  console.log(`Current TokenB: ${positionInfo.tokenB.uiAmount}`);

  // step 2: User inputs the amount of TokenA and the token type (TokenA as an example)
  const base = 'MintA';
  const baseAmount = new BN(1000000);

  // Get the pool information for calculation
  const poolInfo = await chain.getRawPoolInfoByPoolId(positionInfo.rawPositionInfo.poolId);

  // Calculate the amount of TokenB needed
  const amountB = chain.getAmountBFromAmountA({
    priceLower: new Decimal(positionInfo.uiPriceLower),
    priceUpper: new Decimal(positionInfo.uiPriceUpper),
    amountA: baseAmount,
    poolInfo,
  });

  // Add a 2% slippage
  const amountBWithSlippage = new BN(amountB).mul(new BN(10000 * (1 + 0.02))).div(new BN(10000));

  console.log('========= step 2: User inputs the amount of TokenA and the token type =========');
  console.log(
    'Amount of TokenA to be added =>',
    Number(baseAmount.toString()) / 10 ** positionInfo.tokenB.decimals
  );
  console.log(
    'Estimated amount of TokenB needed =>',
    Number(amountB.toString()) / 10 ** positionInfo.tokenA.decimals
  );

  // Signer callback
  const signerCallback: SignerCallback = async (tx) => {
    tx.sign([userKeypair]);
    return tx;
  };

  console.log(
    '======= step 3: After confirming that there is no error, start adding liquidity ======='
  );
  try {
    const txid = await chain.addLiquidity({
      userAddress,
      nftMint,
      base,
      baseAmount,
      otherAmountMax: amountBWithSlippage,
      signerCallback,
    });

    console.log('Add liquidity successfully, txid:', txid);
  } catch (error) {
    console.error('Add liquidity failed:', error);
  }
}

main();
