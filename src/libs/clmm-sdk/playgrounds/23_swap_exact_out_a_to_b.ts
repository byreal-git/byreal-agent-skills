import BN from 'bn.js';

import { chain, PoolAddress, signerCallback, userAddress } from './config.js';

async function main(): Promise<void> {
  console.log('userAddress ==>', userAddress.toBase58());

  const poolInfo = await chain.getRawPoolInfoByPoolId(PoolAddress.USDC_USDT);

  // Specify the desired output amount: 1 USDT
  const amountOut = new BN(1 * 10 ** poolInfo.mintDecimalsB);

  console.log('amountOut ==>', amountOut.toString());

  // step 1: Get exact output quote information
  const quoteReturn = await chain.quoteSwapExactOut({
    poolInfo,
    slippage: 0.01, // 1% slippage
    outputTokenMint: poolInfo.mintB, // Output USDT (tokenB)
    amountOut,
  });

  console.log('quoteReturn', {
    allTrade: quoteReturn.allTrade,
    expectedAmountIn: quoteReturn.expectedAmountIn.toString(),
    maxAmountIn: quoteReturn.maxAmountIn.toString(),
    amountOut: quoteReturn.amountOut.toString(),
    isOutputMintA: quoteReturn.isOutputMintA,
    remainingAccounts: quoteReturn.remainingAccounts.map((account) => account.toBase58()),
    executionPrice: quoteReturn.executionPrice.toString(),
    feeAmount: quoteReturn.feeAmount.toString(),
  });

  // step 2: Execute exact output transaction
  const txid = await chain.swapExactOut({
    poolInfo,
    quoteReturn,
    userAddress,
    signerCallback,
  });

  console.log('txid', txid);
}

main();
