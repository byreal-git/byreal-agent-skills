import { Command } from 'commander';
import type { GlobalOptions } from '../../../core/types.js';
import { positionNotFoundError } from '../../../core/errors.js';
import { getPositions, getValue } from '../api/data.js';
import { getBalanceAllowance } from '../api/clob-account.js';
import { getActiveOrders } from '../api/order.js';
import { getEvmPrivyContext } from '../../../privy/execute.js';
import { resolveProxy } from '../account.js';
import { buildPortfolio, type PortfolioL2 } from '../lib/portfolio-view.js';
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

      // L2 (best-effort): cash (balance-allowance) + active orders — only when the
      // agent token is configured. Without it, fall back to the public-only view.
      let l2: PortfolioL2 | undefined;
      const ctx = getEvmPrivyContext(options.evmWalletAddress);
      if (ctx) {
        const auth = { token: ctx.token, evmAddress: ctx.address };
        const [baR, ordersR] = await Promise.all([
          getBalanceAllowance('COLLATERAL', undefined, auth),
          getActiveOrders({}, auth),
        ]);
        l2 = {
          cashRaw: baR.ok ? baR.value.balance : null,
          activeOrders: ordersR.ok ? ordersR.value : [],
        };
      }

      const portfolio = buildPortfolio(
        posR.value,
        value,
        { proxyAddress, proxyStatus: status, positionId: options.positionId },
        l2,
      );

      if (options.positionId && portfolio.positions.length === 0) {
        outputPmError(output, positionNotFoundError(options.positionId));
      }

      outputPmSuccess(output, portfolio, renderPortfolio, startTime);
    });

  return cmd;
}
