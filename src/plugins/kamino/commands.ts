/**
 * Kamino Lend CLI commands — deposit, withdraw, status
 */

import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { PublicKey } from '@solana/web3.js';
import type { GlobalOptions } from '../../core/types.js';
import { resolveExecutionMode, printDryRunBanner } from '../../core/confirm.js';
import { missingWalletAddressError } from '../../core/errors.js';
import { outputJson, outputErrorJson, outputErrorTable } from '../../cli/output/formatters.js';
import { TABLE_CHARS } from '../../core/constants.js';
import * as kaminoApi from './api.js';

// ============================================
// Helpers
// ============================================

function validateWallet(walletAddress: string | undefined, format: string): string {
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
  return walletAddress;
}

// ============================================
// kamino deposit
// ============================================

export function createKaminoDepositCommand(): Command {
  return new Command('deposit')
    .description('Deposit tokens to Kamino Lend')
    .requiredOption('--amount <amount>', 'Amount to deposit (UI amount, e.g. 2.0)')
    .option('--mint <address>', 'Token mint address', kaminoApi.USDC_MINT)
    .option('--reserve <address>', 'Reserve address (auto-resolved from mint if omitted)')
    .option('--market <address>', 'Market address', kaminoApi.KAMINO_MAIN_MARKET)
    .option('--dry-run', 'Preview without generating a transaction')
    .action(async (options, cmdObj: Command) => {
      const globalOptions = cmdObj.optsWithGlobals() as GlobalOptions;
      const format = globalOptions.output;
      const startTime = Date.now();
      const mode = resolveExecutionMode(options);
      const walletAddress = validateWallet(globalOptions.walletAddress, format);

      try {
        const reserve = options.reserve ?? kaminoApi.resolveReserve(options.mint, options.market);

        if (mode === 'dry-run') {
          printDryRunBanner();
          if (format === 'json') {
            outputJson({
              mode: 'dry-run',
              action: 'deposit',
              mint: options.mint,
              reserve,
              amount: options.amount,
              market: options.market,
            }, startTime);
          } else {
            const table = new Table({ chars: TABLE_CHARS });
            table.push(
              [chalk.gray('Action'), 'Deposit'],
              [chalk.gray('Mint'), options.mint],
              [chalk.gray('Reserve'), reserve],
              [chalk.gray('Amount'), options.amount],
              [chalk.gray('Market'), options.market],
            );
            console.log(chalk.cyan.bold('\n  Kamino Deposit Preview\n'));
            console.log(table.toString());
            console.log(chalk.yellow('\n  Remove --dry-run to generate the unsigned transaction'));
          }
          return;
        }

        // Kamino API expects UI amount (e.g. '2.0'), not raw
        const result = await kaminoApi.deposit({
          wallet: walletAddress,
          market: options.market,
          reserve,
          amount: options.amount,
        });

        if (!result.ok) {
          format === 'json' ? outputErrorJson(result.error) : outputErrorTable(result.error);
          process.exit(1);
        }

        console.log(JSON.stringify({ unsignedTransactions: [result.value.transaction] }));
      } catch (e) {
        const message = (e as Error).message || 'Kamino deposit failed';
        format === 'json'
          ? outputErrorJson({ code: 'API_ERROR', type: 'NETWORK', message, retryable: true })
          : console.error(chalk.red(`\nError: ${message}`));
        process.exit(1);
      }
    });
}

// ============================================
// kamino withdraw
// ============================================

