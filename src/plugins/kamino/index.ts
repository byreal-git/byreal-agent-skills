/**
 * Kamino Lend plugin — deposit, withdraw, status via Kamino Finance API
 */

import { Command } from 'commander';
import type { DefiPlugin, Capability } from '../types.js';
import {
  createKaminoDepositCommand,
  createKaminoWithdrawCommand,
  createKaminoStatusCommand,
} from './commands.js';

const capabilities: Capability[] = [
  {
    id: 'defi.kamino.deposit',
    name: 'Kamino Deposit',
    description: 'Deposit tokens to Kamino Lend to earn yield (4-10% APY on USDC)',
    category: 'execute',
    auth_required: true,
    command: 'byreal-cli kamino deposit --wallet-address <address>',
    params: [
      { name: 'amount', type: 'string', required: true, description: 'Amount to deposit (UI format)' },
      { name: 'mint', type: 'string', required: false, description: 'Token mint address', default: 'USDC' },
      { name: 'market', type: 'string', required: false, description: 'Kamino market address', default: 'main market' },
      { name: 'raw', type: 'boolean', required: false, description: 'Amount is already in raw format' },
      { name: 'dry-run', type: 'boolean', required: false, description: 'Preview without generating transaction' },
    ],
  },
  {
    id: 'defi.kamino.withdraw',
    name: 'Kamino Withdraw',
    description: 'Withdraw tokens from Kamino Lend',
    category: 'execute',
    auth_required: true,
    command: 'byreal-cli kamino withdraw --wallet-address <address>',
    params: [
      { name: 'amount', type: 'string', required: true, description: 'Amount to withdraw (UI format)' },
      { name: 'mint', type: 'string', required: false, description: 'Token mint address', default: 'USDC' },
      { name: 'market', type: 'string', required: false, description: 'Kamino market address', default: 'main market' },
      { name: 'raw', type: 'boolean', required: false, description: 'Amount is already in raw format' },
      { name: 'dry-run', type: 'boolean', required: false, description: 'Preview without generating transaction' },
    ],
  },
  {
    id: 'defi.kamino.status',
    name: 'Kamino Status',
    description: 'View Kamino Lend positions, deposited amounts, and current APY',
    category: 'query',
    auth_required: true,
    command: 'byreal-cli kamino status --wallet-address <address>',
    params: [
      { name: 'market', type: 'string', required: false, description: 'Kamino market address', default: 'main market' },
    ],
  },
];

export const kaminoPlugin: DefiPlugin = {
  id: 'kamino',
  name: 'Kamino Lend',
  createCommand() {
    const cmd = new Command('kamino')
      .description('Kamino Lend — deposit, withdraw, yield status');

    cmd.addCommand(createKaminoDepositCommand());
    cmd.addCommand(createKaminoWithdrawCommand());
    cmd.addCommand(createKaminoStatusCommand());

    return cmd;
  },
  capabilities,
};
