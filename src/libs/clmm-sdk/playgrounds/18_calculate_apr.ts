/**
 * Calculate the annualized return when adding liquidity
 */

import BN from 'bn.js';
import { Decimal } from 'decimal.js';

import { TickMath } from '../index.js';

import { chain, PoolAddress } from './config.js';

async function main(): Promise<void> {
  const poolInfo = await chain.getRawPoolInfoByPoolId(PoolAddress.SOL_USDC);

  // mock data
  const volume24h = 91114900; // data from server
  const feeRate = 0.0002; // fee rate from server
  const solUsdValue = 166.82; // current sol price in USD, from server

  // User input price range
  const userStartPrice = '150';
  const userEndPrice = '190';
  const uiAmountA = '100';

  const amountA = new BN(
    new Decimal(uiAmountA).mul(new Decimal(10 ** poolInfo.mintDecimalsA)).toFixed(0)
  );

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

  // Calculate the amount of tokenB needed
  const amountB = chain.getAmountBFromAmountA({
    priceLower: priceInTickLower.price,
    priceUpper: priceInTickUpper.price,
    amountA,
    poolInfo,
  });

  const uiAmountB = new Decimal(amountB.toString())
    .div(new Decimal(10 ** poolInfo.mintDecimalsB))
    .toString();

  // console.log('amountA ==> ', amountA.toString());
  // console.log('amountB ==> ', amountB.toString());
  // console.log('uiAmountA ==> ', uiAmountA);
  // console.log('uiAmountB ==> ', uiAmountB);

  const positionUsdValue = Number(uiAmountA) * solUsdValue + Number(uiAmountB);

  const apr = await chain.calculateApr({
    volume24h,
    feeRate,
    positionUsdValue,
    amountA,
    amountB,
    tickLower: priceInTickLower.tick,
    tickUpper: priceInTickUpper.tick,
    poolInfo,
    scene: 'create',
  });

  console.log('Annualized return:', apr);
}

main();
