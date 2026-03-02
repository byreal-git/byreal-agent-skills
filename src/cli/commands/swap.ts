/**
 * Swap commands for Byreal CLI
 * - swap execute: Preview (--dry-run) or execute (--confirm) a swap transaction
 */

import { Command } from 'commander';
import chalk from 'chalk';
import type { GlobalOptions } from '../../core/types.js';
import { api } from '../../api/endpoints.js';
import { resolveKeypair, resolveAddress } from '../../auth/keypair.js';
import { uiToRaw, rawToUi } from '../../core/amounts.js';
import { getSlippageBps, getConnection } from '../../core/solana.js';
import { resolveDecimals } from '../../core/token-registry.js';
import {
  resolveExecutionMode,
  requireExecutionMode,
  printDryRunBanner,
  printConfirmBanner,
} from '../../core/confirm.js';
import {
  deserializeTransaction,
  signTransaction,
  serializeTransaction,
} from '../../core/transaction.js';
import { transactionError } from '../../core/errors.js';
import {
  outputJson,
  outputErrorJson,
  outputErrorTable,
  outputSwapQuoteTable,
  outputSwapResultTable,
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
    .description('Preview or execute a swap transaction')
    .requiredOption('--input-mint <address>', 'Input token mint address')
    .requiredOption('--output-mint <address>', 'Output token mint address')
    .requiredOption('--amount <amount>', 'Amount to swap (UI amount, decimals auto-resolved)')
    .option('--swap-mode <mode>', 'Swap mode: in or out', 'in')
    .option('--slippage <bps>', 'Slippage tolerance in basis points')
    .option('--raw', 'Amount is already in raw (smallest unit) format')
    .option('--dry-run', 'Preview the swap without executing')
    .option('--confirm', 'Execute the swap')
    .action(async (options, cmdObj: Command) => {
      const globalOptions = cmdObj.optsWithGlobals() as GlobalOptions;
      const format = globalOptions.output;
      const startTime = Date.now();

      // Check execution mode
      const mode = resolveExecutionMode(options);
      requireExecutionMode(mode, 'swap execute');

      // Resolve keypair: required for --confirm, optional for --dry-run
      type ResolvedKeypair = Extract<ReturnType<typeof resolveKeypair>, { ok: true }>['value'];
      let keypair: ResolvedKeypair | undefined;
      let userPublicKey: string | undefined;

      const keypairResult = resolveKeypair(globalOptions.keypairPath);
      if (keypairResult.ok) {
        keypair = keypairResult.value;
        userPublicKey = keypair.address;
      } else if (mode === 'confirm') {
        // --confirm requires keypair
        if (format === 'json') {
          outputErrorJson(keypairResult.error);
        } else {
          outputErrorTable(keypairResult.error);
        }
        process.exit(1);
      } else {
        // --dry-run without keypair: try resolveAddress for userPublicKey
        const addrResult = resolveAddress(globalOptions.keypairPath);
        if (addrResult.ok) {
          userPublicKey = addrResult.value.address;
        }
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
            console.log(chalk.yellow('\n  Use --confirm to execute this swap'));
          }
          return;
        }

        // Confirm: execute the swap
        printConfirmBanner();

        if (!quote.transaction) {
          const errMsg = 'No transaction returned in quote. Ensure wallet is configured.';
          if (format === 'json') {
            outputErrorJson({ code: 'API_ERROR', type: 'NETWORK', message: errMsg, retryable: false });
          } else {
            console.error(chalk.red(`\nError: ${errMsg}`));
          }
          process.exit(1);
        }

        // Deserialize and sign
        const txResult = deserializeTransaction(quote.transaction);
        if (!txResult.ok) {
          if (format === 'json') {
            outputErrorJson(txResult.error);
          } else {
            outputErrorTable(txResult.error);
          }
          process.exit(1);
        }

        if (!keypair) {
          const errMsg = 'Missing keypair for signing. Ensure wallet is configured.';
          if (format === 'json') {
            outputErrorJson({ code: 'MISSING_WALLET', type: 'VALIDATION', message: errMsg, retryable: false });
          } else {
            console.error(chalk.red(`\nError: ${errMsg}`));
          }
          process.exit(1);
        }

        const signedTx = signTransaction(txResult.value, keypair.keypair);
        const signedBase64 = serializeTransaction(signedTx);

        // Execute based on router type
        let executeResult;
        if (quote.routerType === 'RFQ' && quote.quoteId && quote.orderId) {
          executeResult = await api.executeSwapRfq({
            quoteId: quote.quoteId,
            requestId: quote.orderId,
            transaction: signedBase64,
          });
        } else {
          executeResult = await api.executeSwapAmm({
            preData: [quote.transaction],
            data: [signedBase64],
            userSignTime: Date.now(),
          });
        }

        if (!executeResult.ok) {
          if (format === 'json') {
            outputErrorJson(executeResult.error);
          } else {
            outputErrorTable(executeResult.error);
          }
          process.exit(1);
        }

        // Verify transaction on-chain
        const execValue = executeResult.value as { signatures?: string[]; txSignature?: string; state?: string };
        const signatures = execValue.signatures
          || (execValue.txSignature ? [execValue.txSignature] : []);

        let confirmed = true;
        if (signatures.length > 0) {
          const connection = getConnection();
          try {
            for (const sig of signatures) {
              const result = await connection.confirmTransaction(
                {
                  signature: sig,
                  blockhash: signedTx.message.recentBlockhash,
                  lastValidBlockHeight: (await connection.getLatestBlockhash()).lastValidBlockHeight,
                },
                'confirmed'
              );

              if (result.value.err) {
                const txErr = transactionError(
                  `Transaction confirmed but failed on-chain: ${JSON.stringify(result.value.err)}`,
                  sig
                );
                if (format === 'json') {
                  outputErrorJson(txErr.toJSON());
                } else {
                  outputErrorTable(txErr.toJSON());
                }
                process.exit(1);
              }
            }
          } catch (e) {
            const message = (e as Error).message || 'Unknown error';
            if (message.includes('timeout') || message.includes('Timeout')) {
              // Timeout: transaction may still succeed, show unconfirmed state
              confirmed = false;
            } else {
              const txErr = transactionError(message, signatures[0]);
              if (format === 'json') {
                outputErrorJson(txErr.toJSON());
              } else {
                outputErrorTable(txErr.toJSON());
              }
              process.exit(1);
            }
          }
        }

        if (format === 'json') {
          outputJson({
            ...executeResult.value,
            inputMint: quote.inputMint,
            outputMint: quote.outputMint,
            uiInAmount,
            uiOutAmount,
            priceImpactPct: quote.priceImpactPct,
            routerType: quote.routerType,
            confirmed,
          }, startTime);
        } else {
          outputSwapResultTable(executeResult.value, uiInAmount, uiOutAmount, quote.priceImpactPct, confirmed);
        }
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
