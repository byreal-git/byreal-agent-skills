import { Command } from 'commander';
import type { GlobalOptions } from '../../../core/types.js';
import { emitNotImplemented } from '../formatters.js';

export function createFundingCommand(): Command {
  const cmd = new Command('funding').description('Polymarket funding (deposit / withdraw / status)');

  cmd
    .command('balance')
    .description('Read Polymarket available balance (public parts)')
    .option('--evm-wallet-address <addr>', 'EVM EOA (defaults to realclaw-config evm wallet)')
    .action((_options, cmdObj: Command) => {
      const { output } = cmdObj.optsWithGlobals() as GlobalOptions;
      emitNotImplemented(output, 'funding balance');
    });

  cmd
    .command('deposit-preview')
    .description('Preview a Solana USDC → Polymarket deposit')
    .option('--evm-wallet-address <addr>', 'EVM EOA (proxy wallet target)')
    .requiredOption('--amount <amount>', 'Amount in USDC (UI)')
    .action((_options, cmdObj: Command) => {
      const { output } = cmdObj.optsWithGlobals() as GlobalOptions;
      emitNotImplemented(output, 'funding deposit-preview');
    });

  cmd
    .command('withdraw-preview')
    .description('Preview a Polymarket → Solana withdraw')
    .option('--evm-wallet-address <addr>', 'EVM EOA (proxy wallet source)')
    .requiredOption('--amount <amount>', 'Amount in USDC (UI)')
    .action((_options, cmdObj: Command) => {
      const { output } = cmdObj.optsWithGlobals() as GlobalOptions;
      emitNotImplemented(output, 'funding withdraw-preview');
    });

  cmd
    .command('status')
    .description('Read deposit/withdraw transfer status (transfer.status)')
    .requiredOption('--type <type>', 'deposit | withdraw')
    .option('--order-id <id>', 'Bridge order id (optional)')
    .option('--evm-wallet-address <addr>', 'EVM EOA / proxy wallet')
    .action((_options, cmdObj: Command) => {
      const { output } = cmdObj.optsWithGlobals() as GlobalOptions;
      emitNotImplemented(output, 'funding status');
    });

  return cmd;
}
