import { Command } from 'commander';
import type { GlobalOptions } from '../../../core/types.js';
import { emitNotImplemented } from '../formatters.js';

export function createEventCommand(): Command {
  const cmd = new Command('event').description('Polymarket events (list / detail / search)');

  cmd
    .command('list')
    .description('List active tradable events under a category')
    .requiredOption('--category-id <id>', 'Byreal category id')
    .option('--limit <n>', 'Max events (default 10)')
    .action((_options, cmdObj: Command) => {
      const { output } = cmdObj.optsWithGlobals() as GlobalOptions;
      emitNotImplemented(output, 'event list');
    });

  cmd
    .command('detail')
    .description('Event detail (compact/full, neg-risk aware)')
    .requiredOption('--event-id <id>', 'Event id')
    .option('--market-id <id>', 'Expand a single market (returns related_markets)')
    .option('--full', 'Return all tradable markets (detail_level=full)')
    .action((_options, cmdObj: Command) => {
      const { output } = cmdObj.optsWithGlobals() as GlobalOptions;
      emitNotImplemented(output, 'event detail');
    });

  cmd
    .command('search')
    .description('Search whitelisted events by title-like query')
    .requiredOption('--query <q>', 'Title-like English query (rewritten by Skill)')
    .option('--limit <n>', 'Max candidates (default 10)')
    .action((_options, cmdObj: Command) => {
      const { output } = cmdObj.optsWithGlobals() as GlobalOptions;
      emitNotImplemented(output, 'event search');
    });

  return cmd;
}
