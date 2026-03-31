/**
 * Execution mode control for Byreal CLI (openclaw branch)
 * Default: output unsigned transactions. --dry-run for preview.
 */

import chalk from 'chalk';

export type ExecutionMode = 'dry-run' | 'execute';

/**
 * Resolve execution mode from command options.
 * In openclaw branch, default is 'execute' (output unsigned tx).
 */
export function resolveExecutionMode(options: { dryRun?: boolean }): ExecutionMode {
  if (options.dryRun) return 'dry-run';
  return 'execute';
}

/**
 * Print dry-run banner
 */
export function printDryRunBanner(): void {
  console.log(chalk.yellow.bold('\n[DRY RUN] No transaction will be generated\n'));
}
