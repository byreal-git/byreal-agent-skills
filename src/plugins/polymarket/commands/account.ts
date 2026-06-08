/**
 * polymarket account readiness — pre-trade gate (docs/09 §3).
 * Aggregates proxy READY + balance (BUY/SELL routing) + market booleans via
 * the shared gatherReadiness orchestrator. Needs the agent token (L2 balance).
 */

import { Command } from 'commander';
import type { GlobalOptions } from '../../../core/types.js';
import { validationError, type ByrealError } from '../../../core/errors.js';
import { requireEvmPrivyContext } from '../../../privy/execute.js';
import { gatherReadiness } from '../readiness-gather.js';
import { outputPmError, outputPmSuccess, renderAccountReadiness } from '../formatters.js';

export function createAccountCommand(): Command {
  const cmd = new Command('account').description('Polymarket account readiness (Phase B)');

  cmd
    .command('readiness')
    .description('Check trading readiness: proxy READY + balance + market state')
    .requiredOption('--token-id <id>', 'CLOB outcome token id (asset_id)')
    .requiredOption('--side <side>', 'buy | sell')
    .option('--amount <usd>', 'BUY: USD needed (COLLATERAL)')
    .option('--size <shares>', 'SELL: shares needed (CONDITIONAL)')
    .option('--condition-id <id>', 'Market conditionId (enables market-state checks)')
    .option('--evm-wallet-address <0x>', 'EVM EOA (defaults to realclaw-config evm wallet)')
    .action(async (options, cmdObj: Command) => {
      const { output } = cmdObj.optsWithGlobals() as GlobalOptions;
      const startTime = Date.now();

      const side = String(options.side).toUpperCase();
      if (side !== 'BUY' && side !== 'SELL') {
        outputPmError(output, validationError('--side must be buy or sell', 'side'));
      }

      let auth: { token: string; evmAddress: string };
      try {
        const ctx = requireEvmPrivyContext(options.evmWalletAddress);
        auth = { token: ctx.token, evmAddress: ctx.address };
      } catch (e) {
        outputPmError(output, e as ByrealError);
        return;
      }

      const need = side === 'BUY' ? (options.amount ?? '0') : (options.size ?? '0');
      const r = await gatherReadiness({
        auth,
        tokenId: options.tokenId,
        side: side as 'BUY' | 'SELL',
        need: String(need),
        conditionId: options.conditionId,
      });
      if (!r.ok) outputPmError(output, r.error);

      outputPmSuccess(output, r.value, renderAccountReadiness, startTime);
    });

  return cmd;
}
