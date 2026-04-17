/**
 * Titan Exchange plugin — swap via WebSocket-based aggregator
 */

import { Command } from 'commander';
import type { DefiPlugin, Capability } from '../types.js';
import { createTitanSwapCommand } from './commands.js';

const capabilities: Capability[] = [
  {
    id: 'defi.titan.swap',
    name: 'Titan Swap',
    description: 'Swap tokens via Titan Exchange aggregator with WebSocket-based quote streaming',
    category: 'execute',
    auth_required: true,
    command: 'byreal-cli titan swap --wallet-address <address>',
    params: [
      { name: 'input-mint', type: 'string', required: true, description: 'Input token mint address' },
      { name: 'output-mint', type: 'string', required: true, description: 'Output token mint address' },
      { name: 'amount', type: 'string', required: true, description: 'Amount to swap (UI format)' },
      { name: 'swap-mode', type: 'string', required: false, description: 'Swap mode', default: 'ExactIn', enum: ['ExactIn', 'ExactOut'] },
      { name: 'slippage', type: 'integer', required: false, description: 'Slippage tolerance in basis points' },
      { name: 'raw', type: 'boolean', required: false, description: 'Amount is already in raw format' },
      { name: 'dry-run', type: 'boolean', required: false, description: 'Preview without generating transaction' },
    ],
  },
];

export const titanPlugin: DefiPlugin = {
  id: 'titan',
  name: 'Titan Exchange',
  createCommand() {
    const cmd = new Command('titan')
      .description('Titan Exchange — swap');

    cmd.addCommand(createTitanSwapCommand());

    return cmd;
  },
  capabilities,
};
