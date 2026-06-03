/**
 * Polymarket plugin output helpers.
 *
 * Reuses the shared helpers in src/cli/output/formatters.ts (outputJson,
 * outputErrorJson, etc.); this file adds polymarket-specific table rendering
 * and small command utilities. Table builders are added per command in C2–C5.
 */

import chalk from 'chalk';
import type { OutputFormat } from '../../core/types.js';

/**
 * Transient stub for subcommands not yet wired in the current checkpoint.
 * Replaced by the real handler when each command lands (C2–C5).
 */
export function emitNotImplemented(format: OutputFormat, command: string): never {
  const message = `polymarket ${command} is not implemented yet (Phase A build in progress)`;
  if (format === 'json') {
    console.log(
      JSON.stringify(
        { success: false, error: { code: 'NOT_IMPLEMENTED', type: 'SYSTEM', message, retryable: false } },
        null,
        2,
      ),
    );
  } else {
    console.error(chalk.yellow(`\n${message}\n`));
  }
  process.exit(1);
}

/** Validate an EVM (Polygon) EOA address shape. Never calls new PublicKey(). */
export function isEvmAddress(addr: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(addr);
}
