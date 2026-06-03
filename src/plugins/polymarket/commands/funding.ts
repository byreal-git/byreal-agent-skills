import { Command } from 'commander';
import type { GlobalOptions } from '../../../core/types.js';
import { validationError } from '../../../core/errors.js';
import { getValue } from '../api/data.js';
import { getSupportedAssets, getQuote, getDepositAddress, getOrders } from '../api/bridge.js';
import { resolveProxy } from '../account.js';
import { buildFundingBalance } from '../lib/portfolio-view.js';
import {
  findUsdc,
  buildDepositPreview,
  buildWithdrawPreview,
  buildTransferStatus,
} from '../lib/funding-view.js';
import {
  outputPmError,
  outputPmSuccess,
  renderFundingBalance,
  renderDepositPreview,
  renderWithdrawPreview,
  renderTransferStatus,
} from '../formatters.js';

// Bridge chain ids + token addresses (P0: Solana USDC ⇄ Polygon pUSD).
const SOLANA_BRIDGE_CHAIN_ID = '1151111081099710';
const POLYGON_CHAIN_ID = '137';
const USDC_SOLANA_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const PUSD_POLYGON = '0xC011a73ee8576Fb46F5E1c5751cA3B9Fe0af2a6F';

export function createFundingCommand(): Command {
  const cmd = new Command('funding').description('Polymarket funding (deposit / withdraw / status)');

  cmd
    .command('balance')
    .description('Read Polymarket available balance (public parts)')
    .option('--evm-wallet-address <addr>', 'EVM EOA (defaults to realclaw-config evm wallet)')
    .action(async (options, cmdObj: Command) => {
      const { output } = cmdObj.optsWithGlobals() as GlobalOptions;
      const startTime = Date.now();

      const proxyR = await resolveProxy(options.evmWalletAddress);
      if (!proxyR.ok) outputPmError(output, proxyR.error);
      const { proxyAddress } = proxyR.value;

      const valR = await getValue(proxyAddress);
      const value = valR.ok ? valR.value : null;
      outputPmSuccess(output, buildFundingBalance(value, proxyAddress), renderFundingBalance, startTime);
    });

  cmd
    .command('deposit-preview')
    .description('Preview a Solana USDC → Polymarket deposit (read-only; submit is Phase B)')
    .requiredOption('--amount <amount>', 'Amount in USDC (UI)')
    .option('--evm-wallet-address <addr>', 'EVM EOA (proxy wallet target)')
    .action(async (options, cmdObj: Command) => {
      const { output } = cmdObj.optsWithGlobals() as GlobalOptions;
      const startTime = Date.now();

      const proxyR = await resolveProxy(options.evmWalletAddress);
      if (!proxyR.ok) outputPmError(output, proxyR.error);
      const { proxyAddress } = proxyR.value;

      const assetsR = await getSupportedAssets();
      if (!assetsR.ok) outputPmError(output, assetsR.error);
      const asset = findUsdc(assetsR.value);

      // Quote + deposit address are best-effort (need a live funded flow).
      const [quoteR, addrR] = await Promise.all([
        getQuote({
          fromChainId: SOLANA_BRIDGE_CHAIN_ID,
          fromTokenAddress: USDC_SOLANA_MINT,
          toChainId: POLYGON_CHAIN_ID,
          toTokenAddress: PUSD_POLYGON,
          amount: options.amount,
          recipientAddress: proxyAddress,
        }),
        getDepositAddress({
          walletAddress: proxyAddress,
          fromChainId: SOLANA_BRIDGE_CHAIN_ID,
          fromTokenAddress: USDC_SOLANA_MINT,
        }),
      ]);

      outputPmSuccess(
        output,
        buildDepositPreview({
          amount: options.amount,
          asset,
          quote: quoteR.ok ? quoteR.value : null,
          depositAddress: addrR.ok ? addrR.value.depositAddress : null,
          proxyAddress,
        }),
        renderDepositPreview,
        startTime,
      );
    });

  cmd
    .command('withdraw-preview')
    .description('Preview a Polymarket → Solana USDC withdraw (read-only; submit is Phase B)')
    .requiredOption('--amount <amount>', 'Amount in USDC (UI)')
    .requiredOption('--recipient <solanaAddress>', 'Destination Solana wallet')
    .option('--evm-wallet-address <addr>', 'EVM EOA (proxy wallet source)')
    .action(async (options, cmdObj: Command) => {
      const { output } = cmdObj.optsWithGlobals() as GlobalOptions;
      const startTime = Date.now();

      const proxyR = await resolveProxy(options.evmWalletAddress);
      if (!proxyR.ok) outputPmError(output, proxyR.error);
      const { proxyAddress } = proxyR.value;

      const assetsR = await getSupportedAssets();
      if (!assetsR.ok) outputPmError(output, assetsR.error);
      const asset = findUsdc(assetsR.value);

      const quoteR = await getQuote({
        fromChainId: POLYGON_CHAIN_ID,
        fromTokenAddress: PUSD_POLYGON,
        toChainId: SOLANA_BRIDGE_CHAIN_ID,
        toTokenAddress: USDC_SOLANA_MINT,
        amount: options.amount,
        recipientAddress: options.recipient,
      });

      outputPmSuccess(
        output,
        buildWithdrawPreview({
          amount: options.amount,
          asset,
          quote: quoteR.ok ? quoteR.value : null,
          recipientSolana: options.recipient,
          proxyAddress,
        }),
        renderWithdrawPreview,
        startTime,
      );
    });

  cmd
    .command('status')
    .description('Read deposit/withdraw transfer status (transfer.status)')
    .requiredOption('--type <type>', 'deposit | withdraw')
    .option('--order-id <id>', 'Bridge order id (optional)')
    .option('--evm-wallet-address <addr>', 'EVM EOA / proxy wallet')
    .action(async (options, cmdObj: Command) => {
      const { output } = cmdObj.optsWithGlobals() as GlobalOptions;
      const startTime = Date.now();

      const type = String(options.type).toLowerCase();
      if (type !== 'deposit' && type !== 'withdraw') {
        outputPmError(output, validationError('--type must be deposit or withdraw', 'type'));
      }

      const proxyR = await resolveProxy(options.evmWalletAddress);
      if (!proxyR.ok) outputPmError(output, proxyR.error);
      const { proxyAddress } = proxyR.value;

      const ordersR = await getOrders({
        walletAddress: proxyAddress,
        type,
        orderId: options.orderId,
      });
      if (!ordersR.ok) outputPmError(output, ordersR.error);

      outputPmSuccess(output, buildTransferStatus(type, ordersR.value), renderTransferStatus, startTime);
    });

  return cmd;
}
