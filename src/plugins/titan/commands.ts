/**
 * Titan Exchange CLI commands — swap
 */

import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { PublicKey } from '@solana/web3.js';
import type { GlobalOptions } from '../../core/types.js';
import { uiToRaw, rawToUi } from '../../core/amounts.js';
import { getSlippageBps } from '../../core/solana.js';
import { resolveDecimals } from '../../core/token-registry.js';
import { printDryRunBanner, printPrivySignBanner } from '../../core/confirm.js';
import { ByrealError, missingWalletAddressError } from '../../core/errors.js';
import { requirePrivyContext, privyBroadcastOne } from '../../privy/index.js';
import {
  outputJson,
  outputErrorJson,
  outputErrorTable,
  outputTransactionResult,
  safeResolveExecutionMode,
} from '../../cli/output/formatters.js';
import { TABLE_CHARS } from '../../core/constants.js';
import * as titanApi from './api.js';

function fallbackHint(route: titanApi.TitanRoute | null): string | null {
  if (route === 'direct') return 'byreal proxy unreachable — using direct Titan Gateway with TITAN_AUTH_TOKEN';
  return null;
}

// ============================================
// titan swap
// ============================================

export function createTitanSwapCommand(): Command {
  return new Command('swap')
    .description('Swap tokens via Titan Exchange aggregator')
    .requiredOption('--input-mint <address>', 'Input token mint address')
    .requiredOption('--output-mint <address>', 'Output token mint address')
    .requiredOption('--amount <amount>', 'Amount to swap (UI amount, decimals auto-resolved)')
    .option('--swap-mode <mode>', 'Swap mode: ExactIn or ExactOut', 'ExactIn')
    .option('--slippage <bps>', 'Slippage tolerance in basis points')
    .option('--raw', 'Amount is already in raw (smallest unit) format')
    .option('--dry-run', 'Preview the swap without generating a transaction')
    .option('--execute', 'Sign + broadcast on-chain via Privy (default emits unsigned tx for back-compat)')
    .action(async (options, cmdObj: Command) => {
      const globalOptions = cmdObj.optsWithGlobals() as GlobalOptions;
      const format = globalOptions.output;
      const startTime = Date.now();
      const mode = safeResolveExecutionMode(options, format);

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
        const swapMode = options.swapMode as 'ExactIn' | 'ExactOut';
        const targetMint = swapMode === 'ExactIn' ? options.inputMint : options.outputMint;
        const targetDecimals = await resolveDecimals(targetMint);
        const rawAmount = options.raw ? options.amount : uiToRaw(options.amount, targetDecimals);

        const slippageBps = options.slippage ? parseInt(options.slippage, 10) : getSlippageBps();

        // Get quote
        const quoteResult = await titanApi.getSwapQuote({
          inputMint: options.inputMint,
          outputMint: options.outputMint,
          amount: rawAmount,
          swapMode,
          slippageBps,
          userPublicKey: walletAddress,
        });

        if (!quoteResult.ok) {
          format === 'json' ? outputErrorJson(quoteResult.error) : outputErrorTable(quoteResult.error);
          process.exit(1);
        }

        const quote = quoteResult.value;
        const inputDecimals = await resolveDecimals(options.inputMint);
        const outputDecimals = await resolveDecimals(options.outputMint);
        const uiInAmount = rawToUi(quote.inAmount, inputDecimals);
        const uiOutAmount = rawToUi(quote.outAmount, outputDecimals);

        if (mode === 'dry-run') {
          printDryRunBanner();
          if (format === 'json') {
            outputJson({
              mode: 'dry-run',
              source: 'titan',
              inputMint: quote.inputMint,
              outputMint: quote.outputMint,
              inAmount: quote.inAmount,
              outAmount: quote.outAmount,
              uiInAmount,
              uiOutAmount,
              swapMode,
              slippageBps,
            }, startTime);
          } else {
            const table = new Table({ chars: TABLE_CHARS });
            table.push(
              [chalk.gray('Source'), 'Titan Exchange'],
              [chalk.gray('Input'), `${uiInAmount} (${options.inputMint})`],
              [chalk.gray('Output'), `${uiOutAmount} (${options.outputMint})`],
              [chalk.gray('Swap Mode'), swapMode],
              [chalk.gray('Slippage'), `${slippageBps} bps`],
            );
            console.log(chalk.cyan.bold('\n  Titan Swap Preview\n'));
            console.log(table.toString());
            const hint = fallbackHint(titanApi.getLastRoute());
            if (hint) console.error(chalk.gray(`[byreal] ${hint}`));
            console.log(chalk.yellow('\n  Remove --dry-run to emit an unsigned transaction; add --execute to sign + broadcast via Privy.'));
          }
          return;
        }

        const base64 = quote.transaction;

        if (mode === 'unsigned-tx') {
          console.log(JSON.stringify({ unsignedTransactions: [base64] }));
          return;
        }

        // Default (execute): sign + broadcast via Privy.
        const ctx = requirePrivyContext(walletAddress);
        printPrivySignBanner();
        const broadcast = await privyBroadcastOne(ctx, base64);
        if (!broadcast.ok) {
          format === 'json' ? outputErrorJson(broadcast.error.toJSON()) : outputErrorTable(broadcast.error.toJSON());
          process.exit(1);
        }
        if (format === 'json') {
          outputJson({
            signature: broadcast.value.signature,
            explorer: `https://solscan.io/tx/${broadcast.value.signature}`,
          }, startTime);
        } else {
          outputTransactionResult(broadcast.value.signature);
        }
      } catch (e) {
        if (e instanceof ByrealError) {
          format === 'json' ? outputErrorJson(e.toJSON()) : outputErrorTable(e.toJSON());
          process.exit(1);
        }
        const message = (e as Error).message || 'Titan swap failed';
        format === 'json'
          ? outputErrorJson({ code: 'API_ERROR', type: 'NETWORK', message, retryable: true })
          : console.error(chalk.red(`\nError: ${message}`));
        process.exit(1);
      }
    });
}
