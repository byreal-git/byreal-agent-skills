/**
 * Jupiter plugin — swap + price via Jupiter aggregator
 */

import { Command } from 'commander';
import type { DefiPlugin, Capability } from '../types.js';
import {
  createJupSwapCommand,
  createJupPriceCommand,
} from './commands.js';

const capabilities: Capability[] = [
  {
    id: 'defi.jup.swap',
    name: 'Jupiter Swap',
    description: 'Swap tokens via Jupiter aggregator with dynamic slippage and MEV protection',
    category: 'execute',
    auth_required: true,
    command: 'byreal-cli jup swap --wallet-address <address>',
    params: [
      { name: 'input-mint', type: 'string', required: true, description: 'Input token mint address' },
      { name: 'output-mint', type: 'string', required: true, description: 'Output token mint address' },
      { name: 'amount', type: 'string', required: true, description: 'Amount to swap (UI format)' },
      { name: 'slippage', type: 'integer', required: false, description: 'Slippage tolerance in basis points' },
      { name: 'raw', type: 'boolean', required: false, description: 'Amount is already in raw format' },
      { name: 'dry-run', type: 'boolean', required: false, description: 'Preview without generating transaction' },
    ],
  },
  {
    id: 'defi.jup.price',
    name: 'Jupiter Price',
    description: 'Get current token price(s) from Jupiter',
    category: 'query',
    auth_required: false,
    command: 'byreal-cli jup price',
    params: [
      { name: 'mint', type: 'string', required: true, description: 'Token mint address(es), comma-separated' },
    ],
  },
];

export const jupiterPlugin: DefiPlugin = {
  id: 'jupiter',
  name: 'Jupiter',
  createCommand() {
    const cmd = new Command('jup')
      .description('Jupiter DEX — swap, price');

    cmd.addCommand(createJupSwapCommand());
    cmd.addCommand(createJupPriceCommand());

    return cmd;
  },
  capabilities,
};
