/**
 * Rent reclaim CLI command
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
import { scanEmptyAccounts, buildCloseTransactions } from './accounts.js';

export function createRentReclaimCommand(): Command {
  return new Command('reclaim')
    .description('Close empty token accounts to reclaim SOL rent')
    .option('--dry-run', 'Scan and report without generating transactions')
    .option('--execute', 'Sign + broadcast on-chain via Privy (default emits unsigned tx for back-compat)')
    .option('--include-token2022', 'Also close empty Token-2022 accounts')
    .option('--exclude <mints>', 'Comma-separated mint addresses to never close')
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

        const scan = await scanEmptyAccounts(walletAddress, {
          includeToken2022: options.includeToken2022,
          excludeMints,
        });

        if (scan.emptyAccounts.length === 0) {
          if (format === 'json') {
            outputJson({ emptyAccounts: 0, estimatedRentSol: 0, message: 'No empty accounts found' }, startTime);
          } else {
            console.log(chalk.yellow('\n  No empty token accounts found.'));
          }
          return;
        }

        if (mode === 'dry-run') {
          printDryRunBanner();
          if (format === 'json') {
            outputJson({
              mode: 'dry-run',
              emptyAccounts: scan.emptyAccounts.length,
              splCount: scan.splCount,
              token2022Count: scan.token2022Count,
              estimatedRentSol: scan.estimatedRentSol.toFixed(6),
              accounts: scan.emptyAccounts,
            }, startTime);
          } else {
            const table = new Table({ chars: TABLE_CHARS });
            table.push(
              [chalk.gray('Empty Accounts'), String(scan.emptyAccounts.length)],
              [chalk.gray('SPL Token'), String(scan.splCount)],
              [chalk.gray('Token-2022'), String(scan.token2022Count)],
              [chalk.gray('Estimated Recovery'), `${scan.estimatedRentSol.toFixed(6)} SOL`],
            );
            console.log(chalk.cyan.bold('\n  Rent Reclaim Scan\n'));
            console.log(table.toString());

            const acctTable = new Table({
              head: [chalk.cyan.bold('Account'), chalk.cyan.bold('Mint'), chalk.cyan.bold('Program')],
              chars: TABLE_CHARS,
            });
            for (const a of scan.emptyAccounts) {
              const progLabel = a.programId.includes('2022') ? 'Token-2022' : 'SPL Token';
              acctTable.push([a.pubkey, a.mint, progLabel]);
            }
            console.log(acctTable.toString());

            console.log(chalk.yellow('\n  Remove --dry-run to emit an unsigned transaction; add --execute to sign + broadcast via Privy.'));
          }
          return;
        }

        // Build close transactions (used by both unsigned-tx and execute modes).
        const txs = await buildCloseTransactions(walletAddress, scan.emptyAccounts);

        if (mode === 'unsigned-tx') {
          console.log(JSON.stringify({ unsignedTransactions: txs }));
          return;
        }

        // Default (execute): sign + broadcast each via Privy.
        const ctx = requirePrivyContext(walletAddress);
        printPrivySignBanner();
        const broadcast = await privyBroadcastMany(ctx, txs);
        if (!broadcast.ok) {
          format === 'json' ? outputErrorJson(broadcast.error.toJSON()) : outputErrorTable(broadcast.error.toJSON());
          process.exit(1);
        }
        if (format === 'json') {
          outputJson(broadcast.value, startTime);
        } else {
          outputMultiBroadcastResult(broadcast.value);
        }
        if (broadcast.value.failCount > 0) process.exit(1);
      } catch (e) {
        if (e instanceof ByrealError) {
          format === 'json' ? outputErrorJson(e.toJSON()) : outputErrorTable(e.toJSON());
          process.exit(1);
        }
        const message = (e as Error).message || 'Rent reclaim failed';
        format === 'json'
          ? outputErrorJson({ code: 'RPC_ERROR', type: 'SYSTEM', message, retryable: true })
          : console.error(chalk.red(`\nError: ${message}`));
        process.exit(1);
      }
    });
}
