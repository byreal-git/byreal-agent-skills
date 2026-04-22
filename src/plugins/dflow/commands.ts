/**
 * DFlow CLI commands — swap
 */

import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { PublicKey } from '@solana/web3.js';
import type { GlobalOptions } from '../../core/types.js';
import { uiToRaw, rawToUi } from '../../core/amounts.js';
import { getSlippageBps } from '../../core/solana.js';
import { resolveDecimals } from '../../core/token-registry.js';
import { resolveExecutionMode, printDryRunBanner } from '../../core/confirm.js';
import { missingWalletAddressError } from '../../core/errors.js';
import { outputJson, outputErrorJson, outputErrorTable } from '../../cli/output/formatters.js';
import { TABLE_CHARS } from '../../core/constants.js';
import * as dflowApi from './api.js';

function fallbackHint(route: dflowApi.DFlowRoute | null): string | null {
  if (route === 'direct-paid') return 'byreal proxy unreachable — using quote-api.dflow.net with DFLOW_API_KEY';
  if (route === 'direct-free') return 'byreal proxy unreachable — using dev-quote-api.dflow.net (no key, rate-limited)';
  return null;
}

// ============================================
// dflow swap
// ============================================

export function createDFlowSwapCommand(): Command {
  return new Command('swap')
    .description('Swap tokens via DFlow order-flow aggregator')
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
        // Resolve raw amount (DFlow only supports ExactIn)
        const inputDecimals = await resolveDecimals(options.inputMint);
        const rawAmount = options.raw ? options.amount : uiToRaw(options.amount, inputDecimals);

        const slippageBps = options.slippage ? parseInt(options.slippage, 10) : getSlippageBps();

        // Get quote
        const quoteResult = await dflowApi.getSwapQuote({
          inputMint: options.inputMint,
          outputMint: options.outputMint,
          amount: rawAmount,
          slippageBps,
          userPublicKey: walletAddress,
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
          if (format === 'json') {
            outputJson({
              mode: 'dry-run',
              source: 'dflow',
              inputMint: quote.inputMint,
              outputMint: quote.outputMint,
              inAmount: quote.inAmount,
              outAmount: quote.outAmount,
              uiInAmount,
              uiOutAmount,
              priceImpactPct: quote.priceImpactPct,
              slippageBps,
            }, startTime);
          } else {
            const table = new Table({ chars: TABLE_CHARS });
            table.push(
              [chalk.gray('Source'), 'DFlow'],
              [chalk.gray('Input'), `${uiInAmount} (${options.inputMint})`],
              [chalk.gray('Output'), `${uiOutAmount} (${options.outputMint})`],
              [chalk.gray('Slippage'), `${slippageBps} bps`],
            );

            if (quote.priceImpactPct) {
              const impact = parseFloat(quote.priceImpactPct);
              const color = impact > 1 ? chalk.red : impact > 0.5 ? chalk.yellow : chalk.green;
              table.push([chalk.gray('Price Impact'), color(`${impact.toFixed(4)}%`)]);
            }

            console.log(chalk.cyan.bold('\n  DFlow Swap Preview\n'));
            console.log(table.toString());
            const hint = fallbackHint(dflowApi.getLastRoute());
            if (hint) console.error(chalk.gray(`[byreal] ${hint}`));
            console.log(chalk.yellow('\n  Remove --dry-run to generate the unsigned transaction'));
          }
          return;
        }

        // Execute: output unsigned transaction
        console.log(JSON.stringify({ unsignedTransactions: [quote.transaction] }));
      } catch (e) {
        const message = (e as Error).message || 'DFlow swap failed';
        format === 'json'
          ? outputErrorJson({ code: 'API_ERROR', type: 'NETWORK', message, retryable: true })
          : console.error(chalk.red(`\nError: ${message}`));
        process.exit(1);
      }
    });
}
