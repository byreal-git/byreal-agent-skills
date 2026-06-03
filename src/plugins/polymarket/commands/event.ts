import { Command } from 'commander';
import type { GlobalOptions } from '../../../core/types.js';
import {
  noTradableEventsError,
  eventNotFoundError,
  eventNotTradableError,
} from '../../../core/errors.js';
import { getPmData } from '../api/categoy.js';
import { getEvent } from '../api/gamma.js';
import { buildEventList, buildEventDetail } from '../lib/event-view.js';
import { getPmConfig } from '../config.js';
import {
  outputPmError,
  outputPmSuccess,
  renderEventList,
  renderEventDetail,
  emitNotImplemented,
} from '../formatters.js';

export function createEventCommand(): Command {
  const cmd = new Command('event').description('Polymarket events (list / detail / search)');

  cmd
    .command('list')
    .description('List active tradable events under a category')
    .requiredOption('--category-id <id>', 'Byreal category id')
    .option('--limit <n>', 'Max events (default 10)')
    .action(async (options, cmdObj: Command) => {
      const { output } = cmdObj.optsWithGlobals() as GlobalOptions;
      const startTime = Date.now();
      const limit = options.limit ? parseInt(options.limit, 10) : 10;

      const r = await getPmData(options.categoryId, 1, Math.max(limit * 2, 50));
      if (!r.ok) outputPmError(output, r.error);
      const records = r.value.records ?? [];
      if (records.length === 0) outputPmError(output, noTradableEventsError(options.categoryId));

      const category = { category_id: String(options.categoryId) };
      outputPmSuccess(
        output,
        { category, ...buildEventList(records, limit) },
        (d) => renderEventList(d),
        startTime,
      );
    });

  cmd
    .command('detail')
    .description('Event detail (compact/full, neg-risk aware)')
    .requiredOption('--event-id <id>', 'Event id')
    .option('--market-id <id>', 'Expand a single market (returns related_markets)')
    .option('--full', 'Return all tradable markets (detail_level=full)')
    .option('--compact-markets <n>', 'Compact top-N markets (default 5)')
    .action(async (options, cmdObj: Command) => {
      const { output } = cmdObj.optsWithGlobals() as GlobalOptions;
      const startTime = Date.now();
      const pm = getPmConfig(
        options.compactMarkets
          ? { detailCompactMarkets: parseInt(options.compactMarkets, 10) }
          : {},
      );

      const r = await getEvent(options.eventId);
      if (!r.ok) outputPmError(output, r.error);
      if (!r.value || !r.value.id) outputPmError(output, eventNotFoundError(options.eventId));

      const detail = buildEventDetail(r.value, {
        marketId: options.marketId,
        full: !!options.full,
        compactN: pm.detailCompactMarkets,
      });

      // No tradable markets → not tradable.
      if (detail.market_count === 0) {
        outputPmError(output, eventNotTradableError(options.eventId, 'no tradable markets'));
      }
      // Asked for a specific market that wasn't found among tradable markets.
      if (options.marketId && detail.markets_returned === 0) {
        outputPmError(output, eventNotTradableError(options.eventId, `market ${options.marketId} not tradable`));
      }

      outputPmSuccess(output, detail, renderEventDetail, startTime);
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
