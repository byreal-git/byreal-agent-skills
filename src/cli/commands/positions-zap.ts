/**
 * Auto Swap (Zap) helpers for positions commands.
 *
 * Each runZap* function implements the full lifecycle for one of the four
 * supported flows when the user passes `--auto-swap`:
 *   - runZapInOpen          → positions open --auto-swap
 *   - runZapInIncrease      → positions increase --auto-swap
 *   - runZapOutPartial      → positions decrease --auto-swap
 *   - runZapOutFull         → positions close    --auto-swap
 *
 * Lifecycle: validate → quote → preview/dry-run → build-tx (with 41319 retry)
 * → co-sign with positionNftMint Keypair when needed → send → telemetry.
 *
 * Backend contract: see apps/web/src/features/zap/api.ts.
 */
import chalk from 'chalk';
import BN from 'bn.js';
import { Keypair, PublicKey } from '@solana/web3.js';
import type { Connection } from '@solana/web3.js';

import { api } from '../../api/endpoints.js';
import { rawToUi, uiToRaw } from '../../core/amounts.js';
import { getConnection, getSlippageBps } from '../../core/solana.js';
import {
  deserializeTransaction,
  signTransaction,
  sendAndConfirmTransaction,
  serializeTransaction,
} from '../../core/transaction.js';
import { trackEvent } from '../../core/telemetry.js';
import {
  outputJson,
  outputErrorJson,
  outputErrorTable,
  outputTransactionResult,
  outputZapInPreview,
  outputZapOutPreview,
  formatUsd,
} from '../output/formatters.js';
import {
  printDryRunBanner,
  printConfirmBanner,
} from '../../core/confirm.js';
import type {
  AutoSwapZapInQuoteResponse,
  AutoSwapZapInBuildTxResponse,
  AutoSwapZapOutQuoteResponse,
  AutoSwapZapOutBuildTxResponse,
  AutoSwapZapInOpenPositionQuoteRequest,
  AutoSwapZapInIncreaseLiquidityQuoteRequest,
  AutoSwapZapOutQuoteRequest,
} from '../../core/types.js';
import type { ByrealError } from '../../core/errors.js';

// ============================================
// Shared context
// ============================================

export type ZapMode = 'dry-run' | 'confirm' | 'unsigned-tx';
export type OutputFormat = 'json' | 'table' | 'csv';

export interface ZapContext {
  format: OutputFormat;
  mode: ZapMode;
  publicKey: PublicKey;
  keypair?: Keypair; // present when mode !== 'unsigned-tx'
  startTime: number;
}

interface PoolMeta {
  symbolA: string;
  symbolB: string;
  mintA: string;
  mintB: string;
  decimalsA: number;
  decimalsB: number;
  priceA: number;
  priceB: number;
}

// ============================================
// Helpers
// ============================================

// Reuse balance helpers from positions.ts (exported there). Lazy-imported to
// avoid pulling all of positions.ts into the cold path of dry-run.
async function runZapInBalanceCheck(params: {
  publicKey: PublicKey;
  inputMint: string;
  inputSymbol: string;
  inputDecimals: number;
  amountRaw: string;
}): Promise<{
  warnings: import('./positions.js').BalanceWarning[];
  walletBalances?: import('./positions.js').WalletBalanceSummary;
}> {
  const { checkSingleMintBalance, fetchWalletBalanceSummary } = await import('./positions.js');
  const required = new BN(params.amountRaw);
  const warnings = await checkSingleMintBalance(
    params.publicKey,
    params.inputMint,
    params.inputSymbol,
    params.inputDecimals,
    required,
  );
  if (warnings.length === 0) return { warnings };
  const walletBalances = await fetchWalletBalanceSummary(params.publicKey);
  return { warnings, walletBalances };
}

