/**
 * Execution mode control for Byreal CLI
 * Handles --dry-run / --confirm flow for all execute commands
 */

import chalk from 'chalk';

export type ExecutionMode = 'dry-run' | 'confirm' | 'unsigned-tx' | 'none';

/**
 * Resolve execution mode from command options
 */
export function resolveExecutionMode(options: { dryRun?: boolean; confirm?: boolean; unsignedTx?: boolean }): ExecutionMode {
  // Mutual exclusion check
  const flags = [options.dryRun, options.confirm, options.unsignedTx].filter(Boolean);
  if (flags.length > 1) {
    console.error(chalk.red('\nError: --dry-run, --confirm, and --unsigned-tx are mutually exclusive'));
    process.exit(1);
  }

  if (options.unsignedTx) return 'unsigned-tx';
  if (options.dryRun) return 'dry-run';
  if (options.confirm) return 'confirm';
  return 'none';
}

/**
 * Require --dry-run or --confirm or --unsigned-tx to be specified. Exits if none is set.
 */
export function requireExecutionMode(mode: ExecutionMode, commandName: string): void {
  if (mode === 'none') {
    console.error(chalk.red(`\nError: You must specify --dry-run, --confirm, or --unsigned-tx for "${commandName}"`));
    console.error(chalk.yellow('\nOptions:'));
    console.error(chalk.gray('  --dry-run       Preview the operation without executing'));
    console.error(chalk.gray('  --confirm       Execute the operation'));
    console.error(chalk.gray('  --unsigned-tx   Output unsigned transaction(s) as JSON'));
    console.error(chalk.gray(`\nExample:`));
    console.error(chalk.gray(`  byreal-cli ${commandName} --dry-run`));
    console.error(chalk.gray(`  byreal-cli ${commandName} --confirm`));
    console.error(chalk.gray(`  byreal-cli ${commandName} --unsigned-tx --wallet-address <address>`));
    process.exit(1);
  }
}

/**
 * Print dry-run banner
 */
export function printDryRunBanner(): void {
  console.log(chalk.yellow.bold('\n[DRY RUN] No transaction will be executed\n'));
}

/**
 * Print confirm banner
 */
export function printConfirmBanner(): void {
  console.log(chalk.green.bold('\n[CONFIRM] Executing transaction...\n'));
}
