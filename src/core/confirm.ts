/**
 * Execution mode control for Byreal CLI (openclaw branch).
 *
 * Three modes (default is back-compat — pre-Privy behavior is preserved
 * for any LLM prompts / scripts that were written before the Privy
 * integration landed):
 *   - 'unsigned-tx'  Default. Emit base64 unsigned transaction(s) so an
 *                    external signer can take over. Identical to the
 *                    pre-Privy CLI output.
 *   - 'execute'      Opt-in via --execute. Sign + broadcast via Privy proxy.
 *   - 'dry-run'      Preview. No transaction generated, no signing.
 */

import chalk from 'chalk';
import { conflictingFlagsError } from './errors.js';

export type ExecutionMode = 'dry-run' | 'execute' | 'unsigned-tx';

/**
 * Resolve execution mode from command options.
 *   --dry-run + --execute are mutually exclusive (throws ByrealError).
 *   No flags    → 'unsigned-tx' (back-compat with pre-Privy behavior).
 */
export function resolveExecutionMode(options: {
  dryRun?: boolean;
  execute?: boolean;
}): ExecutionMode {
  if (options.dryRun && options.execute) {
    throw conflictingFlagsError('--dry-run', '--execute');
  }
  if (options.dryRun) return 'dry-run';
  if (options.execute) return 'execute';
  return 'unsigned-tx';
}

/**
 * Yellow banner shown in --dry-run mode.
 * Routed to stderr so it never pollutes JSON output on stdout.
 */
export function printDryRunBanner(): void {
  console.error(chalk.yellow.bold('\n[DRY RUN] No transaction will be generated\n'));
}

/**
 * Green banner shown in default execute mode (signs + broadcasts via Privy).
 * Routed to stderr so it never pollutes JSON output on stdout.
 */
export function printPrivySignBanner(): void {
  console.error(
    chalk.green.bold(
      '\n[PRIVY SIGN] Signing and broadcasting via Privy wallet\n',
    ),
  );
}