function printZapInBalanceWarnings(
  warnings: import('./positions.js').BalanceWarning[],
  walletBalances?: import('./positions.js').WalletBalanceSummary,
): void {
  if (warnings.length === 0) return;
  console.log(chalk.red.bold('\n  Insufficient Balance'));
  for (const w of warnings) {
    console.log(
      chalk.red(`    ${w.symbol}: need ${w.required}, have ${w.available} (deficit: ${w.deficit})`),
    );
    console.log(
      chalk.yellow(
        `    → Swap to get ${w.symbol}: byreal-cli swap execute --output-mint ${w.mint} --input-mint <source-token-mint> --amount <amount> --confirm`,
      ),
    );
  }
  if (walletBalances) {
    console.log(chalk.cyan.bold('\n  Available Tokens for Swap'));
    for (const t of walletBalances.tokens) {
      console.log(chalk.white(`    ${t.symbol}: ${t.amount} (${t.mint})`));
    }
  }
}

function isQuoteExpiredError(err: ByrealError): boolean {
  const status = err.details && typeof err.details === 'object' ? (err.details as Record<string, unknown>).status_code : undefined;
  return status === 41319;
}

function failWith(format: OutputFormat, err: { code: string; type: 'VALIDATION' | 'BUSINESS' | 'AUTH' | 'NETWORK' | 'SYSTEM'; message: string; retryable: boolean }): never {
  if (format === 'json') {
    outputErrorJson(err);
  } else {
    outputErrorTable(err);
  }
  process.exit(1);
}

function failWithByreal(format: OutputFormat, err: ByrealError): never {
  if (format === 'json') {
    outputErrorJson(err.toJSON());
  } else {
    outputErrorTable(err.toJSON());
  }
  process.exit(1);
}

async function fetchPoolMeta(poolAddress: string): Promise<PoolMeta | null> {
  const poolApi = await api.getPoolInfo(poolAddress);
  if (!poolApi.ok) return null;
  const p = poolApi.value;
  return {
    symbolA: p.token_a.symbol || 'TokenA',
    symbolB: p.token_b.symbol || 'TokenB',
    mintA: p.token_a.mint,
    mintB: p.token_b.mint,
    decimalsA: p.token_a.decimals,
    decimalsB: p.token_b.decimals,
    priceA: p.token_a.price_usd ?? 0,
    priceB: p.token_b.price_usd ?? 0,
  };
}

/**
 * Resolve --base (MintA / MintB / mint address) -> input mint.
 */
function resolveInputMint(base: string, meta: PoolMeta): string {
  if (base === 'MintA') return meta.mintA;
  if (base === 'MintB') return meta.mintB;
  // Raw mint address form: must match one of the pool mints.
  if (base === meta.mintA) return meta.mintA;
  if (base === meta.mintB) return meta.mintB;
  failWith('json', {
    code: 'INVALID_PARAMS',
    type: 'VALIDATION',
    message: `--base "${base}" must be MintA, MintB, or one of the pool mints (${meta.mintA}, ${meta.mintB}).`,
    retryable: false,
  });
}

/**
 * Sign + send a base64 zap tx, optionally co-signing with positionNftMint Keypair.
 * Returns { signature, confirmed }.
 */
async function signAndSendZapTx(
  base64Tx: string,
  userKeypair: Keypair,
  extraSigner: Keypair | undefined,
  format: OutputFormat,
): Promise<{ signature: string; confirmed: boolean }> {
  const txResult = deserializeTransaction(base64Tx);
  if (!txResult.ok) failWithByreal(format, txResult.error);

  let tx = txResult.value;
  if (extraSigner) {
    tx = signTransaction(tx, extraSigner);
  }
  tx = signTransaction(tx, userKeypair);

  const connection: Connection = getConnection();
  const sendResult = await sendAndConfirmTransaction(connection, tx);
  if (!sendResult.ok) failWithByreal(format, sendResult.error);
  return sendResult.value;
}

// ============================================
// runZapInOpen — positions open --auto-swap
// ============================================

export interface RunZapInOpenInput {
  poolAddress: string;
  base: string;                  // --base (MintA | MintB | mint)
  amountUi: string;              // UI amount (e.g. "0.01") OR raw if isRaw=true
  isRaw: boolean;                // true → amountUi is already in smallest units
  tickLower: number;
  tickUpper: number;
  priceLowerUi: string;
  priceUpperUi: string;
  slippageBps: number;
  ctx: ZapContext;
}

