import { Command } from 'commander';
import type { GlobalOptions } from '../../../core/types.js';
import { validationError } from '../../../core/errors.js';
import { getBook } from '../api/clob.js';
import { buildOrderPreview } from '../lib/order-view.js';
import { getPmConfig } from '../config.js';
import { outputPmError, outputPmSuccess, renderOrderPreview } from '../formatters.js';

export function createOrderCommand(): Command {
  const cmd = new Command('order').description('Polymarket orders (preview; place/cancel are Phase B)');

  cmd
    .command('preview')
    .description('Local order preview: book-sweep worstPrice + freshness snapshot (read-only)')
    .requiredOption('--token-id <id>', 'CLOB outcome token id (asset_id)')
    .requiredOption('--side <side>', 'buy | sell')
    .option('--amount <usd>', 'BUY: USD to spend (market order)')
    .option('--size <shares>', 'SELL: shares to sell, or limit order size')
    .option('--order-type <type>', 'market (FOK) | limit (GTC)', 'market')
    .option('--price <p>', 'Limit price (limit orders only)')
    .option('--condition-id <id>', 'Market conditionId (optional cross-ref)')
    .option('--slippage-bps <bps>', 'Market slippage tolerance (absolute Δ; default 100 = 0.01)')
    .action(async (options, cmdObj: Command) => {
      const { output } = cmdObj.optsWithGlobals() as GlobalOptions;
      const startTime = Date.now();

      const side = String(options.side).toLowerCase();
      if (side !== 'buy' && side !== 'sell') {
        outputPmError(output, validationError('--side must be buy or sell', 'side'));
      }
      const orderType = String(options.orderType).toLowerCase();
      if (orderType !== 'market' && orderType !== 'limit') {
        outputPmError(output, validationError('--order-type must be market or limit', 'order-type'));
      }

      const pm = getPmConfig(
        options.slippageBps ? { marketSlippageBps: parseInt(options.slippageBps, 10) } : {},
      );

      const bookR = await getBook(options.tokenId);
      if (!bookR.ok) outputPmError(output, bookR.error);

      const r = buildOrderPreview({
        tokenId: options.tokenId,
        conditionId: options.conditionId ?? null,
        side: side as 'buy' | 'sell',
        orderType: orderType as 'market' | 'limit',
        amount: options.amount,
        size: options.size,
        price: options.price,
        slippageBps: pm.marketSlippageBps,
        book: bookR.value,
        nowSec: Math.floor(Date.now() / 1000),
        ttlSec: pm.previewTtlSeconds,
      });
      if (!r.ok) outputPmError(output, r.error);

      outputPmSuccess(output, r.value, renderOrderPreview, startTime);
    });

  return cmd;
}
