import { Command } from 'commander';
import type { GlobalOptions } from '../../../core/types.js';
import { positionNotFoundError } from '../../../core/errors.js';
import { getPositions, getValue } from '../api/data.js';
import { resolveProxy } from '../account.js';
import { buildPortfolio } from '../lib/portfolio-view.js';
import { outputPmError, outputPmSuccess, renderPortfolio } from '../formatters.js';

export function createPortfolioCommand(): Command {
  const cmd = new Command('portfolio').description('Polymarket portfolio');

  cmd
    .command('read')
    .description('Read positions / value / pnl (public parts; L2 cash/orders are Phase B)')
    .option('--evm-wallet-address <addr>', 'EVM EOA (defaults to realclaw-config evm wallet)')
    .option('--category-id <id>', 'Filter positions by category (Phase B routing)')
    .option('--position-id <id>', 'Read a single position (= outcome token id)')
    .action(async (options, cmdObj: Command) => {
      const { output } = cmdObj.optsWithGlobals() as GlobalOptions;
      const startTime = Date.now();

      const proxyR = await resolveProxy(options.evmWalletAddress);
      if (!proxyR.ok) outputPmError(output, proxyR.error);
      const { proxyAddress, status } = proxyR.value;

      const [posR, valR] = await Promise.all([getPositions(proxyAddress), getValue(proxyAddress)]);
      if (!posR.ok) outputPmError(output, posR.error);
      const value = valR.ok ? valR.value : null;

      const portfolio = buildPortfolio(posR.value, value, {
        proxyAddress,
        proxyStatus: status,
        positionId: options.positionId,
      });

      if (options.positionId && portfolio.positions.length === 0) {
        outputPmError(output, positionNotFoundError(options.positionId));
      }

      outputPmSuccess(output, portfolio, renderPortfolio, startTime);
    });

  return cmd;
}
