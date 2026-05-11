/**
 * Auto Swap (Zap) helpers for positions commands — openclaw branch.
 *
 * Each runZap* function implements the full lifecycle for one of the four
 * supported flows when the user passes `--auto-swap`:
 *   - runZapInOpen          → positions open --auto-swap
 *   - runZapInIncrease      → positions increase --auto-swap
 *   - runZapOut (close)     → positions close    --auto-swap
 *   - runZapOut (partial)   → positions decrease --auto-swap
 *
 * Lifecycle: validate → quote → preview/dry-run → build-tx (with 41319 retry)
 * → co-sign with positionNftMint locally when needed (zap-in open only)
 * → privyBroadcastOne (sign + broadcast via Privy proxy).
 *
 * --auto-swap is only supported in --dry-run (preview) or --execute (sign+
 * broadcast). The default unsigned-tx mode is rejected fail-fast at the CLI
 * layer (positions.ts) and defensively here in the engine, because Auto Swap
 * binds quotes to backend-issued signers and cannot survive being handed to
 * an external signer chain.
 *
 * Backend contract: see apps/web/src/features/zap/api.ts.
 */
import chalk from 'chalk';
import BN from 'bn.js';
import { Keypair, PublicKey } from '@solana/web3.js';
import type { VersionedTransaction } from '@solana/web3.js';

import { api } from '../../api/endpoints.js';
import { rawToUi, uiToRaw } from '../../core/amounts.js';
import { getSlippageBps } from '../../core/solana.js';
import {
  deserializeTransaction,
  serializeTransaction,
} from '../../core/transaction.js';
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
  printPrivySignBanner,
  type ExecutionMode,
} from '../../core/confirm.js';
import {
  privyBroadcastOne,
  requirePrivyContext,
  type PrivyContext,
} from '../../privy/index.js';
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

export type OutputFormat = 'json' | 'table' | 'csv';

export interface ZapContext {
  format: OutputFormat;
  mode: ExecutionMode;
  walletAddress: string;          // base58 (from --wallet-address global)
  publicKey: PublicKey;           // PublicKey of walletAddress
  startTime: number;
  /** Optional Privy context; auto-resolved in execute mode if absent. */
  privyCtx?: PrivyContext;
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
        `    → Swap to get ${w.symbol}: byreal-cli swap execute --output-mint ${w.mint} --input-mint <source-token-mint> --amount <amount> --execute`,
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

/** Partial-sign a base64 tx with a local keypair (used by zap-in open for the ephemeral NFT mint). */
function partialSignWithKeypair(base64Tx: string, signer: Keypair, format: OutputFormat): string {
  const txResult = deserializeTransaction(base64Tx);
  if (!txResult.ok) failWithByreal(format, txResult.error);
  const tx: VersionedTransaction = txResult.value;
  // VersionedTransaction.sign mutates the signatures array, filling our signer's slot
  // while preserving any other slots (e.g. the user slot that Privy will fill next).
  tx.sign([signer]);
  return serializeTransaction(tx);
}

/**
 * Sign + broadcast a base64 zap tx via Privy proxy.
 *
 * @param extraSigner Optional ephemeral keypair to pre-sign with (zap-in open only).
 *                    The Privy proxy must preserve this signature when adding the
 *                    user's own (standard Solana partial-sign semantics).
 */
async function signAndSendZapTx(
  base64Tx: string,
  privyCtx: PrivyContext,
  extraSigner: Keypair | undefined,
  format: OutputFormat,
): Promise<{ signature: string; confirmed: boolean }> {
  const payload = extraSigner ? partialSignWithKeypair(base64Tx, extraSigner, format) : base64Tx;
  printPrivySignBanner();
  const broadcast = await privyBroadcastOne(privyCtx, payload);
  if (!broadcast.ok) failWithByreal(format, broadcast.error);
  // openclaw's Privy proxy returns the on-chain tx hash but does not block on
  // confirmation; mirror existing positions commands and surface confirmed:false
  // unless/until a confirmation poll lands separately.
  return { signature: broadcast.value.signature, confirmed: false };
}

/** Defensive guard: never let auto-swap proceed in unsigned-tx mode. */
function ensureZapModeSupported(mode: ExecutionMode, format: OutputFormat): void {
  if (mode === 'dry-run' || mode === 'execute') return;
  failWith(format, {
    code: 'UNSUPPORTED_MODE',
    type: 'VALIDATION',
    message:
      '--auto-swap requires --execute (or --dry-run for preview). The default unsigned-tx mode is not supported because Auto Swap binds quotes to backend-issued signers and cannot survive being handed to an external signer chain.',
    retryable: false,
  });
}

// ============================================
// runZapInOpen — positions open --auto-swap
// ============================================

export interface RunZapInOpenInput {
  poolAddress: string;
  base: string;                  // --base (MintA | MintB | mint)
  amountUi: string;              // UI amount (e.g. "0.01") OR raw if isRaw=true
  isRaw: boolean;
  tickLower: number;
  tickUpper: number;
  priceLowerUi: string;
  priceUpperUi: string;
  slippageBps: number;
  ctx: ZapContext;
}

export async function runZapInOpen(input: RunZapInOpenInput): Promise<void> {
  const { ctx, poolAddress, base, amountUi, isRaw, tickLower, tickUpper, priceLowerUi, priceUpperUi, slippageBps } = input;
  const { format, mode, publicKey, walletAddress, startTime } = ctx;

  ensureZapModeSupported(mode, format);

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

  // Generate position NFT mint Keypair (used for co-signing build-tx output).
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
        console.log(chalk.yellow('  Add --execute to open this auto-swap position via Privy'));
      }
    }
    return;
  }

  // execute mode
  const privyCtx = ctx.privyCtx ?? requirePrivyContext(walletAddress);

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

  const sendValue = await signAndSendZapTx(buildResult.transaction, privyCtx, positionNftMint, format);

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
    console.log(chalk.green.bold('\n  Position Opened (Auto Swap)'));
    console.log(chalk.gray(`    NFT Address: ${positionNftMint.publicKey.toBase58()}`));
    if (buildResult.selectedProvider) {
      console.log(chalk.gray(`    Swap Provider: ${buildResult.selectedProvider}`));
    }
    outputTransactionResult(sendValue.signature);
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
  personalPosition: string;
  base: string;
  amountUi: string;
  isRaw: boolean;
  slippageBps: number;
  nftMint: string;
  ctx: ZapContext;
}

