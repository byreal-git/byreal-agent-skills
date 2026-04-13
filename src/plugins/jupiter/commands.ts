/**
 * Jupiter CLI commands — swap, price
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
import { missingWalletAddressError } from '../../core/errors.js';
import { outputJson, outputErrorJson, outputErrorTable } from '../../cli/output/formatters.js';
import { TABLE_CHARS } from '../../core/constants.js';
import * as jupiterApi from './api.js';

// ============================================
// jup swap
// ============================================

export function createJupSwapCommand(): Command {
  return new Command('swap')
    .description('Swap tokens via Jupiter aggregator')
    .requiredOption('--input-mint <address>', 'Input token mint address')
    .requiredOption('--output-mint <address>', 'Output token mint address')
    .requiredOption('--amount <amount>', 'Amount to swap (UI amount, decimals auto-resolved)')
    .option('--slippage <bps>', 'Slippage tolerance in basis points')
    .option('--raw', 'Amount is already in raw (smallest unit) format')
    .option('--dry-run', 'Preview the swap without generating a transaction')
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

      try {
        // Resolve raw amount
        const inputDecimals = await resolveDecimals(options.inputMint);
        const rawAmount = options.raw ? options.amount : uiToRaw(options.amount, inputDecimals);

        const slippageBps = options.slippage ? parseInt(options.slippage, 10) : getSlippageBps();

        // Get quote
        const quoteResult = await jupiterApi.getQuote({
          inputMint: options.inputMint,
          outputMint: options.outputMint,
          amount: rawAmount,
          slippageBps,
        });

        if (!quoteResult.ok) {
          format === 'json' ? outputErrorJson(quoteResult.error) : outputErrorTable(quoteResult.error);
          process.exit(1);
        }

        const quote = quoteResult.value;
        const outputDecimals = await resolveDecimals(options.outputMint);
        const uiInAmount = rawToUi(quote.inAmount, inputDecimals);
        const uiOutAmount = rawToUi(quote.outAmount, outputDecimals);

        if (mode === 'dry-run') {
          printDryRunBanner();
          const routes = quote.routePlan.map(r => r.swapInfo.label).join(' → ');
          if (format === 'json') {
            outputJson({
              mode: 'dry-run',
              inputMint: quote.inputMint,
              outputMint: quote.outputMint,
              inAmount: quote.inAmount,
              outAmount: quote.outAmount,
              uiInAmount,
              uiOutAmount,
              priceImpactPct: quote.priceImpactPct,
              slippageBps: quote.slippageBps,
              route: routes,
            }, startTime);
          } else {
            const table = new Table({ chars: TABLE_CHARS });
            table.push(
              [chalk.gray('Input'), `${uiInAmount} (${options.inputMint})`],
              [chalk.gray('Output'), `${uiOutAmount} (${options.outputMint})`],
              [chalk.gray('Price Impact'), `${quote.priceImpactPct}%`],
              [chalk.gray('Slippage'), `${quote.slippageBps} bps`],
              [chalk.gray('Route'), routes],
            );
            console.log(chalk.cyan.bold('\n  Jupiter Swap Preview\n'));
            console.log(table.toString());
            console.log(chalk.yellow('\n  Remove --dry-run to generate the unsigned transaction'));
          }
          return;
        }

        // Execute: get swap transaction
        const swapResult = await jupiterApi.getSwapTransaction({
          quoteResponse: quote,
          userPublicKey: walletAddress,
          priorityFeeMicroLamports: getPriorityFeeMicroLamports(),
        });

        if (!swapResult.ok) {
          format === 'json' ? outputErrorJson(swapResult.error) : outputErrorTable(swapResult.error);
          process.exit(1);
        }

        // Output unsigned transaction (base64 passthrough from Jupiter)
        console.log(JSON.stringify({ unsignedTransactions: [swapResult.value.swapTransaction] }));
      } catch (e) {
        const message = (e as Error).message || 'Jupiter swap failed';
        format === 'json'
          ? outputErrorJson({ code: 'API_ERROR', type: 'NETWORK', message, retryable: true })
          : console.error(chalk.red(`\nError: ${message}`));
        process.exit(1);
      }
    });
}

// ============================================
// jup price
// ============================================

export function createJupPriceCommand(): Command {
  return new Command('price')
    .description('Get token price from Jupiter')
    .requiredOption('--mint <addresses>', 'Token mint address(es), comma-separated')
    .action(async (options, cmdObj: Command) => {
      const globalOptions = cmdObj.optsWithGlobals() as GlobalOptions;
      const format = globalOptions.output;
      const startTime = Date.now();

      const mints = (options.mint as string).split(',').map((m: string) => m.trim());

      const result = await jupiterApi.getPrice(mints);
      if (!result.ok) {
        format === 'json' ? outputErrorJson(result.error) : outputErrorTable(result.error);
        process.exit(1);
      }

      const prices = result.value;
      if (format === 'json') {
        outputJson({ prices }, startTime);
      } else {
        const table = new Table({
          head: [chalk.cyan.bold('Mint'), chalk.cyan.bold('Price (USD)'), chalk.cyan.bold('24h Change')],
          chars: TABLE_CHARS,
        });
        for (const mint of mints) {
          const p = prices[mint];
          if (p) {
            const change = p.priceChange24h != null ? `${p.priceChange24h > 0 ? '+' : ''}${p.priceChange24h.toFixed(2)}%` : '-';
            table.push([mint, `$${p.usdPrice}`, change]);
          } else {
            table.push([mint, chalk.gray('N/A'), '-']);
          }
        }
        console.log(chalk.cyan.bold('\n  Jupiter Price\n'));
        console.log(table.toString());
      }
    });
}
