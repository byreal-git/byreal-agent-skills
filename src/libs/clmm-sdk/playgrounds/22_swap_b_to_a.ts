import BN from 'bn.js';

import { chain, PoolAddress, signerCallback, userAddress } from './config.js';

async function main(): Promise<void> {
  console.log('userAddress ==>', userAddress.toBase58());

  const poolInfo = await chain.getRawPoolInfoByPoolId(PoolAddress.USDC_USDT);

  const amountIn = new BN(1 * 10 ** poolInfo.mintDecimalsB);

  console.log('amountIn ==>', amountIn.toString());

  // step 1: Get quote trading information
  const quoteReturn = await chain.qouteSwap({
    poolInfo,
    slippage: 0.01,
    inputTokenMint: poolInfo.mintB,
    amountIn,
  });

  console.log('quoteReturn', {
    allTrade: quoteReturn.allTrade,
    minAmountOut: quoteReturn.minAmountOut.toString(),
    expectedAmountOut: quoteReturn.expectedAmountOut.toString(),
    amountIn: quoteReturn.amountIn.toString(),
    isInputMintA: quoteReturn.isInputMintA,
    remainingAccounts: quoteReturn.remainingAccounts.map((account) => account.toBase58()),
    executionPrice: quoteReturn.executionPrice.toString(),
    feeAmount: quoteReturn.feeAmount.toString(),
  });

  // step 2: Execute transaction
  const txid = await chain.swap({
    poolInfo,
    quoteReturn,
    userAddress,
    signerCallback,
  });

  console.log('txid', txid);
}

main();
