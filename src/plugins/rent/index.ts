/**
 * Rent Reclaim plugin — close empty token accounts to recover SOL rent
 */

import { Command } from 'commander';
import type { DefiPlugin, Capability } from '../types.js';
import { createRentReclaimCommand } from './commands.js';

const capabilities: Capability[] = [
  {
    id: 'defi.rent.reclaim',
    name: 'Rent Reclaim',
    description: 'Close empty SPL token accounts to reclaim SOL rent deposits (~0.002 SOL each)',
    category: 'execute',
    auth_required: true,
    command: 'byreal-cli rent reclaim --wallet-address <address>',
    params: [
      { name: 'dry-run', type: 'boolean', required: false, description: 'Scan and report without generating transactions' },
      { name: 'include-token2022', type: 'boolean', required: false, description: 'Also close empty Token-2022 accounts' },
      { name: 'exclude', type: 'string', required: false, description: 'Comma-separated mint addresses to never close' },
    ],
  },
];

export const rentPlugin: DefiPlugin = {
  id: 'rent',
  name: 'Rent Reclaim',
  createCommand() {
    const cmd = new Command('rent')
      .description('Token account rent management');

    cmd.addCommand(createRentReclaimCommand());

    return cmd;
  },
  capabilities,
};
