/**
 * Token consolidation CLI command — sweep dust tokens to USDC
 */

import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { PublicKey } from '@solana/web3.js';
import type { GlobalOptions } from '../../core/types.js';
import { printDryRunBanner, printPrivySignBanner } from '../../core/confirm.js';
import { ByrealError, missingWalletAddressError } from '../../core/errors.js';
import { requirePrivyContext, privyBroadcastMany } from '../../privy/index.js';
import {
  outputJson,
  outputErrorJson,
  outputErrorTable,
  outputMultiBroadcastResult,
  safeResolveExecutionMode,
} from '../../cli/output/formatters.js';
import { TABLE_CHARS } from '../../core/constants.js';
import { buildSweepPlan, executeSweep } from './sweep.js';

export function createSweepExecuteCommand(): Command {
  return new Command('execute')
    .description('Consolidate dust tokens into USDC (or SOL)')
    .option('--target-mint <address>', 'Target token to consolidate into', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')
    .option('--max-value-usd <amount>', 'Only sweep tokens below this USD value', '0.5')
    .option('--exclude <mints>', 'Comma-separated mint addresses to skip')
    .option('--dry-run', 'Preview consolidation plan without generating transactions')
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
        const excludeMints = options.exclude
          ? (options.exclude as string).split(',').map((s: string) => s.trim())
          : [];

        const maxValueUsd = parseFloat(options.maxValueUsd);

        // Build sweep plan
        const planResult = await buildSweepPlan({
          walletAddress,
          targetMint: options.targetMint,
          maxValueUsd,
          excludeMints,
        });

        if (!planResult.ok) {
          format === 'json' ? outputErrorJson(planResult.error) : outputErrorTable(planResult.error);
          process.exit(1);
        }

        const plan = planResult.value;

        if (plan.dustTokens.length === 0) {
          if (format === 'json') {
            outputJson({ dustTokens: 0, message: 'No dust tokens found' }, startTime);
          } else {
            console.log(chalk.yellow('\n  No dust tokens found to consolidate.'));
          }
          return;
        }

        if (mode === 'dry-run') {
          printDryRunBanner();
          if (format === 'json') {
            outputJson({
              mode: 'dry-run',
              targetMint: options.targetMint,
              totalEstimatedUsd: plan.totalEstimatedUsd.toFixed(2),
              swapCount: plan.swapCount,
              skipCount: plan.skipCount,
              tokens: plan.dustTokens.map(t => ({
                mint: t.mint,
                amountRaw: t.amountRaw,
                amountUi: t.amountUi,
                valueUsd: t.valueUsd.toFixed(4),
                action: t.action,
                skipReason: t.skipReason,
              })),
            }, startTime);
          } else {
            console.log(chalk.cyan.bold('\n  Token Consolidation Plan\n'));

            const summaryTable = new Table({ chars: TABLE_CHARS });
            summaryTable.push(
              [chalk.gray('Target'), options.targetMint],
              [chalk.gray('Tokens to Swap'), String(plan.swapCount)],
              [chalk.gray('Tokens Skipped'), String(plan.skipCount)],
              [chalk.gray('Estimated Total'), `$${plan.totalEstimatedUsd.toFixed(2)}`],
            );
            console.log(summaryTable.toString());

            const tokenTable = new Table({
              head: [
                chalk.cyan.bold('Mint'),
                chalk.cyan.bold('Amount'),
                chalk.cyan.bold('Value (USD)'),
                chalk.cyan.bold('Action'),
              ],
              chars: TABLE_CHARS,
            });
            for (const t of plan.dustTokens) {
              const actionStr = t.action === 'swap'
                ? chalk.green('SWAP')
                : chalk.gray(`SKIP: ${t.skipReason}`);
              tokenTable.push([
                t.mint,
                t.amountUi,
                t.valueUsd > 0 ? `$${t.valueUsd.toFixed(4)}` : chalk.gray('N/A'),
                actionStr,
              ]);
            }
            console.log(tokenTable.toString());
            console.log(chalk.yellow('\n  Remove --dry-run to emit an unsigned transaction; add --execute to sign + broadcast via Privy.'));
          }
          return;
        }

        // Execute: generate swap + close transactions
        const sweepResult = await executeSweep({
          walletAddress,
          dustTokens: plan.dustTokens,
          targetMint: options.targetMint,
        });

        if (!sweepResult.ok) {
          format === 'json' ? outputErrorJson(sweepResult.error) : outputErrorTable(sweepResult.error);
          process.exit(1);
        }

        const { swapTransactions, failures } = sweepResult.value;

        if (swapTransactions.length === 0) {
          if (format === 'json') {
            outputJson({ message: 'No transactions generated (all tokens failed to quote)', failures }, startTime);
          } else {
            console.log(chalk.yellow('\n  No transactions generated — all tokens failed to quote.'));
            for (const f of failures) {
              console.log(chalk.gray(`  ${f.mint}: ${f.reason}`));
            }
          }
          return;
        }

        if (mode === 'unsigned-tx') {
          console.log(JSON.stringify({
            unsignedTransactions: swapTransactions,
            swapCount: swapTransactions.length,
            ...(failures.length > 0 ? { failures } : {}),
          }));
          return;
        }

        // Default (execute): sign + broadcast each tx via Privy.
        const ctx = requirePrivyContext(walletAddress);
        printPrivySignBanner();
        const broadcast = await privyBroadcastMany(ctx, swapTransactions);
        if (!broadcast.ok) {
          format === 'json' ? outputErrorJson(broadcast.error.toJSON()) : outputErrorTable(broadcast.error.toJSON());
          process.exit(1);
        }
        if (format === 'json') {
          outputJson({ ...broadcast.value, ...(failures.length > 0 ? { failures } : {}) }, startTime);
        } else {
          outputMultiBroadcastResult(broadcast.value);
          if (failures.length > 0) {
            console.log(chalk.gray(`  ${failures.length} token(s) skipped (failed to quote):`));
            for (const f of failures) console.log(chalk.gray(`    ${f.mint}: ${f.reason}`));
          }
        }
        if (broadcast.value.failCount > 0) process.exit(1);
      } catch (e) {
        if (e instanceof ByrealError) {
          format === 'json' ? outputErrorJson(e.toJSON()) : outputErrorTable(e.toJSON());
          process.exit(1);
        }
        const message = (e as Error).message || 'Token consolidation failed';
        format === 'json'
          ? outputErrorJson({ code: 'API_ERROR', type: 'NETWORK', message, retryable: true })
          : console.error(chalk.red(`\nError: ${message}`));
        process.exit(1);
      }
    });
}
