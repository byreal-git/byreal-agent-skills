/**
 * Pools command implementation
 * 参数参考：PoolInfoListReq (poolInfoListReq.ts)
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { Decimal } from 'decimal.js';
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { api } from '../../api/endpoints.js';
import { DEFAULTS, SOLANA_RPC_URL } from '../../core/constants.js';
import { loadConfig } from '../../auth/config.js';
import {
  output,
  outputError,
  outputJson,
  outputErrorJson,
  outputErrorTable,
  outputPoolsTable,
  outputPoolDetail,
  outputKlineChart,
  outputPoolAnalysisTable,
} from '../output/formatters.js';
import type { OutputFormat, PoolListParams, PoolSortField, KlineInterval, PoolDetail } from '../../core/types.js';

// ============================================
// List Pools Command
// ============================================

interface ListPoolsOptions {
  sortField?: PoolSortField;
  sortType?: 'asc' | 'desc';
  page?: string;
  pageSize?: string;
  category?: string;
}

async function listPools(options: ListPoolsOptions, globalOptions: { output: OutputFormat }): Promise<void> {
  const startTime = Date.now();

  const params: PoolListParams = {
    sortField: options.sortField,
    sortType: options.sortType,
    page: options.page ? parseInt(options.page, 10) : 1,
    pageSize: options.pageSize ? parseInt(options.pageSize, 10) : DEFAULTS.LIST_LIMIT,
    category: options.category,
  };

  const result = await api.listPools(params);

  if (!result.ok) {
    outputError(result.error, globalOptions.output);
    process.exit(1);
  }

  const { pools, total, page, pageSize } = result.value;

  output(
    { pools, total, page, pageSize },
    globalOptions.output,
    (data) => outputPoolsTable(data.pools, data.total),
    startTime
  );
}

// ============================================
// Get Pool Info Command
// ============================================

async function getPoolInfo(poolId: string, globalOptions: { output: OutputFormat }): Promise<void> {
  const startTime = Date.now();

  const result = await api.getPoolInfo(poolId);

  if (!result.ok) {
    if (result.error.code === 'POOL_NOT_FOUND') {
      outputError(result.error, globalOptions.output);
    } else {
      outputError(result.error, globalOptions.output);
    }
    process.exit(1);
  }

  output(
    result.value,
    globalOptions.output,
    (pool) => outputPoolDetail(pool),
    startTime
  );
}

// ============================================
// Analyze Pool Command
// ============================================

const CATEGORY_LABELS: Record<number, string> = {
  1: 'stable',
  2: 'xStocks',
  4: 'launchpad',
  16: 'normal',
  128: 'normal',
};

function assessRisk(level: 'low' | 'medium' | 'high'): string {
  return level;
}

function assessTvlRisk(tvl: number): 'low' | 'medium' | 'high' {
  if (tvl > 1_000_000) return 'low';
  if (tvl >= 100_000) return 'medium';
  return 'high';
}

function assessVolatilityRisk(priceChange7d: number): 'low' | 'medium' | 'high' {
  const abs = Math.abs(priceChange7d);
  if (abs < 5) return 'low';
  if (abs <= 15) return 'medium';
  return 'high';
}

function assessInRangeLikelihood(rangeWidthPercent: number, dayRangePercent: number): 'low' | 'medium' | 'high' {
  if (dayRangePercent <= 0) return 'high';
  if (rangeWidthPercent > 3 * dayRangePercent) return 'high';
  if (rangeWidthPercent > 1.5 * dayRangePercent) return 'medium';
  return 'low';
}

function assessRebalanceFrequency(likelihood: 'low' | 'medium' | 'high'): 'low' | 'medium' | 'high' {
  // Inverse of in-range likelihood
  if (likelihood === 'high') return 'low';
  if (likelihood === 'medium') return 'medium';
  return 'high';
}

function buildRiskSummary(
  pool: PoolDetail,
  dayRangePercent: number,
): string[] {
  const summary: string[] = [];
  const tvl = pool.tvl_usd;
  if (tvl >= 1_000_000) {
    summary.push(`Pool has healthy TVL ($${(tvl / 1_000_000).toFixed(1)}M)`);
  } else if (tvl >= 100_000) {
    summary.push(`Pool has moderate TVL ($${(tvl / 1_000).toFixed(0)}K)`);
  } else {
    summary.push(`Pool has low TVL ($${tvl.toFixed(0)}) — higher slippage risk`);
  }

  if (dayRangePercent < 2) {
    summary.push(`Day price range ${dayRangePercent.toFixed(2)}% — low IL risk`);
  } else if (dayRangePercent < 10) {
    summary.push(`Day price range ${dayRangePercent.toFixed(2)}% — moderate IL risk`);
  } else {
    summary.push(`Day price range ${dayRangePercent.toFixed(2)}% — high IL risk`);
  }

  return summary;
}

const SOL_NATIVE_MINT = 'So11111111111111111111111111111111111111112';

async function getWalletUsdValue(walletAddress?: string): Promise<{ totalUsd: number; address: string } | null> {
  try {
    if (!walletAddress) return null;

    const publicKey = new PublicKey(walletAddress);
    const address = walletAddress;
    const configResult = loadConfig();
    const rpcUrl = configResult.ok ? configResult.value.rpc_url : SOLANA_RPC_URL;
    const connection = new Connection(rpcUrl);

    // 1. Get SOL balance
    const lamports = await connection.getBalance(publicKey);
    const solBalance = lamports / LAMPORTS_PER_SOL;

    // 2. Get SPL token accounts (TOKEN_PROGRAM_ID + TOKEN_2022) in parallel
    const tokenAccounts: { mint: string; amountUi: number }[] = [];
    const [splResult, t22Result] = await Promise.allSettled([
      connection.getTokenAccountsByOwner(publicKey, { programId: TOKEN_PROGRAM_ID }),
      connection.getTokenAccountsByOwner(publicKey, { programId: TOKEN_2022_PROGRAM_ID }),
    ]);

    interface RawAccount { mint: string; amount: bigint }
    const rawAccounts: RawAccount[] = [];
    for (const [result] of [[splResult], [t22Result]] as const) {
      if (result.status !== 'fulfilled') continue;
      for (const { account } of result.value.value) {
        const data = account.data;
        const mint = new PublicKey(data.subarray(0, 32)).toBase58();
        const amount = data.subarray(64, 72).readBigUInt64LE();
        if (amount === 0n) continue;
        rawAccounts.push({ mint, amount });
      }
    }

    // 3. Fetch decimals for each mint
    const uniqueMints = [...new Set(rawAccounts.map(a => a.mint))];
    const mintDecimals = new Map<string, number>();
    for (let i = 0; i < uniqueMints.length; i += 100) {
      const batch = uniqueMints.slice(i, i + 100);
      const mintPubkeys = batch.map(m => new PublicKey(m));
      const mintInfos = await connection.getMultipleAccountsInfo(mintPubkeys);
      for (let j = 0; j < batch.length; j++) {
        const info = mintInfos[j];
        if (info?.data) {
          const decimals = info.data[44];
          mintDecimals.set(batch[j], decimals);
        }
      }
    }

    for (const raw of rawAccounts) {
      const decimals = mintDecimals.get(raw.mint);
      if (decimals === undefined || decimals === 0) continue;
      tokenAccounts.push({
        mint: raw.mint,
        amountUi: Number(raw.amount) / Math.pow(10, decimals),
      });
    }

    // 4. Get token prices (SOL + all SPL tokens)
    const allMints = [SOL_NATIVE_MINT, ...tokenAccounts.map(t => t.mint)];
    const pricesResult = await api.getTokenPrices(allMints);
    if (!pricesResult.ok) return null;
    const prices = pricesResult.value;

    // 5. Calculate total USD value
    let totalUsd = solBalance * (prices[SOL_NATIVE_MINT] || 0);
    for (const token of tokenAccounts) {
      const price = prices[token.mint] || 0;
      totalUsd += token.amountUi * price;
    }

    return { totalUsd, address };
  } catch {
    return null;
  }
}

function createPoolsAnalyzeCommand(): Command {
  return new Command('analyze')
    .description('Comprehensive pool analysis with APR estimation, risk assessment, and range comparison')
    .argument('<pool-id>', 'Pool address')
    .option('--amount <usd>', 'Simulated investment amount in USD (default: wallet balance)')
    .option('--ranges <percents>', 'Custom range percentages, comma-separated', '1,2,3,5,8,10,15,20,35,50')
    .action(async (poolId: string, options: { amount?: string; ranges: string }, cmd: Command) => {
      const globalOptions = cmd.optsWithGlobals();
      const format: OutputFormat = globalOptions.output || 'table';
      const startTime = Date.now();
      const rangePercents = options.ranges.split(',').map((s: string) => parseInt(s.trim(), 10)).filter((n: number) => !isNaN(n));

      // Investment amount: user --amount or default $1000
      const investAmount = options.amount ? parseFloat(options.amount) : 1000;

      // Wallet balance as reference context (not the projection amount)
      let walletBalanceUsd: number | undefined;
      let walletAddress: string | undefined;
      let walletWarning: string | undefined;
      if (!options.amount) {
        const walletResult = await getWalletUsdValue(globalOptions.walletAddress);
        if (walletResult) {
          walletBalanceUsd = parseFloat(walletResult.totalUsd.toFixed(2));
          walletAddress = walletResult.address;
          if (walletResult.totalUsd < 10) {
            walletWarning = `Wallet balance is $${walletResult.totalUsd.toFixed(2)}, below $10. Consider depositing more funds before opening a position.`;
          }
        }
      }

      // 1. Get API pool info
      const poolResult = await api.getPoolInfo(poolId);
      if (!poolResult.ok) {
        if (format === 'json') {
          outputErrorJson(poolResult.error);
        } else {
          outputErrorTable(poolResult.error);
        }
        process.exit(1);
      }
      const pool = poolResult.value;

      try {
        // 2. Get on-chain pool info (lazy-load SDK)
        const { getChain } = await import('../../sdk/init.js');
        const { calculateRangeAprs, TickMath } = await import('@byreal-io/byreal-clmm-sdk');

        const chain = getChain();
        const chainPoolInfo = await chain.getRawPoolInfoByPoolId(poolId);

        // 3. Basic pool info
        const feeRatePercent = pool.fee_rate_bps / 100;
        const feeRate = pool.fee_rate_bps / 10000;
        const currentPrice = pool.current_price;
        const tokenAPriceUsd = pool.token_a.price_usd || 0;
        const tokenBPriceUsd = pool.token_b.price_usd || 0;

        // 4. Metrics
        // Detail API's feeUsd24h is unreliable (equals feeApr24h), compute from volume × feeRate
        const fee24h = pool.volume_24h_usd * feeRate;
        // Detail API's volumeUsd7d is missing, compute from fee_7d / feeRate
        const fee7d = pool.fee_7d_usd || 0;
        const volume7d = feeRate > 0 && fee7d > 0 ? fee7d / feeRate : pool.volume_7d_usd;
        const feeApr24h = pool.tvl_usd > 0 ? (fee24h / pool.tvl_usd) * 365 * 100 : 0;
        const volumeToTvl = pool.tvl_usd > 0 ? pool.volume_24h_usd / pool.tvl_usd : 0;

        // 5. Volatility — use dayPriceRange from detail API (reliable on-chain data)
        const dayPriceLow = pool.price_range_24h.low;
        const dayPriceHigh = pool.price_range_24h.high;
        const dayPriceRangePercent = currentPrice > 0 ? ((dayPriceHigh - dayPriceLow) / currentPrice) * 100 : 0;

        // 6. Rewards
        const now = Math.floor(Date.now() / 1000);
        const rewardsOutput = (pool.rewards || [])
          .filter((r) => r.endTime > now)
          .map((r) => {
            // Estimate reward APR: rewardPerSecond * 86400 * priceUsd / tvl * 365 * 100
            // We don't have the reward token price easily, so we just report what we have
            return {
              token: r.symbol || r.mint,
              rewardPerSecond: r.rewardPerSecond,
              endTime: new Date(r.endTime * 1000).toISOString().slice(0, 10),
            };
          });

        // 7. Range Analysis — use SDK calculateRangeAprs
        const rangeAprs = calculateRangeAprs({
          percentRanges: rangePercents,
          volume24h: pool.volume_24h_usd,
          feeRate,
          tokenAPriceUsd,
          tokenBPriceUsd,
          poolInfo: chainPoolInfo,
        });

        // Also calculate tick-aligned prices for each range
        const currentPriceDec = TickMath.getPriceFromTick({
          tick: chainPoolInfo.tickCurrent,
          decimalsA: chainPoolInfo.mintDecimalsA,
          decimalsB: chainPoolInfo.mintDecimalsB,
        });

        const rangeAnalysis = rangePercents.map((pct) => {
          const lowerPriceRatio = new Decimal(1).minus(new Decimal(pct).div(100));
          const upperPriceRatio = new Decimal(1).plus(new Decimal(pct).div(100));
          const priceLower = currentPriceDec.mul(lowerPriceRatio);
          const priceUpper = currentPriceDec.mul(upperPriceRatio);

          // Align to ticks
          const tickLower = TickMath.getTickWithPriceAndTickspacing(
            priceLower,
            chainPoolInfo.tickSpacing,
            chainPoolInfo.mintDecimalsA,
            chainPoolInfo.mintDecimalsB,
          );
          const tickUpper = TickMath.getTickWithPriceAndTickspacing(
            priceUpper,
            chainPoolInfo.tickSpacing,
            chainPoolInfo.mintDecimalsA,
            chainPoolInfo.mintDecimalsB,
          );

          const alignedPriceLower = TickMath.getPriceFromTick({
            tick: tickLower,
            decimalsA: chainPoolInfo.mintDecimalsA,
            decimalsB: chainPoolInfo.mintDecimalsB,
          });
          const alignedPriceUpper = TickMath.getPriceFromTick({
            tick: tickUpper,
            decimalsA: chainPoolInfo.mintDecimalsA,
            decimalsB: chainPoolInfo.mintDecimalsB,
          });

          const rangeWidth = pct * 2; // total range width as percent
          const inRangeLikelihood = assessInRangeLikelihood(rangeWidth, dayPriceRangePercent);
          const rebalanceFrequency = assessRebalanceFrequency(inRangeLikelihood);

          const feeApr = rangeAprs[pct] || 0;

          return {
            rangePercent: pct,
            priceLower: alignedPriceLower.toFixed(8).replace(/0+$/, '').replace(/\.$/, ''),
            priceUpper: alignedPriceUpper.toFixed(8).replace(/0+$/, '').replace(/\.$/, ''),
            estimatedFeeApr: `${feeApr.toFixed(1)}%`,
            estimatedTotalApr: `${feeApr.toFixed(1)}%`, // same as feeApr if no rewards calculated
            inRangeLikelihood,
            rebalanceFrequency,
          };
        });

        // 8. Risk Factors
        const tvlRisk = assessTvlRisk(pool.tvl_usd);
        const volatilityRisk = assessVolatilityRisk(dayPriceRangePercent);
        const riskSummary = buildRiskSummary(pool, dayPriceRangePercent);

        // 9. Investment Projection — use default range (10% or middle range)
        const projectionRange = rangePercents.includes(10) ? 10 : rangePercents[Math.floor(rangePercents.length / 2)];
        const projectionApr = rangeAprs[projectionRange] || 0;
        const dailyFee = (projectionApr / 100 / 365) * investAmount;
        const weeklyFee = dailyFee * 7;
        const monthlyFee = dailyFee * 30;
        // Get concrete price range for the projection range
        const projectionRangeEntry = rangeAnalysis.find(r => r.rangePercent === projectionRange);

        // Build output
        const analysisData = {
          pool: {
            address: pool.id,
            pair: pool.pair,
            category: CATEGORY_LABELS[pool.category || 0] || 'unknown',
            currentPrice: currentPriceDec.toFixed(8).replace(/0+$/, '').replace(/\.$/, ''),
            feeRate: `${feeRatePercent.toFixed(2)}%`,
            tickSpacing: chainPoolInfo.tickSpacing,
          },
          metrics: {
            tvl: pool.tvl_usd.toFixed(2),
            volume24h: pool.volume_24h_usd.toFixed(2),
            volume7d: volume7d.toFixed(2),
            fee24h: fee24h.toFixed(2),
            fee7d: fee7d.toFixed(2),
            feeApr24h: `${feeApr24h.toFixed(2)}%`,
            volumeToTvl: volumeToTvl.toFixed(2),
          },
          volatility: {
            dayPriceRange: {
              low: dayPriceLow.toFixed(8).replace(/0+$/, '').replace(/\.$/, ''),
              high: dayPriceHigh.toFixed(8).replace(/0+$/, '').replace(/\.$/, ''),
            },
            dayPriceRangePercent: `${dayPriceRangePercent.toFixed(2)}%`,
          },
          rewards: rewardsOutput.length > 0 ? rewardsOutput : undefined,
          rangeAnalysis,
          riskFactors: {
            tvlRisk: assessRisk(tvlRisk),
            volatilityRisk: assessRisk(volatilityRisk),
            summary: riskSummary,
          },
          wallet: walletBalanceUsd !== undefined ? {
            address: walletAddress,
            balanceUsd: walletBalanceUsd,
            ...(walletWarning ? { warning: walletWarning } : {}),
          } : undefined,
          investmentProjection: {
            amountUsd: parseFloat(investAmount.toFixed(2)),
            rangePercent: projectionRange,
            priceLower: projectionRangeEntry?.priceLower,
            priceUpper: projectionRangeEntry?.priceUpper,
            dailyFeeEstimate: dailyFee.toFixed(2),
            weeklyFeeEstimate: weeklyFee.toFixed(2),
            monthlyFeeEstimate: monthlyFee.toFixed(2),
            note: 'Based on current 24h volume/fees. Actual returns vary.',
          },
        };

        if (format === 'json') {
          outputJson(analysisData, startTime);
        } else {
          outputPoolAnalysisTable(analysisData);
        }
      } catch (e) {
        const message = (e as Error).message || 'Unknown SDK error';
        if (format === 'json') {
          outputErrorJson({ code: 'SDK_ERROR', type: 'SYSTEM', message, retryable: false });
        } else {
          console.error(chalk.red(`\nSDK Error: ${message}`));
          if (process.env.DEBUG) {
            console.error((e as Error).stack);
          }
        }
        process.exit(1);
      }
    });
}

// ============================================
// Create Pools Command
// ============================================

export function createPoolsCommand(): Command {
  const pools = new Command('pools')
    .description('Manage and query liquidity pools');

  // List subcommand (default)
  pools
    .command('list', { isDefault: true })
    .description('List available pools (use -o json for JSON output)')
    .option('--sort-field <field>', 'Sort by field: tvl, volumeUsd24h, feeUsd24h, apr24h', 'tvl')
    .option('--sort-type <type>', 'Sort order: asc, desc', 'desc')
    .option('--page <n>', 'Page number', '1')
    .option('--page-size <n>', 'Results per page', String(DEFAULTS.LIST_LIMIT))
    .option('--category <cat>', 'Pool category: 1=stable, 2=xStocks, 4=launchpad, 16=normal')
    .action(async (options: ListPoolsOptions, cmd: Command) => {
      const globalOptions = cmd.optsWithGlobals();
      await listPools(options, { output: globalOptions.output || 'table' });
    });

  // Info subcommand
  pools
    .command('info <pool-id>')
    .description('Get detailed information about a pool (use -o json for JSON output)')
    .action(async (poolId: string, _options: unknown, cmd: Command) => {
      const globalOptions = cmd.optsWithGlobals();
      await getPoolInfo(poolId, { output: globalOptions.output || 'table' });
    });

  // Klines subcommand
  pools
    .command('klines <pool-id>')
    .description('Get K-line data for a pool (use -o json for JSON output)')
    .option('--token <address>', 'Token mint address (auto-detects base token if not provided)')
    .option('--interval <type>', 'K-line interval: 1m, 3m, 5m, 15m, 30m, 1h, 4h, 12h, 1d', '1h')
    .option('--start <timestamp>', 'Start time (seconds since epoch)')
    .option('--end <timestamp>', 'End time (seconds since epoch, default: now)')
    .action(async (
      poolId: string,
      options: { token?: string; interval: string; start?: string; end?: string },
      cmd: Command
    ) => {
      const globalOptions = cmd.optsWithGlobals();
      const startTime = Date.now();

      // 如果没有提供 token，从池子信息中获取 base token
      let tokenAddress = options.token;
      if (!tokenAddress) {
        const poolResult = await api.getPoolInfo(poolId);
        if (!poolResult.ok) {
          outputError(poolResult.error, globalOptions.output || 'table');
          process.exit(1);
        }
        tokenAddress = poolResult.value.token_a.mint;
      }

      const endTime = options.end ? parseInt(options.end, 10) : Math.floor(Date.now() / 1000);

      // 根据 interval 计算默认时间跨度，确保至少 60 根 K 线
      const intervalSeconds: Record<string, number> = {
        '1m': 60,
        '3m': 3 * 60,
        '5m': 5 * 60,
        '15m': 15 * 60,
        '30m': 30 * 60,
        '1h': 60 * 60,
        '4h': 4 * 60 * 60,
        '12h': 12 * 60 * 60,
        '1d': 24 * 60 * 60,
      };
      const minCandles = 60;
      const intervalSec = intervalSeconds[options.interval] || 60 * 60;
      const defaultTimeRange = intervalSec * minCandles;

      const klineStartTime = options.start
        ? parseInt(options.start, 10)
        : endTime - defaultTimeRange;

      const result = await api.getKlines({
        poolAddress: poolId,
        tokenAddress,
        klineType: options.interval as KlineInterval,
        startTime: klineStartTime,
        endTime,
      });

      if (!result.ok) {
        outputError(result.error, globalOptions.output || 'table');
        process.exit(1);
      }

      output(
        { klines: result.value, pool_id: poolId, token: tokenAddress },
        globalOptions.output || 'table',
        (data) => outputKlineChart(data.klines, data.pool_id, data.token),
        startTime
      );
    });

  // Analyze subcommand
  pools.addCommand(createPoolsAnalyzeCommand());

  return pools;
}