export async function runZapInOpen(input: RunZapInOpenInput): Promise<void> {
  const { ctx, poolAddress, base, amountUi, isRaw, tickLower, tickUpper, priceLowerUi, priceUpperUi, slippageBps } = input;
  const { format, mode, publicKey, keypair, startTime } = ctx;

  const meta = await fetchPoolMeta(poolAddress);
  if (!meta) {
    failWith(format, {
      code: 'POOL_NOT_FOUND',
      type: 'BUSINESS',
      message: `Pool not found: ${poolAddress}`,
      retryable: false,
    });
  }

  const inputMint = resolveInputMint(base, meta);
  const inputDecimals = inputMint === meta.mintA ? meta.decimalsA : meta.decimalsB;
  const inputSymbol = inputMint === meta.mintA ? meta.symbolA : meta.symbolB;
  const inputPriceUsd = inputMint === meta.mintA ? meta.priceA : meta.priceB;
  const amountRaw = isRaw ? amountUi : uiToRaw(amountUi, inputDecimals);

  // Generate position NFT mint Keypair (used for co-signing build-tx output)
  const positionNftMint = Keypair.generate();

  const quotePayload: AutoSwapZapInOpenPositionQuoteRequest = {
    poolAddress,
    userPublicKey: publicKey.toBase58(),
    inputMint,
    amount: amountRaw,
    tickLowerIndex: tickLower,
    tickUpperIndex: tickUpper,
    slippageBps,
  };

  const quoteResult = await api.quoteZapOpen(quotePayload);
  if (!quoteResult.ok) failWithByreal(format, quoteResult.error);
  const quote = quoteResult.value;

  const previewData = buildZapInPreview({
    flow: 'open',
    quote,
    inputMint,
    inputSymbol,
    inputAmountRaw: amountRaw,
    inputDecimals,
    inputPriceUsd,
    meta,
    slippageBps,
    extras: { poolAddress, tickLower, tickUpper, priceLower: priceLowerUi, priceUpper: priceUpperUi, positionNftMint: positionNftMint.publicKey.toBase58() },
  });

  if (mode === 'dry-run') {
    printDryRunBanner();
    // Single-mint balance check (parity with dual-token open dry-run)
    const { warnings, walletBalances } = await runZapInBalanceCheck({
      publicKey,
      inputMint,
      inputSymbol,
      inputDecimals,
      amountRaw,
    });
    if (format === 'json') {
      const json: Record<string, unknown> = { mode: 'dry-run', autoSwap: true, ...previewData };
      if (warnings.length > 0) {
        json.balanceWarnings = warnings;
        json.walletBalances = walletBalances;
      }
      outputJson(json, startTime);
    } else {
      outputZapInPreview(previewData);
      printZapInBalanceWarnings(warnings, walletBalances);
      if (warnings.length === 0) {
        console.log(chalk.green('\n  Balance check: sufficient'));
        console.log(chalk.yellow('  Use --confirm to open this auto-swap position'));
      }
    }
    return;
  }

  const buildResult = await buildOpenWithRetry(
    quotePayload,
    quote,
    positionNftMint.publicKey.toBase58(),
    format,
  );

  if (!buildResult.transaction) {
    failWith(format, {
      code: 'NO_TRANSACTION',
      type: 'NETWORK',
      message: 'Backend did not return a transaction in build-tx response',
      retryable: true,
    });
  }

  if (mode === 'unsigned-tx') {
    // Co-sign with positionNftMint, then output (user signs separately)
    const txResult = deserializeTransaction(buildResult.transaction);
    if (!txResult.ok) failWithByreal(format, txResult.error);
    const partiallySigned = signTransaction(txResult.value, positionNftMint);
    console.log(JSON.stringify({ unsignedTransactions: [serializeTransaction(partiallySigned)], extraSignerPublicKey: positionNftMint.publicKey.toBase58() }));
    return;
  }

  printConfirmBanner();
  const sendValue = await signAndSendZapTx(buildResult.transaction, keypair!, positionNftMint, format);

  trackEvent('CliPositionOpened', {
    wallet_address: publicKey.toBase58(),
    tx_signature: sendValue.signature,
    pool_address: poolAddress,
    tick_lower: tickLower,
    tick_upper: tickUpper,
    nft_address: positionNftMint.publicKey.toBase58(),
    confirmed: sendValue.confirmed,
    auto_swap: true,
    zap_input_mint: inputMint,
    zap_provider: buildResult.selectedProvider,
    zap_price_impact_bps: buildResult.quote?.priceImpactBps ?? quote.quote?.priceImpactBps,
  });

  const txData = {
    signature: sendValue.signature,
    confirmed: sendValue.confirmed,
    nftAddress: positionNftMint.publicKey.toBase58(),
    autoSwap: true,
    selectedProvider: buildResult.selectedProvider,
  };

  if (format === 'json') {
    outputJson(txData, startTime);
  } else {
    outputTransactionResult('Position Opened (Auto Swap)', txData);
  }
}

