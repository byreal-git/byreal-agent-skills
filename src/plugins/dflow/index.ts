/**
 * DFlow plugin — order-flow swap aggregator
 */

import { Command } from 'commander';
import type { DefiPlugin, Capability } from '../types.js';
import { createDFlowSwapCommand } from './commands.js';

const capabilities: Capability[] = [
  {
    id: 'defi.dflow.swap',
    name: 'DFlow Swap',
    description: 'Swap tokens via DFlow order-flow aggregator with MEV protection',
    category: 'execute',
    auth_required: true,
    command: 'byreal-cli dflow swap --wallet-address <address>',
    params: [
      { name: 'input-mint', type: 'string', required: true, description: 'Input token mint address' },
      { name: 'output-mint', type: 'string', required: true, description: 'Output token mint address' },
      { name: 'amount', type: 'string', required: true, description: 'Amount to swap (UI format)' },
      { name: 'slippage', type: 'integer', required: false, description: 'Slippage tolerance in basis points' },
      { name: 'raw', type: 'boolean', required: false, description: 'Amount is already in raw format' },
      { name: 'dry-run', type: 'boolean', required: false, description: 'Preview without generating transaction' },
    ],
  },
];

export const dflowPlugin: DefiPlugin = {
  id: 'dflow',
  name: 'DFlow',
  createCommand() {
    const cmd = new Command('dflow')
      .description('DFlow — order-flow swap');

    cmd.addCommand(createDFlowSwapCommand());

    return cmd;
  },
  capabilities,
};