export async function runZapInIncrease(input: RunZapInIncreaseInput): Promise<void> {
  const { ctx, poolAddress, personalPosition, base, amountUi, isRaw, slippageBps, nftMint } = input;
  const { format, mode, publicKey, walletAddress, startTime } = ctx;

  ensureZapModeSupported(mode, format);

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
        console.log(chalk.yellow('  Add --execute to add liquidity (auto-swap) via Privy'));
      }
    }
    return;
  }

  // execute mode
  const privyCtx = ctx.privyCtx ?? requirePrivyContext(walletAddress);

  const buildResult = await buildIncreaseWithRetry(quotePayload, quote, format);

  if (!buildResult.transaction) {
    failWith(format, {
      code: 'NO_TRANSACTION',
      type: 'NETWORK',
      message: 'Backend did not return a transaction in build-tx response',
      retryable: true,
    });
  }

  const sendValue = await signAndSendZapTx(buildResult.transaction, privyCtx, undefined, format);

  const txData = {
    signature: sendValue.signature,
    confirmed: sendValue.confirmed,
    autoSwap: true,
    selectedProvider: buildResult.selectedProvider,
  };

  if (format === 'json') {
    outputJson(txData, startTime);
  } else {
    console.log(chalk.green.bold('\n  Liquidity Increased (Auto Swap)'));
    if (buildResult.selectedProvider) {
      console.log(chalk.gray(`    Swap Provider: ${buildResult.selectedProvider}`));
    }
    outputTransactionResult(sendValue.signature);
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
// runZapOut — positions decrease / close --auto-swap
// ============================================

export interface RunZapOutInput {
  poolAddress: string;
  personalPosition: string;
  outputMint: string;
  closePosition: boolean;
  liquidity?: string;        // raw liquidity to remove (omit when closing)
  slippageBps: number;
  nftMint: string;
  percentage?: number;       // preview / display only
  ctx: ZapContext;
}

export async function runZapOut(input: RunZapOutInput): Promise<void> {
  const { ctx, poolAddress, personalPosition, outputMint, closePosition, liquidity, slippageBps, nftMint, percentage } = input;
  const { format, mode, publicKey, walletAddress, startTime } = ctx;

  ensureZapModeSupported(mode, format);

  const meta = await fetchPoolMeta(poolAddress);
  if (!meta) {
    failWith(format, {
      code: 'POOL_NOT_FOUND',
      type: 'BUSINESS',
      message: `Pool not found: ${poolAddress}`,
      retryable: false,
    });
  }

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
      console.log(chalk.yellow(`\n  Add --execute to ${closePosition ? 'close position' : 'decrease liquidity'} (auto-swap) via Privy`));
    }
    return;
  }

  // execute mode
  const privyCtx = ctx.privyCtx ?? requirePrivyContext(walletAddress);

  // Best-effort incentive preclaim before close (mirrors frontend
  // useRemoveLiquidityZap → useBestEffortIncentivePreclaim semantics).
  let preclaim: import('./incentive-preclaim.js').IncentivePreclaimResult | undefined;
  if (closePosition && preclaimPreview?.willPreclaim) {
    const { runIncentivePreclaim } = await import('./incentive-preclaim.js');
    preclaim = await runIncentivePreclaim(
      publicKey.toBase58(),
      privyCtx,
      personalPosition,
      format !== 'json',
    );
    if (preclaim.status === 'claimed') {
      // Refresh the zap-out quote so the remaining liquidity reflects post-claim state.
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

  const sendValue = await signAndSendZapTx(buildResult.transaction, privyCtx, undefined, format);

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
    console.log(
      chalk.green.bold(`\n  ${closePosition ? 'Position Closed' : 'Liquidity Decreased'} (Auto Swap)`),
    );
    if (buildResult.selectedProvider) {
      console.log(chalk.gray(`    Swap Provider: ${buildResult.selectedProvider}`));
    }
    if (preclaim && preclaim.status === 'claimed') {
      console.log(chalk.cyan(`    Incentive Preclaim: claimed (${preclaim.unclaimedCount} reward(s))`));
    } else if (preclaim && preclaim.status === 'claim_failed') {
      console.log(chalk.yellow(`    Incentive Preclaim: failed — ${preclaim.errorMessage ?? 'unknown'}`));
    }
    outputTransactionResult(sendValue.signature);
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