async function buildOpenWithRetry(
  quotePayload: AutoSwapZapInOpenPositionQuoteRequest,
  initialQuote: AutoSwapZapInQuoteResponse,
  positionNftMint: string,
  format: OutputFormat,
): Promise<AutoSwapZapInBuildTxResponse> {
  let quote = initialQuote;
  let attempt = 0;
  while (true) {
    if (!quote.quoteId || !quote.quoteContext) {
      failWith(format, {
        code: 'INVALID_QUOTE',
        type: 'BUSINESS',
        message: 'Quote response missing quoteId or quoteContext',
        retryable: true,
      });
    }
    const buildRes = await api.buildTxZapOpen({
      quoteId: quote.quoteId,
      quoteContext: quote.quoteContext,
      positionNftMint,
    });
    if (buildRes.ok) return buildRes.value;
    if (attempt < 1 && isQuoteExpiredError(buildRes.error)) {
      // refresh quote once
      const fresh = await api.quoteZapOpen(quotePayload);
      if (!fresh.ok) failWithByreal(format, fresh.error);
      quote = fresh.value;
      attempt++;
      continue;
    }
    failWithByreal(format, buildRes.error);
  }
}

// ============================================
// runZapInIncrease — positions increase --auto-swap
// ============================================

export interface RunZapInIncreaseInput {
  poolAddress: string;
  personalPosition: string; // position address (NOT nft mint)
  base: string;
  amountUi: string;         // UI amount (e.g. "0.005") OR raw if isRaw=true
  isRaw: boolean;
  slippageBps: number;
  nftMint: string;
  ctx: ZapContext;
}

export async function runZapInIncrease(input: RunZapInIncreaseInput): Promise<void> {
  const { ctx, poolAddress, personalPosition, base, amountUi, isRaw, slippageBps, nftMint } = input;
  const { format, mode, publicKey, keypair, startTime } = ctx;

  const meta = await fetchPoolMeta(poolAddress);
  if (!meta) {
    failWith(format, {
      code: 'POOL_NOT_FOUND',
      type: 'BUSINESS',
      message: `Pool not found: ${poolAddress}`,
      retryable: false,
    });
  }

  const inputMint = resolveInputMint(base, meta);
  const inputDecimals = inputMint === meta.mintA ? meta.decimalsA : meta.decimalsB;
  const inputSymbol = inputMint === meta.mintA ? meta.symbolA : meta.symbolB;
  const inputPriceUsd = inputMint === meta.mintA ? meta.priceA : meta.priceB;
  const amountRaw = isRaw ? amountUi : uiToRaw(amountUi, inputDecimals);

  const quotePayload: AutoSwapZapInIncreaseLiquidityQuoteRequest = {
    poolAddress,
    userPublicKey: publicKey.toBase58(),
    inputMint,
    amount: amountRaw,
    personalPosition,
    slippageBps,
  };

  const quoteResult = await api.quoteZapIncrease(quotePayload);
  if (!quoteResult.ok) failWithByreal(format, quoteResult.error);
  const quote = quoteResult.value;

  const previewData = buildZapInPreview({
    flow: 'increase',
    quote,
    inputMint,
    inputSymbol,
    inputAmountRaw: amountRaw,
    inputDecimals,
    inputPriceUsd,
    meta,
    slippageBps,
    extras: { poolAddress, nftMint, personalPosition },
  });

  if (mode === 'dry-run') {
    printDryRunBanner();
    const { warnings, walletBalances } = await runZapInBalanceCheck({
      publicKey,
      inputMint,
      inputSymbol,
      inputDecimals,
      amountRaw,
    });
    if (format === 'json') {
      const json: Record<string, unknown> = { mode: 'dry-run', autoSwap: true, ...previewData };
      if (warnings.length > 0) {
        json.balanceWarnings = warnings;
        json.walletBalances = walletBalances;
      }
      outputJson(json, startTime);
    } else {
      outputZapInPreview(previewData);
      printZapInBalanceWarnings(warnings, walletBalances);
      if (warnings.length === 0) {
        console.log(chalk.green('\n  Balance check: sufficient'));
        console.log(chalk.yellow('  Use --confirm to add liquidity (auto-swap)'));
      }
    }
    return;
  }

  const buildResult = await buildIncreaseWithRetry(quotePayload, quote, format);

  if (!buildResult.transaction) {
    failWith(format, {
      code: 'NO_TRANSACTION',
      type: 'NETWORK',
      message: 'Backend did not return a transaction in build-tx response',
      retryable: true,
    });
  }

  if (mode === 'unsigned-tx') {
    console.log(JSON.stringify({ unsignedTransactions: [buildResult.transaction] }));
    return;
  }

  printConfirmBanner();
  const sendValue = await signAndSendZapTx(buildResult.transaction, keypair!, undefined, format);

  trackEvent('CliPositionIncreased', {
    wallet_address: publicKey.toBase58(),
    tx_signature: sendValue.signature,
    pool_address: poolAddress,
    nft_mint: nftMint,
    confirmed: sendValue.confirmed,
    auto_swap: true,
    zap_input_mint: inputMint,
    zap_provider: buildResult.selectedProvider,
    zap_price_impact_bps: buildResult.quote?.priceImpactBps ?? quote.quote?.priceImpactBps,
  });

  const txData = {
    signature: sendValue.signature,
    confirmed: sendValue.confirmed,
    autoSwap: true,
    selectedProvider: buildResult.selectedProvider,
  };

  if (format === 'json') {
    outputJson(txData, startTime);
  } else {
    outputTransactionResult('Liquidity Increased (Auto Swap)', txData);
  }
}

