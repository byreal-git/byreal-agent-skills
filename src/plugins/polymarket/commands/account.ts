/**
 * polymarket account readiness — pre-trade gate.
 * Aggregates proxy READY + balance (BUY/SELL routing) + market booleans via
 * the shared gatherReadiness orchestrator. Needs the agent token (L2 balance).
 */

import { Command } from 'commander';
import type { GlobalOptions } from '../../../core/types.js';
import { validationError, type ByrealError } from '../../../core/errors.js';
import { safeResolveExecutionMode } from '../../../cli/output/formatters.js';
import { requireEvmPrivyContext } from '../../../privy/execute.js';
import { getWalletStatus, deployWallet } from '../api/wallet.js';
import { resolveEoa } from '../account.js';
import { gatherReadiness } from '../readiness-gather.js';
import { printPmDeploySubmitBanner } from '../banner.js';
import {
  outputPmError,
  outputPmSuccess,
  renderAccountReadiness,
  renderWalletDeploy,
} from '../formatters.js';

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

  cmd
    .command('deploy')
    .description('Deploy the Polymarket proxy/deposit wallet (POST /wallet/deploy → poll READY)')
    .option('--evm-wallet-address <0x>', 'EVM EOA (defaults to realclaw-config evm wallet)')
    .option('--execute', 'Trigger the deploy (write); default reports current status only')
    .option('--dry-run', 'Report current wallet status only; no deploy')
    .action(async (options, cmdObj: Command) => {
      const { output } = cmdObj.optsWithGlobals() as GlobalOptions;
      const startTime = Date.now();
      const mode = safeResolveExecutionMode(options, output);

      const eoaR = resolveEoa(options.evmWalletAddress);
      if (!eoaR.ok) outputPmError(output, eoaR.error);
      const eoa = eoaR.value;

      // current status first
      const statusR = await getWalletStatus(eoa);
      const current = statusR.ok ? statusR.value : null;

      if (mode !== 'execute') {
        outputPmSuccess(
          output,
          {
            mode,
            eoa,
            status: current?.status ?? 'UNKNOWN',
            proxy_address: current?.proxyAddress ?? null,
            note: 'pass --execute to trigger /wallet/deploy',
          },
          renderWalletDeploy,
          startTime,
        );
        return;
      }

      printPmDeploySubmitBanner();
      let auth: { token: string; evmAddress: string };
      try {
        const ctx = requireEvmPrivyContext(options.evmWalletAddress);
        auth = { token: ctx.token, evmAddress: ctx.address };
      } catch (e) {
        outputPmError(output, e as ByrealError);
        return;
      }

      const depR = await deployWallet(auth);
      if (!depR.ok) outputPmError(output, depR.error);

      // poll to READY/FAILED (3s × ≤90s)
      const IN_PROGRESS = new Set(['API_KEY_CREATING', 'PROXY_DEPLOYING', 'APPROVING', 'PENDING', 'KEY_CREATING', 'SAFE_DEPLOYING']);
      let status = depR.value.status ?? current?.status ?? 'PROXY_DEPLOYING';
      let proxyAddress = depR.value.proxyAddress ?? current?.proxyAddress ?? null;
      const deadline = Date.now() + 90_000;
      while (IN_PROGRESS.has(String(status).toUpperCase()) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 3000));
        const pollR = await getWalletStatus(eoa);
        if (pollR.ok) {
          status = pollR.value.status ?? status;
          proxyAddress = pollR.value.proxyAddress ?? proxyAddress;
        }
      }

      outputPmSuccess(
        output,
        {
          mode: 'execute',
          eoa,
          status,
          proxy_address: proxyAddress,
          ready: String(status).toUpperCase() === 'READY',
        },
        renderWalletDeploy,
        startTime,
      );
    });

  return cmd;
}
