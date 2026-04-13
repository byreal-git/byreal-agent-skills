/**
 * Kamino Lend plugin — deposit, withdraw, status via Kamino Finance API
 */

import { Command } from 'commander';
import type { DefiPlugin, Capability } from '../types.js';
import {
  createKaminoDepositCommand,
  createKaminoWithdrawCommand,
  createKaminoStatusCommand,
  createKaminoReservesCommand,
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
  {
    id: 'defi.kamino.reserves',
    name: 'Kamino Reserves',
    description: 'Show Kamino Lend supply/borrow APY for SOL, USDC, USDT by default. Use --token <symbol|mint> to query a specific other token.',
    category: 'query',
    auth_required: false,
    command: 'byreal-cli kamino reserves',
    params: [
      { name: 'market', type: 'string', required: false, description: 'Kamino market address', default: 'main market' },
      { name: 'token', type: 'string', required: false, description: 'Query a single token by symbol or mint address instead of the default SOL/USDC/USDT set' },
    ],
  },
];

export const kaminoPlugin: DefiPlugin = {
  id: 'kamino',
  name: 'Kamino Lend',
  createCommand() {
    const cmd = new Command('kamino')
      .description('Kamino Lend — deposit, withdraw, yield status');

    cmd.addCommand(createKaminoReservesCommand());
    cmd.addCommand(createKaminoDepositCommand());
    cmd.addCommand(createKaminoWithdrawCommand());
    cmd.addCommand(createKaminoStatusCommand());

    return cmd;
  },
  capabilities,
};