async function buildIncreaseWithRetry(
  quotePayload: AutoSwapZapInIncreaseLiquidityQuoteRequest,
  initialQuote: AutoSwapZapInQuoteResponse,
  format: OutputFormat,
): Promise<AutoSwapZapInBuildTxResponse> {
  let quote = initialQuote;
  let attempt = 0;
  while (true) {
    if (!quote.quoteId || !quote.quoteContext) {
      failWith(format, {
        code: 'INVALID_QUOTE',
        type: 'BUSINESS',
        message: 'Quote response missing quoteId or quoteContext',
        retryable: true,
      });
    }
    const buildRes = await api.buildTxZapIncrease({
      quoteId: quote.quoteId,
      quoteContext: quote.quoteContext,
    });
    if (buildRes.ok) return buildRes.value;
    if (attempt < 1 && isQuoteExpiredError(buildRes.error)) {
      const fresh = await api.quoteZapIncrease(quotePayload);
      if (!fresh.ok) failWithByreal(format, fresh.error);
      quote = fresh.value;
      attempt++;
      continue;
    }
    failWithByreal(format, buildRes.error);
  }
}

// ============================================
// runZapOut* — positions decrease / close --auto-swap
// ============================================

export interface RunZapOutInput {
  poolAddress: string;
  personalPosition: string;
  outputMint: string;
  closePosition: boolean;
  liquidity?: string; // raw liquidity to remove (omit when closing)
  slippageBps: number;
  nftMint: string;
  percentage?: number; // for telemetry / preview
  ctx: ZapContext;
}

