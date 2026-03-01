/**
 * Create a position
 */

import BN from 'bn.js';
import { Decimal } from 'decimal.js';

import { SignerCallback } from '../client/models.js';
import { TickMath } from '../index.js';

import { userKeypair, userAddress, chain, PoolAddress } from './config.js';

async function main(): Promise<void> {
  // step 1: User selects the pool
  const poolInfo = await chain.getRawPoolInfoByPoolId(PoolAddress.USDC_USDT);

  console.log('========= step 1: Select the pool =========');
  console.log('Selected pool address:', poolInfo.poolId.toBase58());

  // step 2: User inputs the price range
  const userStartPrice = '0.998';
  const userEndPrice = '1.002';

  // Calculate the accurate tick price, and show it to the user
  const priceInTickLower = TickMath.getTickAlignedPriceDetails(
    new Decimal(userStartPrice),
    poolInfo.tickSpacing,
    poolInfo.mintDecimalsA,
    poolInfo.mintDecimalsB
  );
  const priceInTickUpper = TickMath.getTickAlignedPriceDetails(
    new Decimal(userEndPrice),
    poolInfo.tickSpacing,
    poolInfo.mintDecimalsA,
    poolInfo.mintDecimalsB
  );

  console.log('========= step 2: User inputs the price range =========');
  console.log(`User input price range: ${userStartPrice} - ${userEndPrice}`);
  console.log(
    `Accurate price range: ${priceInTickLower.price.toNumber()} - ${priceInTickUpper.price.toNumber()}`
  );
  console.log(`Accurate price tick range: ${priceInTickLower.tick} - ${priceInTickUpper.tick}`);

  // step 3: User inputs the amount of TokenB and the token type
  const base = 'MintA';
  const baseAmount = new BN(2 * 10 ** poolInfo.mintDecimalsA);

  // Calculate the amount of TokenA needed
  const amountB = chain.getAmountBFromAmountA({
    priceLower: priceInTickLower.price,
    priceUpper: priceInTickUpper.price,
    amountA: baseAmount,
    poolInfo,
  });

  // Add a 2% slippage
  const amountBWithSlippage = new BN(amountB).mul(new BN(10000 * (1 + 0.02))).div(new BN(10000));

  console.log('========= step 3: User inputs the amount of TokenB and the token type =========');
  console.log(
    'Amount of TokenA to be invested =>',
    Number(baseAmount.toString()) / 10 ** poolInfo.mintDecimalsA
  );
  console.log(
    'Estimated amount of TokenB needed =>',
    Number(amountB.toString()) / 10 ** poolInfo.mintDecimalsB
  );

  // Signer callback, later this can be implemented with a wallet plugin
  const signerCallback: SignerCallback = async (tx) => {
    tx.sign([userKeypair]);
    return tx;
  };

  console.log(
    '======= step 4: After confirming that there is no error, start creating a position ======='
  );
  const txid = await chain.createPosition({
    userAddress: userAddress,
    poolInfo,
    tickLower: priceInTickLower.tick,
    tickUpper: priceInTickUpper.tick,
    base,
    baseAmount,
    otherAmountMax: amountBWithSlippage,
    signerCallback,
  });

  console.log('Create position successfully, txid:', txid);
}

main();
