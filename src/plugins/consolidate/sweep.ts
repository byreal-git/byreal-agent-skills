/**
 * Token consolidation logic — scan dust tokens, generate swap transactions
 */

import type { Result } from '../../core/types.js';
import { ok, err } from '../../core/types.js';
import type { ByrealError } from '../../core/errors.js';
import { networkError } from '../../core/errors.js';
import * as jupiterApi from '../jupiter/api.js';
import { getConnection } from '../../core/solana.js';
import { PublicKey } from '@solana/web3.js';
import { AccountLayout, MintLayout, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { rawToUi } from '../../core/amounts.js';

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SOL_MINT = 'So11111111111111111111111111111111111111112';

export interface DustToken {
  mint: string;
  amountRaw: string;
  amountUi: string;
  decimals: number;
  priceUsd: number;
  valueUsd: number;
  action: 'swap' | 'skip';
  skipReason?: string;
}

export interface SweepPlan {
  dustTokens: DustToken[];
  totalEstimatedUsd: number;
  swapCount: number;
  skipCount: number;
}

export interface SweepFailure {
  mint: string;
  reason: string;
}

export interface SweepResult {
  swapTransactions: string[];
  failures: SweepFailure[];
}

/**
 * Scan wallet and build a sweep plan
 */
export async function buildSweepPlan(params: {
  walletAddress: string;
  targetMint?: string;
  maxValueUsd?: number;
  excludeMints?: string[];
}): Promise<Result<SweepPlan, ByrealError>> {
  const targetMint = params.targetMint ?? USDC_MINT;
  const maxValue = params.maxValueUsd ?? 0.5;
  const excludes = new Set([
    targetMint,
    USDC_MINT,
    SOL_MINT,
    ...(params.excludeMints ?? []),
  ]);

  try {
    const connection = getConnection();
    const owner = new PublicKey(params.walletAddress);

    // Get all token accounts
    const [splAccounts, token2022Accounts] = await Promise.all([
      connection.getTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }, 'confirmed'),
      connection.getTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID }, 'confirmed'),
    ]);

    // Collect non-zero balances
    let tokenBalances: { mint: string; amountRaw: string; decimals: number }[] = [];

    for (const { account } of [...splAccounts.value, ...token2022Accounts.value]) {
      const data = AccountLayout.decode(account.data);
      if (data.amount > BigInt(0) && !excludes.has(data.mint.toString())) {
        tokenBalances.push({
          mint: data.mint.toString(),
          amountRaw: data.amount.toString(),
          decimals: 0, // will resolve from mint account below
        });
      }
    }

    if (tokenBalances.length === 0) {
      return ok({ dustTokens: [], totalEstimatedUsd: 0, swapCount: 0, skipCount: 0 });
    }

    // Batch-fetch mint accounts to get decimals and filter NFTs
    const mintPubkeys = tokenBalances.map(t => new PublicKey(t.mint));
    const nftMints = new Set<string>();

    // getMultipleAccountsInfo supports up to 100 per call
    for (let i = 0; i < mintPubkeys.length; i += 100) {
      const batch = mintPubkeys.slice(i, i + 100);
      const mintAccounts = await connection.getMultipleAccountsInfo(batch);
      for (let j = 0; j < mintAccounts.length; j++) {
        const account = mintAccounts[j];
        if (!account) continue;
        const mintData = MintLayout.decode(account.data);
        tokenBalances[i + j].decimals = mintData.decimals;
        // NFT: decimals = 0 and supply = 1
        if (mintData.decimals === 0 && mintData.supply === BigInt(1)) {
          nftMints.add(tokenBalances[i + j].mint);
        }
      }
    }

    // Filter out NFTs
    tokenBalances = tokenBalances.filter(t => !nftMints.has(t.mint));

    if (tokenBalances.length === 0) {
      return ok({ dustTokens: [], totalEstimatedUsd: 0, swapCount: 0, skipCount: 0 });
    }

    // Get prices from Jupiter
    const mints = tokenBalances.map(t => t.mint);
    const priceResult = await jupiterApi.getPrice(mints);
    if (!priceResult.ok) {
      return err(priceResult.error);
    }

    const prices = priceResult.value;
    const dustTokens: DustToken[] = [];
    let totalEstimatedUsd = 0;
    let swapCount = 0;
    let skipCount = 0;

    for (const token of tokenBalances) {
      const priceData = prices[token.mint];
      const priceUsd = priceData?.usdPrice ?? 0;
      const decimals = priceData?.decimals || token.decimals || 6;
      const amountUi = rawToUi(token.amountRaw, decimals);
      const valueUsd = parseFloat(amountUi) * priceUsd;

      const dust: DustToken = {
        mint: token.mint,
        amountRaw: token.amountRaw,
        amountUi,
        decimals,
        priceUsd,
        valueUsd,
        action: 'skip',
      };

      if (priceUsd === 0 || !Number.isFinite(priceUsd) || !Number.isFinite(valueUsd)) {
        dust.skipReason = 'No price data';
        skipCount++;
      } else if (valueUsd >= maxValue) {
        dust.skipReason = `Value $${valueUsd.toFixed(4)} above threshold $${maxValue}`;
        skipCount++;
      } else {
        dust.action = 'swap';
        totalEstimatedUsd += valueUsd;
        swapCount++;
      }

      dustTokens.push(dust);
    }

    // Sort by value descending
    dustTokens.sort((a, b) => b.valueUsd - a.valueUsd);

    return ok({ dustTokens, totalEstimatedUsd, swapCount, skipCount });
  } catch (error) {
    return err(networkError(`Sweep scan: ${(error as Error).message}`));
  }
}

/**
 * Generate swap transactions for dust tokens
 */
export async function executeSweep(params: {
  walletAddress: string;
  dustTokens: DustToken[];
  targetMint?: string;
}): Promise<Result<SweepResult, ByrealError>> {
  const targetMint = params.targetMint ?? USDC_MINT;
  const swappableTokens = params.dustTokens.filter(t => t.action === 'swap');

  const swapTransactions: string[] = [];
  const failures: SweepFailure[] = [];

  for (const token of swappableTokens) {
    const quoteResult = await jupiterApi.getQuote({
      inputMint: token.mint,
      outputMint: targetMint,
      amount: token.amountRaw,
    });

    if (!quoteResult.ok) {
      failures.push({ mint: token.mint, reason: `Quote failed: ${quoteResult.error.message}` });
      continue;
    }

    const swapResult = await jupiterApi.getSwapTransaction({
      quoteResponse: quoteResult.value,
      userPublicKey: params.walletAddress,
    });

    if (!swapResult.ok) {
      failures.push({ mint: token.mint, reason: `Swap tx failed: ${swapResult.error.message}` });
      continue;
    }

    swapTransactions.push(swapResult.value.swapTransaction);
  }

  return ok({ swapTransactions, failures });
}