export async function runZapOut(input: RunZapOutInput): Promise<void> {
  const { ctx, poolAddress, personalPosition, outputMint, closePosition, liquidity, slippageBps, nftMint, percentage } = input;
  const { format, mode, publicKey, keypair, startTime } = ctx;

  const meta = await fetchPoolMeta(poolAddress);
  if (!meta) {
    failWith(format, {
      code: 'POOL_NOT_FOUND',
      type: 'BUSINESS',
      message: `Pool not found: ${poolAddress}`,
      retryable: false,
    });
  }

  // Resolve output token info
  let outputDecimals: number;
  let outputSymbol: string;
  if (outputMint === meta.mintA) {
    outputDecimals = meta.decimalsA;
    outputSymbol = meta.symbolA;
  } else if (outputMint === meta.mintB) {
    outputDecimals = meta.decimalsB;
    outputSymbol = meta.symbolB;
  } else {
    failWith(format, {
      code: 'INVALID_PARAMS',
      type: 'VALIDATION',
      message: `--output-mint must be one of the pool mints (${meta.mintA}, ${meta.mintB}).`,
      retryable: false,
    });
  }

  const quotePayload: AutoSwapZapOutQuoteRequest = {
    poolAddress,
    userPublicKey: publicKey.toBase58(),
    personalPosition,
    outputMint,
    closePosition,
    ...(liquidity ? { liquidity } : {}),
    slippageBps,
  };

  const quoteResult = await api.quoteZapOut(quotePayload);
  if (!quoteResult.ok) failWithByreal(format, quoteResult.error);
  let quote = quoteResult.value;

  const previewData = buildZapOutPreview({
    quote,
    outputMint,
    outputSymbol,
    outputDecimals,
    meta,
    slippageBps,
    extras: { poolAddress, nftMint, percentage, closePosition },
  });

  // Preview unclaimed incentives only for close path (decrease keeps the
  // NFT alive so unclaimed rewards keep accruing — preclaim isn't needed).
  let preclaimPreview: { unclaimedCount: number; willPreclaim: boolean } | undefined;
  if (closePosition) {
    const { previewIncentivePreclaim } = await import('./incentive-preclaim.js');
    preclaimPreview = await previewIncentivePreclaim(publicKey.toBase58(), personalPosition);
  }

  if (mode === 'dry-run') {
    printDryRunBanner();
    if (format === 'json') {
      const json: Record<string, unknown> = { mode: 'dry-run', autoSwap: true, ...previewData };
      if (preclaimPreview) json.unclaimedIncentives = preclaimPreview;
      outputJson(json, startTime);
    } else {
      outputZapOutPreview(previewData);
      if (preclaimPreview && preclaimPreview.willPreclaim) {
        console.log(
          chalk.cyan(
            `\n  ${preclaimPreview.unclaimedCount} unclaimed incentive reward(s) detected — will preclaim before close`,
          ),
        );
      }
      console.log(chalk.yellow(`\n  Use --confirm to ${closePosition ? 'close position' : 'decrease liquidity'} (auto-swap)`));
    }
    return;
  }

  // Best-effort incentive preclaim before close (matches frontend
  // useRemoveLiquidityZap → useBestEffortIncentivePreclaim semantics).
  let preclaim: import('./incentive-preclaim.js').IncentivePreclaimResult | undefined;
  if (closePosition && mode === 'confirm' && preclaimPreview?.willPreclaim) {
    const { runIncentivePreclaim } = await import('./incentive-preclaim.js');
    preclaim = await runIncentivePreclaim(
      publicKey.toBase58(),
      keypair!,
      personalPosition,
      format !== 'json',
    );
    if (!preclaim.canContinue) {
      // Reserved for future user-rejection path; current local-keypair flow
      // can only land here if we explicitly mark a hard failure.
      failWithByreal(format, {
        code: 'PRECLAIM_ABORTED',
        type: 'BUSINESS',
        message: preclaim.errorMessage ?? 'Incentive preclaim aborted',
        retryable: false,
        toJSON: () => ({
          code: 'PRECLAIM_ABORTED',
          type: 'BUSINESS',
          message: preclaim?.errorMessage ?? 'Incentive preclaim aborted',
          retryable: false,
        }),
      } as unknown as ByrealError);
    }
    if (preclaim.status === 'claimed') {
      const refreshedQuote = await api.quoteZapOut(quotePayload);
      if (!refreshedQuote.ok) failWithByreal(format, refreshedQuote.error);
      quote = refreshedQuote.value;
    }
  }

  const buildResult = await buildOutWithRetry(quotePayload, quote, format);

  if (!buildResult.transaction) {
    failWith(format, {
      code: 'NO_TRANSACTION',
      type: 'NETWORK',
      message: 'Backend did not return a transaction in build-tx response',
      retryable: true,
    });
  }

  if (mode === 'unsigned-tx') {
    console.log(JSON.stringify({ unsignedTransactions: [buildResult.transaction] }));
    return;
  }

  printConfirmBanner();
  const sendValue = await signAndSendZapTx(buildResult.transaction, keypair!, undefined, format);

  const eventName = closePosition ? 'CliPositionClosed' : 'CliPositionDecreased';
  trackEvent(eventName, {
    wallet_address: publicKey.toBase58(),
    tx_signature: sendValue.signature,
    pool_address: poolAddress,
    nft_mint: nftMint,
    confirmed: sendValue.confirmed,
    auto_swap: true,
    zap_output_mint: outputMint,
    zap_provider: buildResult.selectedProvider,
    zap_price_impact_bps: buildResult.quote?.priceImpactBps ?? quote.preview?.swapQuote?.priceImpactBps,
    ...(percentage !== undefined ? { percentage } : {}),
    ...(preclaim
      ? {
          incentive_preclaim_status: preclaim.status,
          incentive_preclaim_count: preclaim.unclaimedCount,
        }
      : {}),
  });

  const txData = {
    signature: sendValue.signature,
    confirmed: sendValue.confirmed,
    autoSwap: true,
    selectedProvider: buildResult.selectedProvider,
    ...(preclaim
      ? {
          incentivePreclaim: {
            status: preclaim.status,
            unclaimedCount: preclaim.unclaimedCount,
            ...(preclaim.signatures ? { signatures: preclaim.signatures } : {}),
            ...(preclaim.errorMessage ? { errorMessage: preclaim.errorMessage } : {}),
          },
        }
      : {}),
  };

  if (format === 'json') {
    outputJson(txData, startTime);
  } else {
    outputTransactionResult(closePosition ? 'Position Closed (Auto Swap)' : 'Liquidity Decreased (Auto Swap)', txData);
  }
}

