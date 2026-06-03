import { Command } from 'commander';
import type { GlobalOptions } from '../../../core/types.js';
import { emitNotImplemented } from '../formatters.js';

export function createPortfolioCommand(): Command {
  const cmd = new Command('portfolio').description('Polymarket portfolio');

  cmd
    .command('read')
    .description('Read positions / value / pnl (public parts; L2 cash/orders are Phase B)')
    .option('--evm-wallet-address <addr>', 'EVM EOA (defaults to realclaw-config evm wallet)')
    .option('--category-id <id>', 'Filter positions by category')
    .option('--position-id <id>', 'Read a single position')
    .action((_options, cmdObj: Command) => {
      const { output } = cmdObj.optsWithGlobals() as GlobalOptions;
      emitNotImplemented(output, 'portfolio read');
    });

  return cmd;
}