export function createKaminoWithdrawCommand(): Command {
  return new Command('withdraw')
    .description('Withdraw tokens from Kamino Lend')
    .requiredOption('--amount <amount>', 'Amount to withdraw (UI amount, e.g. 2.0)')
    .option('--mint <address>', 'Token mint address', kaminoApi.USDC_MINT)
    .option('--reserve <address>', 'Reserve address (auto-resolved from mint if omitted)')
    .option('--market <address>', 'Market address', kaminoApi.KAMINO_MAIN_MARKET)
    .option('--dry-run', 'Preview without generating a transaction')
    .action(async (options, cmdObj: Command) => {
      const globalOptions = cmdObj.optsWithGlobals() as GlobalOptions;
      const format = globalOptions.output;
      const startTime = Date.now();
      const mode = resolveExecutionMode(options);
      const walletAddress = validateWallet(globalOptions.walletAddress, format);

      try {
        const reserve = options.reserve ?? kaminoApi.resolveReserve(options.mint, options.market);

        if (mode === 'dry-run') {
          printDryRunBanner();
          if (format === 'json') {
            outputJson({
              mode: 'dry-run',
              action: 'withdraw',
              mint: options.mint,
              reserve,
              amount: options.amount,
              market: options.market,
            }, startTime);
          } else {
            const table = new Table({ chars: TABLE_CHARS });
            table.push(
              [chalk.gray('Action'), 'Withdraw'],
              [chalk.gray('Mint'), options.mint],
              [chalk.gray('Reserve'), reserve],
              [chalk.gray('Amount'), options.amount],
              [chalk.gray('Market'), options.market],
            );
            console.log(chalk.cyan.bold('\n  Kamino Withdraw Preview\n'));
            console.log(table.toString());
            console.log(chalk.yellow('\n  Remove --dry-run to generate the unsigned transaction'));
          }
          return;
        }

        // Kamino API expects UI amount (e.g. '2.0'), not raw
        const result = await kaminoApi.withdraw({
          wallet: walletAddress,
          market: options.market,
          reserve,
          amount: options.amount,
        });

        if (!result.ok) {
          format === 'json' ? outputErrorJson(result.error) : outputErrorTable(result.error);
          process.exit(1);
        }

        console.log(JSON.stringify({ unsignedTransactions: [result.value.transaction] }));
      } catch (e) {
        const message = (e as Error).message || 'Kamino withdraw failed';
        format === 'json'
          ? outputErrorJson({ code: 'API_ERROR', type: 'NETWORK', message, retryable: true })
          : console.error(chalk.red(`\nError: ${message}`));
        process.exit(1);
      }
    });
}

// ============================================
// kamino status
// ============================================

export function createKaminoStatusCommand(): Command {
  return new Command('status')
    .description('View Kamino Lend positions and APY')
    .option('--market <address>', 'Market address', kaminoApi.KAMINO_MAIN_MARKET)
    .action(async (options, cmdObj: Command) => {
      const globalOptions = cmdObj.optsWithGlobals() as GlobalOptions;
      const format = globalOptions.output;
      const startTime = Date.now();
      const walletAddress = validateWallet(globalOptions.walletAddress, format);

      try {
        const result = await kaminoApi.getUserObligations({
          wallet: walletAddress,
          market: options.market,
        });

        if (!result.ok) {
          format === 'json' ? outputErrorJson(result.error) : outputErrorTable(result.error);
          process.exit(1);
        }

        const obligations = result.value;
        if (format === 'json') {
          outputJson({ obligations, total: obligations.length, market: options.market }, startTime);
        } else {
          if (obligations.length === 0) {
            console.log(chalk.yellow('\n  No Kamino Lend positions found.'));
            return;
          }

          for (const ob of obligations) {
            console.log(chalk.cyan.bold(`\n  Obligation: ${ob.obligationAddress}`));
            console.log(chalk.gray(`  Net Value: ${ob.netAccountValue}`));

            if (ob.deposits.length > 0) {
              const depTable = new Table({
                head: [chalk.cyan.bold('Token'), chalk.cyan.bold('Amount'), chalk.cyan.bold('Value'), chalk.cyan.bold('APY')],
                chars: TABLE_CHARS,
              });
              for (const d of ob.deposits) {
                depTable.push([d.symbol, d.amount, `$${d.marketValue}`, `${(d.apy * 100).toFixed(2)}%`]);
              }
              console.log(chalk.white('\n  Deposits:'));
              console.log(depTable.toString());
            }

            if (ob.borrows.length > 0) {
              const borTable = new Table({
                head: [chalk.cyan.bold('Token'), chalk.cyan.bold('Amount'), chalk.cyan.bold('Value'), chalk.cyan.bold('APY')],
                chars: TABLE_CHARS,
              });
              for (const b of ob.borrows) {
                borTable.push([b.symbol, b.amount, `$${b.marketValue}`, `${(b.apy * 100).toFixed(2)}%`]);
              }
              console.log(chalk.white('\n  Borrows:'));
              console.log(borTable.toString());
            }
          }
        }
      } catch (e) {
        const message = (e as Error).message || 'Kamino status failed';
        format === 'json'
          ? outputErrorJson({ code: 'API_ERROR', type: 'NETWORK', message, retryable: true })
          : console.error(chalk.red(`\nError: ${message}`));
        process.exit(1);
      }
    });
}