async function buildOutWithRetry(
  quotePayload: AutoSwapZapOutQuoteRequest,
  initialQuote: AutoSwapZapOutQuoteResponse,
  format: OutputFormat,
): Promise<AutoSwapZapOutBuildTxResponse> {
  let quote = initialQuote;
  let attempt = 0;
  while (true) {
    if (!quote.quoteId || !quote.quoteContext) {
      failWith(format, {
        code: 'INVALID_QUOTE',
        type: 'BUSINESS',
        message: 'Quote response missing quoteId or quoteContext',
        retryable: true,
      });
    }
    const buildRes = await api.buildTxZapOut({
      quoteId: quote.quoteId,
      quoteContext: quote.quoteContext,
    });
    if (buildRes.ok) return buildRes.value;
    if (attempt < 1 && isQuoteExpiredError(buildRes.error)) {
      const fresh = await api.quoteZapOut(quotePayload);
      if (!fresh.ok) failWithByreal(format, fresh.error);
      quote = fresh.value;
      attempt++;
      continue;
    }
    failWithByreal(format, buildRes.error);
  }
}

// ============================================
// Preview shape builders
// ============================================

interface ZapInPreviewBuilderInput {
  flow: 'open' | 'increase';
  quote: AutoSwapZapInQuoteResponse;
  inputMint: string;
  inputSymbol: string;
  inputAmountRaw: string;
  inputDecimals: number;
  inputPriceUsd: number;
  meta: PoolMeta;
  slippageBps: number;
  extras: Record<string, unknown>;
}

export interface ZapInPreviewData {
  flow: 'open' | 'increase';
  inputMint: string;
  inputSymbol: string;
  inputAmount: string;
  inputAmountUsd: string;
  estimatedTokenA: string;
  estimatedTokenB: string;
  symbolA: string;
  symbolB: string;
  estimatedTokenAUsd: string;
  estimatedTokenBUsd: string;
  totalUsd: string;
  swapProvider: string;
  swapInAmount: string;
  swapOutAmount: string;
  swapMinOutAmount: string;
  priceImpactPct: string;
  priceImpactBps: number;
  impactLevel: 'ok' | 'warning' | 'blocked';
  slippageBps: number;
  quoteExpireAtMs?: number;
  extras: Record<string, unknown>;
}

