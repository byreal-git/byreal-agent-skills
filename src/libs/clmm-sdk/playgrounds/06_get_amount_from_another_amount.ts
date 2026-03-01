/**
 * Round the price to the price of the corresponding tick (used when creating a position)
 */

import BN from 'bn.js';
import { Decimal } from 'decimal.js';

import { chain, PoolAddress } from './config.js';

async function main(): Promise<void> {
  const poolInfo = await chain.getRawPoolInfoByPoolId(PoolAddress.SOL_USDC);

  const userInputPriceLower = 120;
  const userInputPriceUpper = 160;
  const userInputAmountA = new BN(1000000000); // 1 SOL

  // Calculate the amount of tokenB needed to be invested in the specified price range after the specified tokenA amount has been invested
  const amountB = chain.getAmountBFromAmountA({
    priceLower: new Decimal(userInputPriceLower),
    priceUpper: new Decimal(userInputPriceUpper),
    amountA: userInputAmountA,
    poolInfo,
  });

  // Tips: This is the amount of tokens that will be accurately invested in the vault pool;
  console.log(
    'Estimated amount of tokenB to be invested =>',
    Number(amountB.toString()) / 10 ** poolInfo.mintDecimalsB
  );
}

main();
