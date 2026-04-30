/**
 * Swap commands for Byreal CLI (openclaw branch).
 *
 * Three modes (see src/core/confirm.ts):
 *   - default:              emit { unsignedTransactions: [base64] } (back-compat).
 *   - --execute:            sign + broadcast via Privy proxy.
 *   - --dry-run:            preview only.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { PublicKey } from '@solana/web3.js';
import type { GlobalOptions } from '../../core/types.js';
import { api } from '../../api/endpoints.js';
import { uiToRaw, rawToUi } from '../../core/amounts.js';
import { getSlippageBps } from '../../core/solana.js';
import { resolveDecimals } from '../../core/token-registry.js';
import {
  resolveExecutionMode,
  printDryRunBanner,
  printPrivySignBanner,
} from '../../core/confirm.js';
import {
  ByrealError,
  missingWalletAddressError,
} from '../../core/errors.js';
import { requirePrivyContext, privyBroadcastOne } from '../../privy/index.js';
import {
  outputJson,
  outputErrorJson,
  outputErrorTable,
  outputSwapQuoteTable,
  outputTransactionResult,
  formatUsd,
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

function emitError(format: string, error: unknown): never {
  if (error instanceof ByrealError) {
    if (format === 'json') {
      outputErrorJson(error.toJSON());
    } else {
      outputErrorTable(error.toJSON());
    }
  } else {
    const message = (error as Error)?.message ?? 'Unknown error';
    if (format === 'json') {
      outputErrorJson({ code: 'UNKNOWN_ERROR', type: 'SYSTEM', message, retryable: false });
    } else {
      console.error(chalk.red(`\nError: ${message}`));
    }
  }
  process.exit(1);
}

// ============================================
// swap execute
// ============================================

function createSwapExecuteCommand(): Command {
  return new Command('execute')
    .description('Preview, sign, or emit a swap transaction')
    .requiredOption('--input-mint <address>', 'Input token mint address')
    .requiredOption('--output-mint <address>', 'Output token mint address')
    .requiredOption('--amount <amount>', 'Amount to swap (UI amount, decimals auto-resolved)')
    .option('--swap-mode <mode>', 'Swap mode: in or out', 'in')
    .option('--slippage <bps>', 'Slippage tolerance in basis points')
    .option('--raw', 'Amount is already in raw (smallest unit) format')
    .option('--dry-run', 'Preview the swap without generating a transaction')
    .option('--execute', 'Sign + broadcast on-chain via Privy (default emits unsigned tx for back-compat)')
    .action(async (options, cmdObj: Command) => {
      const globalOptions = cmdObj.optsWithGlobals() as GlobalOptions;
      const format = globalOptions.output;
      const startTime = Date.now();

      // Resolve mode (throws ByrealError on conflicting flags).
      let mode: ReturnType<typeof resolveExecutionMode>;
      try {
        mode = resolveExecutionMode(options);
      } catch (e) {
        emitError(format, e);
      }

      // Wallet address is required for all modes (the swap quote needs it).
      const userPublicKey = globalOptions.walletAddress;
      if (!userPublicKey) {
        emitError(format, missingWalletAddressError());
      }

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
          emitError(format, new ByrealError({
            code: quoteResult.error.code as never,
            type: quoteResult.error.type,
            message: quoteResult.error.message,
            retryable: quoteResult.error.retryable,
          }));
        }

        const quote = quoteResult.value;
        const { uiInAmount, uiOutAmount } = await resolveUiAmounts(quote);

        // ─── Mode: dry-run ───
        if (mode === 'dry-run') {
          printDryRunBanner();
          if (format === 'json') {
            let inAmountUsd: string | undefined;
            let outAmountUsd: string | undefined;
            try {
              const pricesResult = await api.getTokenPrices([quote.inputMint, quote.outputMint]);
              if (pricesResult.ok) {
                const prices = pricesResult.value;
                const inPrice = prices[quote.inputMint] ?? 0;
                const outPrice = prices[quote.outputMint] ?? 0;
                if (inPrice > 0) inAmountUsd = formatUsd(parseFloat(uiInAmount) * inPrice);
                if (outPrice > 0) outAmountUsd = formatUsd(parseFloat(uiOutAmount) * outPrice);
              }
            } catch { /* price fetch failure: skip USD */ }
            outputJson({ mode: 'dry-run', ...quote, uiInAmount, uiOutAmount, inAmountUsd, outAmountUsd }, startTime);
          } else {
            outputSwapQuoteTable(quote, uiInAmount, uiOutAmount);
            console.log(chalk.yellow('\n  Remove --dry-run to emit an unsigned transaction; add --execute to sign + broadcast via Privy.'));
          }
          return;
        }

        // From here on we need the unsigned transaction.
        if (!quote.transaction) {
          const errMsg = 'No transaction returned in quote. Ensure wallet address is valid.';
          if (format === 'json') {
            outputErrorJson({ code: 'API_ERROR', type: 'NETWORK', message: errMsg, retryable: false });
          } else {
            console.error(chalk.red(`\nError: ${errMsg}`));
          }
          process.exit(1);
        }

        // ─── Mode: unsigned-tx (legacy) ───
        if (mode === 'unsigned-tx') {
          console.log(JSON.stringify({ unsignedTransactions: [quote.transaction] }));
          return;
        }

        // ─── Mode: execute (default) — sign + broadcast via Privy ───
        const ctx = requirePrivyContext(userPublicKey);
        printPrivySignBanner();
        const broadcast = await privyBroadcastOne(ctx, quote.transaction);
        if (!broadcast.ok) {
          emitError(format, broadcast.error);
        }
        if (format === 'json') {
          outputJson(
            {
              signature: broadcast.value.signature,
              explorer: `https://solscan.io/tx/${broadcast.value.signature}`,
              quote: { ...quote, uiInAmount, uiOutAmount },
            },
            startTime,
          );
        } else {
          outputTransactionResult(broadcast.value.signature);
        }
      } catch (e) {
        emitError(format, e);
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
