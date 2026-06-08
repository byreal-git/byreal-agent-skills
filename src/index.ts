/**
 * Byreal CLI - AI-friendly CLI for Byreal CLMM DEX on Solana
 */

import net from 'node:net';
import { Command } from 'commander';
import chalk from 'chalk';
import { VERSION, CLI_NAME, LOGO, EXPERIMENTAL_WARNING } from './core/constants.js';
import { createPoolsCommand } from './cli/commands/pools.js';
import { createTokensCommand } from './cli/commands/tokens.js';
import { createOverviewCommand } from './cli/commands/overview.js';
import { createSkillCommand } from './cli/commands/skill.js';
import { createCatalogCommand } from './cli/commands/catalog.js';
import { createWalletCommand } from './cli/commands/wallet.js';
import { createConfigCommand } from './cli/commands/config.js';
import { createSwapCommand } from './cli/commands/swap.js';
import { createPositionsCommand } from './cli/commands/positions.js';
import { createUpdateCommand } from './cli/commands/update.js';
import { createStatsCommand } from './cli/commands/stats.js';
import { printUpdateNotice } from './core/update-check.js';
import { plugins } from './plugins/index.js';

// ============================================
// Network tuning (Happy Eyeballs)
// ============================================
//
// Node's global fetch/undici uses `autoSelectFamilyAttemptTimeout` = 250ms by
// default. When a host resolves to several addresses — e.g. an /etc/hosts IPv4
// entry plus an unroutable IPv6 that macOS synthesizes (NAT64/DNS64) because the
// hosts file has no IPv6 line — Node abandons an in-flight-but-slow IPv4 connect
// at 250ms and falls onto the dead IPv6, hanging until the overall connect
// timeout (UND_ERR_CONNECT_TIMEOUT). VPN-routed internal test hosts handshake in
// ~450ms, past 250ms, so they fail intermittently while curl (which keeps both
// attempts racing and never abandons the first) succeeds. Widening the window
// lets a slow-but-working address win. Override via env; set <=0 to skip.
const connectAttemptTimeoutMs = Math.floor(
  Number(process.env.BYREAL_CONNECT_ATTEMPT_TIMEOUT_MS ?? 2000),
);
if (
  Number.isFinite(connectAttemptTimeoutMs) &&
  connectAttemptTimeoutMs > 0 &&
  typeof net.setDefaultAutoSelectFamilyAttemptTimeout === 'function'
) {
  net.setDefaultAutoSelectFamilyAttemptTimeout(connectAttemptTimeoutMs);
}

// ============================================
// Main Program
// ============================================

const program = new Command();

program
  .name(CLI_NAME)
  .description('AI-friendly CLI for Byreal CLMM DEX on Solana')
  .version(VERSION, '-v, --version', 'Output the version number')
  .option('-o, --output <format>', 'Output format (json, table)', 'table')
  .option('--debug', 'Show debug information')
  .option('--wallet-address <address>', 'Wallet public key address (required for write commands)')
  .addHelpText('before', chalk.cyan(LOGO) + chalk.yellow(EXPERIMENTAL_WARNING))
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.debug) {
      process.env.DEBUG = 'true';
    }
  });

// ============================================
// Register Commands
// ============================================

program.addCommand(createPoolsCommand());
program.addCommand(createTokensCommand());
program.addCommand(createOverviewCommand());
program.addCommand(createSkillCommand());
program.addCommand(createCatalogCommand());
program.addCommand(createWalletCommand());
program.addCommand(createConfigCommand());
program.addCommand(createSwapCommand());
program.addCommand(createPositionsCommand());
program.addCommand(createUpdateCommand());
program.addCommand(createStatsCommand());

// Register DeFi plugin commands
for (const plugin of plugins) {
  program.addCommand(plugin.createCommand());
}

// ============================================
// Error Handling
// ============================================

program.showHelpAfterError('(add --help for additional information)');

// Handle unknown commands
program.on('command:*', () => {
  console.error(chalk.red(`\nError: Unknown command "${program.args.join(' ')}"`));
  console.log();
  program.outputHelp();
  process.exit(1);
});

// ============================================
// Parse and Execute
// ============================================

async function main() {
  try {
    await program.parseAsync(process.argv);
    const opts = program.opts();
    if (opts.output !== 'json') {
      printUpdateNotice();
    }
  } catch (error) {
    if (error instanceof Error) {
      console.error(chalk.red(`\nError: ${error.message}`));
      if (process.env.DEBUG) {
        console.error(error.stack);
      }
    }
    process.exit(1);
  }
}

main();
