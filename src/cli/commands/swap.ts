/**
 * Swap commands for Byreal CLI (openclaw branch)
 * Default: output unsigned transaction as base64.
 * --dry-run: preview the swap without generating a transaction.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { PublicKey } from '@solana/web3.js';
import type { GlobalOptions } from '../../core/types.js';
import { api } from '../../api/endpoints.js';
import { uiToRaw, rawToUi } from '../../core/amounts.js';
import { getSlippageBps } from '../../core/solana.js';
import { resolveDecimals } from '../../core/token-registry.js';
import { resolveExecutionMode, printDryRunBanner } from '../../core/confirm.js';
import { missingWalletAddressError } from '../../core/errors.js';
import {
  outputJson,
  outputErrorJson,
  outputErrorTable,
  outputSwapQuoteTable,
} from '../output/formatters.js';

// ============================================
// Resolve raw amount from UI amount + mint
// ============================================

async function resolveRawAmount(
  amount: string,
  swapMode: 'in' | 'out',
  inputMint: string,
  outputMint: string,
  isRaw: boolean,
): Promise<string> {
  if (isRaw) return amount;
  const targetMint = swapMode === 'in' ? inputMint : outputMint;
  const decimals = await resolveDecimals(targetMint);
  return uiToRaw(amount, decimals);
}

// ============================================
// Resolve UI amounts from quote
// ============================================

async function resolveUiAmounts(quote: { inAmount: string; outAmount: string; inputMint: string; outputMint: string }) {
  const inputDecimals = await resolveDecimals(quote.inputMint);
  const outputDecimals = await resolveDecimals(quote.outputMint);
  return {
    uiInAmount: rawToUi(quote.inAmount, inputDecimals),
    uiOutAmount: rawToUi(quote.outAmount, outputDecimals),
  };
}

// ============================================
// swap execute
// ============================================

function createSwapExecuteCommand(): Command {
  return new Command('execute')
    .description('Preview or generate a swap transaction')
    .requiredOption('--input-mint <address>', 'Input token mint address')
    .requiredOption('--output-mint <address>', 'Output token mint address')
    .requiredOption('--amount <amount>', 'Amount to swap (UI amount, decimals auto-resolved)')
    .option('--swap-mode <mode>', 'Swap mode: in or out', 'in')
    .option('--slippage <bps>', 'Slippage tolerance in basis points')
    .option('--raw', 'Amount is already in raw (smallest unit) format')
    .option('--dry-run', 'Preview the swap without generating a transaction')
    .action(async (options, cmdObj: Command) => {
      const globalOptions = cmdObj.optsWithGlobals() as GlobalOptions;
      const format = globalOptions.output;
      const startTime = Date.now();

      const mode = resolveExecutionMode(options);

      // Resolve wallet address from global option
      const userPublicKey = globalOptions.walletAddress;
      if (!userPublicKey) {
        const err = missingWalletAddressError();
        if (format === 'json') {
          outputErrorJson(err.toJSON());
        } else {
          outputErrorTable(err.toJSON());
        }
        process.exit(1);
      }

      // Validate address format
      try {
        new PublicKey(userPublicKey);
      } catch {
        if (format === 'json') {
          outputErrorJson({ code: 'INVALID_PARAMETER', type: 'VALIDATION', message: `Invalid wallet address: ${userPublicKey}`, retryable: false });
        } else {
          console.error(chalk.red(`\nError: Invalid wallet address: ${userPublicKey}`));
        }
        process.exit(1);
      }

      try {
        // Resolve amount (auto-detect decimals from mint)
        const amount = await resolveRawAmount(
          options.amount,
          options.swapMode as 'in' | 'out',
          options.inputMint,
          options.outputMint,
          options.raw,
        );

        const slippageBps = options.slippage
          ? parseInt(options.slippage, 10)
          : getSlippageBps();

        // Get quote with transaction
        const quoteResult = await api.getSwapQuote({
          inputMint: options.inputMint,
          outputMint: options.outputMint,
          amount,
          swapMode: options.swapMode as 'in' | 'out',
          slippageBps,
          userPublicKey,
        });

        if (!quoteResult.ok) {
          if (format === 'json') {
            outputErrorJson(quoteResult.error);
          } else {
            outputErrorTable(quoteResult.error);
          }
          process.exit(1);
        }

        const quote = quoteResult.value;

        // Resolve UI amounts for display
        const { uiInAmount, uiOutAmount } = await resolveUiAmounts(quote);

        // Dry-run: show preview and exit
        if (mode === 'dry-run') {
          printDryRunBanner();
          if (format === 'json') {
            outputJson({ mode: 'dry-run', ...quote, uiInAmount, uiOutAmount }, startTime);
          } else {
            outputSwapQuoteTable(quote, uiInAmount, uiOutAmount);
            console.log(chalk.yellow('\n  Remove --dry-run to generate the unsigned transaction'));
          }
          return;
        }

        // Default (execute): output unsigned transaction
        if (!quote.transaction) {
          const errMsg = 'No transaction returned in quote. Ensure wallet address is valid.';
          if (format === 'json') {
            outputErrorJson({ code: 'API_ERROR', type: 'NETWORK', message: errMsg, retryable: false });
          } else {
            console.error(chalk.red(`\nError: ${errMsg}`));
          }
          process.exit(1);
        }
        console.log(JSON.stringify({ unsignedTransactions: [quote.transaction] }));
      } catch (e) {
        const message = (e as Error).message || 'Failed to resolve token decimals';
        if (format === 'json') {
          outputErrorJson({ code: 'VALIDATION_ERROR', type: 'VALIDATION', message, retryable: false });
        } else {
          console.error(chalk.red(`\nError: ${message}`));
        }
        process.exit(1);
      }
    });
}

// ============================================
// swap (parent command)
// ============================================

export function createSwapCommand(): Command {
  const cmd = new Command('swap')
    .description('Swap tokens on Byreal DEX');

  cmd.addCommand(createSwapExecuteCommand());

  return cmd;
}
