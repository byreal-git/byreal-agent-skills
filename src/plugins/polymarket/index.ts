/**
 * Polymarket plugin — Phase A (auth-free reads + local previews).
 *
 * Command tree: byreal-cli polymarket <category|event|portfolio|funding|order>
 * See docs/polymarket-cli/06-cli-development-plan.md and
 * docs/polymarket-cli/07-phase-a-implementation-and-test.md.
 *
 * Capabilities are filled in as each command lands (C2–C5); the catalog merges
 * them at runtime via getAllCapabilities().
 */

import { Command } from 'commander';
import type { DefiPlugin, Capability } from '../types.js';
import { createCategoryCommand } from './commands/category.js';
import { createEventCommand } from './commands/event.js';
import { createPortfolioCommand } from './commands/portfolio.js';
import { createFundingCommand } from './commands/funding.js';
import { createOrderCommand } from './commands/order.js';

const capabilities: Capability[] = [
  {
    id: 'pm.category.list',
    name: 'Polymarket Category List',
    description: 'List Byreal-configured Polymarket categories and their market types',
    category: 'query',
    auth_required: false,
    command: 'byreal-cli polymarket category list',
    params: [],
  },
  {
    id: 'pm.event.list',
    name: 'Polymarket Event List',
    description: 'List active tradable events under a category (volume_desc)',
    category: 'query',
    auth_required: false,
    command: 'byreal-cli polymarket event list --category-id <id>',
    params: [
      { name: 'category-id', type: 'string', required: true, description: 'Byreal category id' },
      { name: 'limit', type: 'integer', required: false, description: 'Max events (default 10)' },
    ],
  },
  {
    id: 'pm.event.detail',
    name: 'Polymarket Event Detail',
    description: 'Event detail (compact/full, neg-risk aware, related_markets)',
    category: 'query',
    auth_required: false,
    command: 'byreal-cli polymarket event detail --event-id <id>',
    params: [
      { name: 'event-id', type: 'string', required: true, description: 'Event id' },
      { name: 'market-id', type: 'string', required: false, description: 'Expand a single market' },
      { name: 'full', type: 'boolean', required: false, description: 'Return all tradable markets' },
      { name: 'compact-markets', type: 'integer', required: false, description: 'Compact top-N (default 5)' },
    ],
  },
  {
    id: 'pm.event.search',
    name: 'Polymarket Event Search',
    description: 'Search whitelisted events by title-like query (Gamma public-search ∩ whitelist)',
    category: 'query',
    auth_required: false,
    command: 'byreal-cli polymarket event search --query <q>',
    params: [
      { name: 'query', type: 'string', required: true, description: 'Title-like English query (rewritten by Skill)' },
      { name: 'limit', type: 'integer', required: false, description: 'Max candidates (default 10)' },
      { name: 'refresh-whitelist', type: 'boolean', required: false, description: 'Force-rebuild the whitelist cache' },
    ],
  },
  {
    id: 'pm.portfolio.read',
    name: 'Polymarket Portfolio Read',
    description: 'Read positions / value / pnl (public parts; L2 cash/orders are Phase B)',
    category: 'query',
    auth_required: false,
    command: 'byreal-cli polymarket portfolio read --evm-wallet-address <addr>',
    params: [
      { name: 'evm-wallet-address', type: 'string', required: false, description: 'EVM EOA (defaults to realclaw-config evm wallet)' },
      { name: 'position-id', type: 'string', required: false, description: 'Read a single position (token id)' },
      { name: 'category-id', type: 'string', required: false, description: 'Filter by category (Phase B routing)' },
    ],
  },
  {
    id: 'pm.funding.balance',
    name: 'Polymarket Funding Balance',
    description: 'Read Polymarket available balance (public parts)',
    category: 'query',
    auth_required: false,
    command: 'byreal-cli polymarket funding balance --evm-wallet-address <addr>',
    params: [
      { name: 'evm-wallet-address', type: 'string', required: false, description: 'EVM EOA (defaults to realclaw-config evm wallet)' },
    ],
  },
];

export const polymarketPlugin: DefiPlugin = {
  id: 'polymarket',
  name: 'Polymarket',
  createCommand() {
    const cmd = new Command('polymarket').description(
      'Polymarket prediction markets — discover, preview, fund (Phase A)',
    );
    cmd.addCommand(createCategoryCommand());
    cmd.addCommand(createEventCommand());
    cmd.addCommand(createPortfolioCommand());
    cmd.addCommand(createFundingCommand());
    cmd.addCommand(createOrderCommand());
    return cmd;
  },
  capabilities,
};
