/**
 * Aggregator commands — multi-aggregator routing for token swaps.
 *
 * Fans out quote requests to Jupiter / Titan / DFlow in parallel, picks the
 * route with the highest output amount (after a price-impact gate), and emits
 * the unsigned transaction for the chosen aggregator. Replaces the external
 * `byreal-aggregator-swap` skill's `route.ts` shell wrapper — same behavior,
 * but in-process so we avoid 4 child process spawns and reuse RPC / decimals /
 * fee-config caches.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { PublicKey } from '@solana/web3.js';
import type { GlobalOptions } from '../../core/types.js';
import { uiToRaw, rawToUi } from '../../core/amounts.js';
import { getSlippageBps, getPriorityFeeMicroLamports } from '../../core/solana.js';
import { resolveDecimals } from '../../core/token-registry.js';
import { resolveExecutionMode, printDryRunBanner } from '../../core/confirm.js';
import { missingWalletAddressError, networkError, type ByrealError } from '../../core/errors.js';
import {
  outputJson,
  outputErrorJson,
  outputErrorTable,
} from '../output/formatters.js';
import { TABLE_CHARS } from '../../core/constants.js';
import * as jupiterApi from '../../plugins/jupiter/api.js';
import * as titanApi from '../../plugins/titan/api.js';
import * as dflowApi from '../../plugins/dflow/api.js';

const AGGREGATORS = ['jup', 'titan', 'dflow'] as const;
type Aggregator = (typeof AGGREGATORS)[number];

interface QuoteResult {
  outAmountRaw: string;       // raw units, comparable across aggregators (same output mint)
  uiOutAmount: string;
  inAmountRaw: string;
  uiInAmount: string;
  priceImpactPct: number | null; // null = aggregator does not surface this (Titan)
  getTransaction: () => Promise<string>;  // lazy: only chosen aggregator is materialized
}

interface QuoteOk {
  agg: Aggregator;
  ok: true;
  quote: QuoteResult;
  quotedAtMs: number;
}

interface QuoteSkipped {
  agg: Aggregator;
  ok: false;
  reason: string;
}

type QuoteOutcome = QuoteOk | QuoteSkipped;

// ============================================
// Per-aggregator quote adapters (normalize 3 plugin shapes into one)
// ============================================

async function quoteJup(params: {
  inputMint: string;
  outputMint: string;
  rawAmount: string;
  slippageBps: number;
  walletAddress: string;
  inputDecimals: number;
  outputDecimals: number;
}): Promise<QuoteResult | { error: ByrealError }> {
  const r = await jupiterApi.getQuote({
    inputMint: params.inputMint,
    outputMint: params.outputMint,
    amount: params.rawAmount,
    slippageBps: params.slippageBps,
  });
  if (!r.ok) return { error: r.error };
  const quote = r.value;
  const impact = parseFloat(quote.priceImpactPct);
  return {
    outAmountRaw: quote.outAmount,
    uiOutAmount: rawToUi(quote.outAmount, params.outputDecimals),
    inAmountRaw: quote.inAmount,
    uiInAmount: rawToUi(quote.inAmount, params.inputDecimals),
    priceImpactPct: Number.isFinite(impact) ? impact : null,
    getTransaction: async () => {
      const swap = await jupiterApi.getSwapTransaction({
        quoteResponse: quote,
        userPublicKey: params.walletAddress,
        priorityFeeMicroLamports: getPriorityFeeMicroLamports(),
      });
      if (!swap.ok) throw new Error(swap.error.message);
      return swap.value.swapTransaction;
    },
  };
}

async function quoteTitan(params: {
  inputMint: string;
  outputMint: string;
  rawAmount: string;
  slippageBps: number;
  walletAddress: string;
  inputDecimals: number;
  outputDecimals: number;
}): Promise<QuoteResult | { error: ByrealError }> {
  // Titan builds the unsigned tx as part of getSwapQuote — we hold it and
  // only return it from getTransaction() for the chosen aggregator.
  const r = await titanApi.getSwapQuote({
    inputMint: params.inputMint,
    outputMint: params.outputMint,
    amount: params.rawAmount,
    swapMode: 'ExactIn',
    slippageBps: params.slippageBps,
    userPublicKey: params.walletAddress,
  });
  if (!r.ok) return { error: r.error };
  const quote = r.value;
  return {
    outAmountRaw: quote.outAmount,
    uiOutAmount: rawToUi(quote.outAmount, params.outputDecimals),
    inAmountRaw: quote.inAmount,
    uiInAmount: rawToUi(quote.inAmount, params.inputDecimals),
    // Titan's RFQ schema does not surface price impact; treat as unknown
    // and exempt from the price-impact gate (consistent with the external
    // skill's behavior).
    priceImpactPct: null,
    getTransaction: async () => quote.transaction,
  };
}

async function quoteDFlow(params: {
  inputMint: string;
  outputMint: string;
  rawAmount: string;
  slippageBps: number;
  walletAddress: string;
  inputDecimals: number;
  outputDecimals: number;
}): Promise<QuoteResult | { error: ByrealError }> {
  const r = await dflowApi.getSwapQuote({
    inputMint: params.inputMint,
    outputMint: params.outputMint,
    amount: params.rawAmount,
    slippageBps: params.slippageBps,
    userPublicKey: params.walletAddress,
  });
  if (!r.ok) return { error: r.error };
  const quote = r.value;
  const impact = quote.priceImpactPct != null ? parseFloat(quote.priceImpactPct) : NaN;
  return {
    outAmountRaw: quote.outAmount,
    uiOutAmount: rawToUi(quote.outAmount, params.outputDecimals),
    inAmountRaw: quote.inAmount,
    uiInAmount: rawToUi(quote.inAmount, params.inputDecimals),
    priceImpactPct: Number.isFinite(impact) ? impact : null,
    getTransaction: async () => quote.transaction,
  };
}

const QUOTERS: Record<Aggregator, typeof quoteJup> = {
  jup: quoteJup,
  titan: quoteTitan,
  dflow: quoteDFlow,
};

// ============================================
// Comparison core
// ============================================

async function quoteOne(
  agg: Aggregator,
  params: Parameters<typeof quoteJup>[0],
  timeoutMs: number,
): Promise<QuoteOutcome> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ error: ByrealError }>((resolve) => {
    timeoutId = setTimeout(() => {
      resolve({ error: networkError(`timeout ${timeoutMs}ms`) });
    }, timeoutMs);
  });
  try {
    const result = await Promise.race([QUOTERS[agg](params), timeout]);
    if ('error' in result) return { agg, ok: false, reason: result.error.message };
    return { agg, ok: true, quote: result, quotedAtMs: Date.now() };
  } catch (e) {
    return { agg, ok: false, reason: (e as Error).message };
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

interface Survivor {
  agg: Aggregator;
  quote: QuoteResult;
  quotedAtMs: number;
  outAmountBig: bigint;
}

interface Considered {
  aggregator: Aggregator;
  outAmount: string;
  uiOutAmount: string;
  priceImpactPct: number | null;
}

interface Skipped {
  aggregator: Aggregator;
  reason: string;
}

function partitionQuotes(
  outcomes: QuoteOutcome[],
  maxPriceImpactPct: number,
): { survivors: Survivor[]; considered: Considered[]; skipped: Skipped[] } {
  const survivors: Survivor[] = [];
  const considered: Considered[] = [];
  const skipped: Skipped[] = [];

  for (const r of outcomes) {
    if (!r.ok) {
      skipped.push({ aggregator: r.agg, reason: r.reason });
      continue;
    }
    const impact = r.quote.priceImpactPct;
    // Only reject when we have a numeric impact AND it exceeds the cap.
    // Titan's null impact bypasses the gate — same as the external skill.
    if (impact != null && impact > maxPriceImpactPct) {
      skipped.push({
        aggregator: r.agg,
        reason: `price impact ${impact.toFixed(4)}% > max ${maxPriceImpactPct}%`,
      });
      continue;
    }
    let big: bigint;
    try {
      big = BigInt(r.quote.outAmountRaw);
    } catch {
      skipped.push({ aggregator: r.agg, reason: `outAmount not bigint-parseable: ${r.quote.outAmountRaw}` });
      continue;
    }
    survivors.push({ agg: r.agg, quote: r.quote, quotedAtMs: r.quotedAtMs, outAmountBig: big });
    considered.push({
      aggregator: r.agg,
      outAmount: r.quote.outAmountRaw,
      uiOutAmount: r.quote.uiOutAmount,
      priceImpactPct: impact,
    });
  }
  return { survivors, considered, skipped };
}

function pickWinner(survivors: Survivor[]): Survivor {
  // Tie-break by AGGREGATORS order (jup > titan > dflow); first kept on ties.
  let best = survivors[0];
  for (let i = 1; i < survivors.length; i++) {
    if (survivors[i].outAmountBig > best.outAmountBig) best = survivors[i];
  }
  return best;
}

function uiMinReceived(uiOutAmount: string, slippageBps: number): string {
  const n = parseFloat(uiOutAmount);
  if (!Number.isFinite(n)) return '0';
  const min = (n * (10000 - slippageBps)) / 10000;
  const decimals = uiOutAmount.split('.')[1]?.length ?? 6;
  return min.toFixed(Math.min(decimals, 9));
}

// ============================================
// Argument parsing
// ============================================

function parseIncludeList(raw: string | undefined): Aggregator[] | { error: string } {
  if (!raw) return [...AGGREGATORS];
  const seen = new Set<Aggregator>();
  for (const part of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    if (!(AGGREGATORS as readonly string[]).includes(part)) {
      return { error: `--include must contain only ${AGGREGATORS.join('|')}, got '${part}'` };
    }
    seen.add(part as Aggregator);
  }
  if (seen.size === 0) {
    return { error: `--include must contain at least one of ${AGGREGATORS.join('|')}` };
  }
  return [...seen];
}

// ============================================
// aggregator swap
// ============================================

export function createAggregatorSwapCommand(): Command {
  return new Command('swap')
    .description('Swap via best-of-three aggregator routing (Jupiter, Titan, DFlow)')
    .requiredOption('--input-mint <address>', 'Input token mint address')
    .requiredOption('--output-mint <address>', 'Output token mint address')
    .requiredOption('--amount <amount>', 'Amount to swap (UI amount, decimals auto-resolved)')
    .option('--slippage <bps>', 'Slippage tolerance in basis points')
    .option('--max-price-impact-pct <pct>', 'Hard-reject quotes with priceImpactPct above this', '1.0')
    .option('--prefer <aggregator>', `Skip comparison, use only this one (${AGGREGATORS.join('|')})`)
    .option('--include <list>', `Comma-separated aggregators to query (default: ${AGGREGATORS.join(',')})`)
    .option('--quote-timeout-ms <ms>', 'Per-aggregator quote timeout in ms', '8000')
    .option('--raw', 'Amount is already in raw (smallest unit) format')
    .option('--dry-run', 'Compare quotes only; do not generate the unsigned transaction')
    .action(async (options, cmdObj: Command) => {
      const globalOptions = cmdObj.optsWithGlobals() as GlobalOptions;
      const format = globalOptions.output;
      const startTime = Date.now();
      const mode = resolveExecutionMode(options);

      const walletAddress = globalOptions.walletAddress;
      if (!walletAddress) {
        const e = missingWalletAddressError();
        format === 'json' ? outputErrorJson(e.toJSON()) : outputErrorTable(e.toJSON());
        process.exit(1);
      }
      try {
        new PublicKey(walletAddress);
      } catch {
        const msg = `Invalid wallet address: ${walletAddress}`;
        format === 'json'
          ? outputErrorJson({ code: 'INVALID_PARAMETER', type: 'VALIDATION', message: msg, retryable: false })
          : console.error(chalk.red(`\nError: ${msg}`));
        process.exit(1);
      }

      // Validate --max-price-impact-pct
      const maxPriceImpactPct = parseFloat(options.maxPriceImpactPct);
      if (!Number.isFinite(maxPriceImpactPct) || maxPriceImpactPct <= 0 || maxPriceImpactPct > 50) {
        const msg = '--max-price-impact-pct must be a number between 0 (exclusive) and 50';
        format === 'json'
          ? outputErrorJson({ code: 'INVALID_PARAMETER', type: 'VALIDATION', message: msg, retryable: false })
          : console.error(chalk.red(`\nError: ${msg}`));
        process.exit(1);
      }

      // Validate --quote-timeout-ms
      const quoteTimeoutMs = parseInt(options.quoteTimeoutMs, 10);
      if (!Number.isFinite(quoteTimeoutMs) || quoteTimeoutMs < 500) {
        const msg = '--quote-timeout-ms must be a number >= 500';
        format === 'json'
          ? outputErrorJson({ code: 'INVALID_PARAMETER', type: 'VALIDATION', message: msg, retryable: false })
          : console.error(chalk.red(`\nError: ${msg}`));
        process.exit(1);
      }

      // Validate --prefer
      let prefer: Aggregator | undefined;
      if (options.prefer) {
        if (!(AGGREGATORS as readonly string[]).includes(options.prefer)) {
          const msg = `--prefer must be one of: ${AGGREGATORS.join(', ')}`;
          format === 'json'
            ? outputErrorJson({ code: 'INVALID_PARAMETER', type: 'VALIDATION', message: msg, retryable: false })
            : console.error(chalk.red(`\nError: ${msg}`));
          process.exit(1);
        }
        prefer = options.prefer as Aggregator;
      }

      // Validate / resolve --include
      const includeRaw = parseIncludeList(options.include);
      if ('error' in includeRaw) {
        format === 'json'
          ? outputErrorJson({ code: 'INVALID_PARAMETER', type: 'VALIDATION', message: includeRaw.error, retryable: false })
          : console.error(chalk.red(`\nError: ${includeRaw.error}`));
        process.exit(1);
      }
      const includeList = includeRaw;

      // --prefer must be a member of --include (if both set)
      if (prefer && !includeList.includes(prefer)) {
        const msg = `--prefer ${prefer} is not in --include list (${includeList.join(',')})`;
        format === 'json'
          ? outputErrorJson({ code: 'INVALID_PARAMETER', type: 'VALIDATION', message: msg, retryable: false })
          : console.error(chalk.red(`\nError: ${msg}`));
        process.exit(1);
      }

      const targets: Aggregator[] = prefer ? [prefer] : includeList;
      const slippageBps = options.slippage ? parseInt(options.slippage, 10) : getSlippageBps();

      try {
        // Resolve decimals once, share across all quote adapters
        const inputDecimals = await resolveDecimals(options.inputMint);
        const outputDecimals = await resolveDecimals(options.outputMint);
        const rawAmount = options.raw ? options.amount : uiToRaw(options.amount, inputDecimals);

        const quoteParams = {
          inputMint: options.inputMint,
          outputMint: options.outputMint,
          rawAmount,
          slippageBps,
          walletAddress,
          inputDecimals,
          outputDecimals,
        };

        const outcomes = await Promise.all(
          targets.map((agg) => quoteOne(agg, quoteParams, quoteTimeoutMs)),
        );
        const { survivors, considered, skipped } = partitionQuotes(outcomes, maxPriceImpactPct);

        if (survivors.length === 0) {
          const errCode = prefer ? 'PREFER_FAILED' : 'NO_ROUTE';
          const message = prefer
            ? `--prefer ${prefer} did not return a usable route`
            : 'No aggregator returned a usable route';
          if (format === 'json') {
            outputErrorJson({
              code: errCode,
              type: 'NETWORK',
              message,
              retryable: true,
              details: { skipped },
            });
          } else {
            console.error(chalk.red(`\nError: ${message}`));
            for (const s of skipped) {
              console.error(chalk.gray(`  • ${s.aggregator}: ${s.reason}`));
            }
          }
          process.exit(1);
        }

        const winner = pickWinner(survivors);
        const minReceived = uiMinReceived(winner.quote.uiOutAmount, slippageBps);

        // Sort considered by uiOutAmount desc for nicer presentation
        considered.sort((a, b) => parseFloat(b.uiOutAmount) - parseFloat(a.uiOutAmount));

        const summary = {
          chosen: winner.agg,
          inputMint: options.inputMint,
          outputMint: options.outputMint,
          uiInAmount: winner.quote.uiInAmount,
          inAmount: winner.quote.inAmountRaw,
          uiOutAmount: winner.quote.uiOutAmount,
          outAmount: winner.quote.outAmountRaw,
          minReceived,
          priceImpactPct: winner.quote.priceImpactPct,
          slippageBps,
          quoteAgeMs: Date.now() - winner.quotedAtMs,
          considered,
          skipped,
        };

        // ---- Dry-run: stop after comparison
        if (mode === 'dry-run') {
          printDryRunBanner();
          if (format === 'json') {
            outputJson({ mode: 'dry-run', ...summary }, startTime);
          } else {
            renderTable(summary);
            console.log(chalk.yellow('\n  Remove --dry-run to generate the unsigned transaction'));
          }
          return;
        }

        // ---- Execute: materialize the chosen aggregator's tx
        let unsignedTx: string;
        try {
          unsignedTx = await winner.quote.getTransaction();
        } catch (e) {
          const reason = `execute failed: ${(e as Error).message}`;
          // Surface via the same skipped[] structure so the caller sees what happened
          const skippedAfterExec: Skipped[] = [...skipped, { aggregator: winner.agg, reason }];
          if (format === 'json') {
            outputErrorJson({
              code: 'NO_ROUTE',
              type: 'NETWORK',
              message: `Chosen aggregator ${winner.agg} failed during execute`,
              retryable: true,
              details: { skipped: skippedAfterExec },
            });
          } else {
            console.error(chalk.red(`\nError: ${winner.agg} failed during execute: ${(e as Error).message}`));
          }
          process.exit(1);
        }

        // Top-level `unsignedTransactions` matches the shape the existing
        // `swap execute` / `jup swap` / `titan swap` / `dflow swap` commands
        // emit, so playground/sign-and-send.ts and any pipe-based tooling
        // works without changes.
        if (format === 'json') {
          // Mirror the structure of other write commands (they emit a bare
          // `{ unsignedTransactions: [...] }` object on stdout, no envelope).
          // Include the comparison summary alongside so callers don't need a
          // second invocation just to know which route was picked.
          console.log(JSON.stringify({ unsignedTransactions: [unsignedTx], ...summary }));
        } else {
          renderTable(summary);
          console.log(chalk.gray('\n  Unsigned transaction:'));
          console.log(unsignedTx);
        }
      } catch (e) {
        const message = (e as Error).message || 'aggregator swap failed';
        format === 'json'
          ? outputErrorJson({ code: 'API_ERROR', type: 'NETWORK', message, retryable: true })
          : console.error(chalk.red(`\nError: ${message}`));
        process.exit(1);
      }
    });
}

// ============================================
// Table rendering
// ============================================

function renderTable(summary: {
  chosen: Aggregator;
  uiInAmount: string;
  uiOutAmount: string;
  inputMint: string;
  outputMint: string;
  minReceived: string;
  priceImpactPct: number | null;
  slippageBps: number;
  quoteAgeMs: number;
  considered: Considered[];
  skipped: Skipped[];
}): void {
  const t = new Table({ chars: TABLE_CHARS });
  t.push(
    [chalk.gray('Chosen'), chalk.green.bold(summary.chosen.toUpperCase())],
    [chalk.gray('Input'), `${summary.uiInAmount} (${summary.inputMint})`],
    [chalk.gray('Output'), `${summary.uiOutAmount} (${summary.outputMint})`],
    [chalk.gray('Min Received'), `${summary.minReceived} (after slippage)`],
    [
      chalk.gray('Price Impact'),
      summary.priceImpactPct == null
        ? chalk.gray('n/a')
        : (() => {
            const v = summary.priceImpactPct;
            const c = v > 1 ? chalk.red : v > 0.5 ? chalk.yellow : chalk.green;
            return c(`${v.toFixed(4)}%`);
          })(),
    ],
    [chalk.gray('Slippage'), `${summary.slippageBps} bps`],
    [chalk.gray('Quote Age'), `${summary.quoteAgeMs} ms`],
  );
  console.log(chalk.cyan.bold('\n  Aggregator Swap Preview\n'));
  console.log(t.toString());

  if (summary.considered.length > 0) {
    const c = new Table({
      head: [chalk.cyan('Aggregator'), chalk.cyan('Out Amount'), chalk.cyan('Price Impact')],
      chars: TABLE_CHARS,
    });
    for (const row of summary.considered) {
      const isWinner = row.aggregator === summary.chosen;
      const name = isWinner ? chalk.green.bold(`${row.aggregator} ★`) : chalk.white(row.aggregator);
      const impact = row.priceImpactPct == null ? chalk.gray('n/a') : `${row.priceImpactPct.toFixed(4)}%`;
      c.push([name, row.uiOutAmount, impact]);
    }
    console.log(chalk.cyan.bold('\n  Considered\n'));
    console.log(c.toString());
  }

  if (summary.skipped.length > 0) {
    const s = new Table({
      head: [chalk.cyan('Aggregator'), chalk.cyan('Reason')],
      chars: TABLE_CHARS,
    });
    for (const row of summary.skipped) {
      s.push([chalk.gray(row.aggregator), chalk.gray(row.reason)]);
    }
    console.log(chalk.cyan.bold('\n  Skipped\n'));
    console.log(s.toString());
  }
}

// ============================================
// aggregator (parent command)
// ============================================

export function createAggregatorCommand(): Command {
  const cmd = new Command('aggregator')
    .description('Multi-aggregator routing — best-of-three quote + swap (Jupiter, Titan, DFlow)');
  cmd.addCommand(createAggregatorSwapCommand());
  return cmd;
}
