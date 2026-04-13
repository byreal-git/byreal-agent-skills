/**
 * Token Consolidation plugin — sweep dust tokens into USDC
 */

import { Command } from 'commander';
import type { DefiPlugin, Capability } from '../types.js';
import { createSweepExecuteCommand } from './commands.js';

const capabilities: Capability[] = [
  {
    id: 'defi.sweep.execute',
    name: 'Token Consolidate',
    description: 'Consolidate scattered small token balances (dust) into USDC or SOL via Jupiter swap, then close empty accounts to reclaim rent',
    category: 'execute',
    auth_required: true,
    command: 'byreal-cli sweep execute --wallet-address <address>',
    params: [
      { name: 'target-mint', type: 'string', required: false, description: 'Target token to consolidate into', default: 'USDC' },
      { name: 'min-value-usd', type: 'string', required: false, description: 'Minimum token value in USD to swap', default: '0.5' },
      { name: 'exclude', type: 'string', required: false, description: 'Comma-separated mint addresses to skip' },
      { name: 'dry-run', type: 'boolean', required: false, description: 'Preview consolidation plan without generating transactions' },
    ],
  },
];

export const consolidatePlugin: DefiPlugin = {
  id: 'consolidate',
  name: 'Token Consolidate',
  createCommand() {
    const cmd = new Command('sweep')
      .description('Consolidate dust tokens into a single asset');

    cmd.addCommand(createSweepExecuteCommand());

    return cmd;
  },
  capabilities,
};