function buildZapInPreview(p: ZapInPreviewBuilderInput): ZapInPreviewData {
  const inputAmountUi = rawToUi(p.inputAmountRaw, p.inputDecimals);
  const swapQuote = p.quote.quote ?? null;
  const preview = p.quote.preview ?? null;
  const estA = preview?.estimatedToken0Amount ?? '0';
  const estB = preview?.estimatedToken1Amount ?? '0';
  const estAUi = rawToUi(estA, p.meta.decimalsA);
  const estBUi = rawToUi(estB, p.meta.decimalsB);
  const estAUsd = parseFloat(estAUi) * p.meta.priceA;
  const estBUsd = parseFloat(estBUi) * p.meta.priceB;

  return {
    flow: p.flow,
    inputMint: p.inputMint,
    inputSymbol: p.inputSymbol,
    inputAmount: inputAmountUi,
    inputAmountUsd: formatUsd(parseFloat(inputAmountUi) * p.inputPriceUsd),
    estimatedTokenA: estAUi,
    estimatedTokenB: estBUi,
    symbolA: p.meta.symbolA,
    symbolB: p.meta.symbolB,
    estimatedTokenAUsd: formatUsd(estAUsd),
    estimatedTokenBUsd: formatUsd(estBUsd),
    totalUsd: formatUsd(estAUsd + estBUsd),
    swapProvider: swapQuote?.provider ?? p.quote.provider ?? 'unknown',
    swapInAmount: swapQuote?.swapInAmount ?? '0',
    swapOutAmount: swapQuote?.expectedSwapOutAmount ?? '0',
    swapMinOutAmount: swapQuote?.minSwapOutAmount ?? '0',
    priceImpactPct: swapQuote?.priceImpactPct ?? '0',
    priceImpactBps: swapQuote?.priceImpactBps ?? 0,
    impactLevel: swapQuote?.impactLevel ?? 'ok',
    slippageBps: p.slippageBps,
    quoteExpireAtMs: p.quote.quoteExpireAtMs,
    extras: p.extras,
  };
}

interface ZapOutPreviewBuilderInput {
  quote: AutoSwapZapOutQuoteResponse;
  outputMint: string;
  outputSymbol: string;
  outputDecimals: number;
  meta: PoolMeta;
  slippageBps: number;
  extras: Record<string, unknown>;
}

export interface ZapOutPreviewData {
  outputMint: string;
  outputSymbol: string;
  withdrawTokenA: string;
  withdrawTokenB: string;
  symbolA: string;
  symbolB: string;
  receiveOutputAmount: string;
  swapProvider?: string;
  swapInAmount?: string;
  swapOutAmount?: string;
  swapMinOutAmount?: string;
  priceImpactPct?: string;
  priceImpactBps?: number;
  impactLevel?: 'ok' | 'warning' | 'blocked';
  slippageBps: number;
  quoteExpireAtMs?: number;
  extras: Record<string, unknown>;
}

function buildZapOutPreview(p: ZapOutPreviewBuilderInput): ZapOutPreviewData {
  const preview = p.quote.preview ?? null;
  const swapQuote = preview?.swapQuote ?? null;
  return {
    outputMint: p.outputMint,
    outputSymbol: p.outputSymbol,
    withdrawTokenA: rawToUi(preview?.estimatedWithdrawToken0Amount ?? '0', p.meta.decimalsA),
    withdrawTokenB: rawToUi(preview?.estimatedWithdrawToken1Amount ?? '0', p.meta.decimalsB),
    symbolA: p.meta.symbolA,
    symbolB: p.meta.symbolB,
    receiveOutputAmount: rawToUi(preview?.estimatedReceiveOutputAmount ?? '0', p.outputDecimals),
    swapProvider: swapQuote?.provider ?? p.quote.provider,
    swapInAmount: swapQuote?.swapInAmount,
    swapOutAmount: swapQuote?.expectedSwapOutAmount,
    swapMinOutAmount: swapQuote?.minSwapOutAmount,
    priceImpactPct: swapQuote?.priceImpactPct,
    priceImpactBps: swapQuote?.priceImpactBps,
    impactLevel: swapQuote?.impactLevel,
    slippageBps: p.slippageBps,
    quoteExpireAtMs: p.quote.quoteExpireAtMs,
    extras: p.extras,
  };
}

export function getDefaultSlippageBps(override: string | undefined): number {
  if (override) return parseInt(override, 10);
  return getSlippageBps();
}
