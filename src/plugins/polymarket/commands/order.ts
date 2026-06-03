import { Command } from 'commander';
import type { GlobalOptions } from '../../../core/types.js';
import { emitNotImplemented } from '../formatters.js';

export function createOrderCommand(): Command {
  const cmd = new Command('order').description('Polymarket orders (preview; place/cancel are Phase B)');

  cmd
    .command('preview')
    .description('Local order preview: book-sweep worstPrice + freshness snapshot (dry-run only)')
    .requiredOption('--token-id <id>', 'CLOB outcome token id (asset_id)')
    .requiredOption('--side <side>', 'buy | sell')
    .option('--amount <usd>', 'BUY: USD to spend (market order)')
    .option('--size <shares>', 'SELL: shares to sell, or limit order size')
    .option('--order-type <type>', 'market (FOK) | limit (GTC/GTD)', 'market')
    .option('--price <p>', 'Limit price (limit orders only)')
    .option('--condition-id <id>', 'Market conditionId (resolves tickSize/negRisk)')
    .option('--slippage-bps <bps>', 'Market slippage tolerance (absolute Δ; default 100 = 0.01)')
    .action((_options, cmdObj: Command) => {
      const { output } = cmdObj.optsWithGlobals() as GlobalOptions;
      emitNotImplemented(output, 'order preview');
    });

  return cmd;
}
