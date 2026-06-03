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

const capabilities: Capability[] = [];

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
