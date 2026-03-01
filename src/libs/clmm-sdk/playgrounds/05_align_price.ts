/**
 * Round the price to the price of the corresponding tick (used when creating a position)
 */

import { Decimal } from 'decimal.js';

import { chain, PoolAddress } from './config.js';

async function main(): Promise<void> {
  const poolInfo = await chain.getRawPoolInfoByPoolId(PoolAddress.SOL_USDC);

  const userInputPriceLower = 120;
  const userInputPriceUpper = 160;

  // When creating a position, round the price to the price of the corresponding tick
  const roundPriceLower = chain.alignPriceToTickPrice(new Decimal(userInputPriceLower), poolInfo);
  const roundPriceUpper = chain.alignPriceToTickPrice(new Decimal(userInputPriceUpper), poolInfo);

  console.log(`User input price: ${userInputPriceLower} - ${userInputPriceUpper}`);
  console.log(`Aligned to tick price: ${roundPriceLower} - ${roundPriceUpper}`);
}

main();
