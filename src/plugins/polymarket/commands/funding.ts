import { Command } from 'commander';
import Decimal from 'decimal.js';
import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import type { GlobalOptions } from '../../../core/types.js';
import { validationError, sourceUnavailableError, type ByrealError } from '../../../core/errors.js';
import { safeResolveExecutionMode } from '../../../cli/output/formatters.js';
import { printDryRunBanner, printPrivySignBanner } from '../../../core/confirm.js';
import { getConnection } from '../../../core/solana.js';
import { getPrivyContext, requireEvmPrivyContext, privySignMany } from '../../../privy/execute.js';
import { loadRealclawConfig } from '../../../privy/config.js';
import { getValue } from '../api/data.js';
import {
  getSupportedAssets,
  getQuote,
  getDepositAddress,
  getOrders,
  submitDeposit,
} from '../api/bridge.js';
import { resolveProxy } from '../account.js';
import { buildUnsignedSplTransfer } from '../lib/deposit-tx.js';
import { isBridgeTerminal, isBridgeSuccess } from '../lib/bridge-terminal.js';
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
  renderDepositResult,
} from '../formatters.js';

// Bridge chain ids + token addresses (P0: Solana USDC ⇄ Polygon pUSD).
const SOLANA_BRIDGE_CHAIN_ID = '1151111081099710';
const POLYGON_CHAIN_ID = '137';
const USDC_SOLANA_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
// Polygon-side bridge token is USDC.e (the frontend prices/bridges via this; docs/05 §2
// "USDC.e 怪异点"). The earlier pUSD address (0xC011…) makes /bridge/quote 500.
const USDC_E_POLYGON = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';

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
          toTokenAddress: USDC_E_POLYGON,
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
    .command('deposit')
    .description('Deposit Solana USDC → Polymarket: build SPL transfer → Privy sign → submit → poll')
    .requiredOption('--amount <amount>', 'Amount in USDC (UI)')
    .option('--evm-wallet-address <addr>', 'EVM EOA (proxy wallet target)')
    .option('--execute', 'Sign + submit the deposit (real on-chain transfer)')
    .option('--dry-run', 'Preview quote + deposit address only; no tx built')
    .action(async (options, cmdObj: Command) => {
      const globals = cmdObj.optsWithGlobals() as GlobalOptions & { walletAddress?: string };
      const { output } = globals;
      const startTime = Date.now();
      const mode = safeResolveExecutionMode(options, output);

      // proxy (recipient on Polygon) + EOA (for write auth)
      const proxyR = await resolveProxy(options.evmWalletAddress);
      if (!proxyR.ok) outputPmError(output, proxyR.error);
      const { proxyAddress } = proxyR.value;

      const assetsR = await getSupportedAssets();
      if (!assetsR.ok) outputPmError(output, assetsR.error);
      const asset = findUsdc(assetsR.value);
      if (!asset) outputPmError(output, sourceUnavailableError('USDC not in bridge supported-assets'));
      const decimals = asset.decimals ?? 6;
      const minDep = asset.minDepositAmount ? new Decimal(asset.minDepositAmount) : null;
      if (minDep && new Decimal(options.amount).lt(minDep)) {
        outputPmError(output, validationError(`amount ${options.amount} below min deposit ${minDep.toString()}`, 'amount'));
      }

      // quote (→ quoteId) + Solana intermediary deposit address
      const [quoteR, addrR] = await Promise.all([
        getQuote({
          fromChainId: SOLANA_BRIDGE_CHAIN_ID,
          fromTokenAddress: USDC_SOLANA_MINT,
          toChainId: POLYGON_CHAIN_ID,
          toTokenAddress: USDC_E_POLYGON,
          amount: options.amount,
          recipientAddress: proxyAddress,
        }),
        getDepositAddress({
          walletAddress: proxyAddress,
          fromChainId: SOLANA_BRIDGE_CHAIN_ID,
          fromTokenAddress: USDC_SOLANA_MINT,
        }),
      ]);
      if (!quoteR.ok) outputPmError(output, quoteR.error);
      if (!addrR.ok) outputPmError(output, addrR.error);
      const quote = quoteR.value;
      const depositAddress = addrR.value.depositAddress;

      if (mode === 'dry-run') {
        printDryRunBanner();
        outputPmSuccess(
          output,
          {
            mode: 'dry-run',
            amount: options.amount,
            from: 'solana USDC',
            to_proxy: proxyAddress,
            deposit_address: depositAddress,
            quote_id: quote.quoteId,
            to_amount: quote.toAmount,
            min_deposit: asset.minDepositAmount,
          },
          renderDepositResult,
          startTime,
        );
        return;
      }

      // Solana source wallet (signer) — global --wallet-address or config solana wallet
      const solAddr =
        globals.walletAddress ??
        loadRealclawConfig()?.wallets?.find((w) => w.type === 'solana')?.address;
      if (!solAddr) {
        outputPmError(output, validationError('No Solana wallet. Pass --wallet-address or configure a type:"solana" wallet', 'wallet-address'));
        return;
      }

      // Build the unsigned SPL transfer (blockhash + recipient ATA checked on-chain)
      const conn = getConnection();
      const mint = new PublicKey(USDC_SOLANA_MINT);
      const toAta = getAssociatedTokenAddressSync(mint, new PublicKey(depositAddress), true);
      const [bh, toAtaInfo] = await Promise.all([
        conn.getLatestBlockhash('confirmed'),
        conn.getAccountInfo(toAta),
      ]);
      const amountRaw = new Decimal(options.amount).mul(new Decimal(10).pow(decimals)).toFixed(0);
      const unsignedTx = buildUnsignedSplTransfer({
        fromOwner: solAddr,
        depositOwner: depositAddress,
        mint: USDC_SOLANA_MINT,
        amountRaw,
        decimals,
        blockhash: bh.blockhash,
        recipientAtaExists: toAtaInfo !== null,
      });

      const submitBody = {
        quoteId: quote.quoteId,
        signedTransaction: '', // filled after signing (execute) — placeholder for unsigned-tx echo
        fromChainId: SOLANA_BRIDGE_CHAIN_ID,
        fromTokenAddress: USDC_SOLANA_MINT,
        toChainId: POLYGON_CHAIN_ID,
        toTokenAddress: USDC_E_POLYGON,
        amount: options.amount,
        recipientAddress: proxyAddress,
        depositAddress,
      };

      if (mode === 'unsigned-tx') {
        outputPmSuccess(
          output,
          {
            unsignedTransactions: [unsignedTx],
            submit_request: submitBody,
            submitHint: 'Sign the Solana tx (Privy/external), set signedTransaction, then POST /bridge/deposit/submit. Use --execute for the full flow.',
          },
          () => console.error('[unsigned-tx] Solana deposit tx emitted; use -o json for the payload.'),
          startTime,
        );
        return;
      }

      // execute: sign Solana tx (no broadcast) → submit (backend broadcasts) → poll
      printPrivySignBanner();
      let evmAuth: { token: string; evmAddress: string };
      try {
        const evmCtx = requireEvmPrivyContext(options.evmWalletAddress);
        evmAuth = { token: evmCtx.token, evmAddress: evmCtx.address };
      } catch (e) {
        outputPmError(output, e as ByrealError);
        return;
      }
      const solCtx = getPrivyContext(solAddr);
      if (!solCtx) {
        outputPmError(output, validationError('No Privy context for the Solana wallet', 'wallet-address'));
        return;
      }
      const signedR = await privySignMany(solCtx, [unsignedTx]);
      if (!signedR.ok) outputPmError(output, signedR.error);
      const signedTx = signedR.value.signedTxs[0].signedTx;

      const subR = await submitDeposit({ ...submitBody, signedTransaction: signedTx }, evmAuth);
      if (!subR.ok) outputPmError(output, subR.error);
      const orderId = subR.value.orderId;

      // poll 3s × ≤30s → terminal or pending
      let order = subR.value;
      const deadline = Date.now() + 30_000;
      while (orderId && !isBridgeTerminal(order) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 3000));
        const pollR = await getOrders({ walletAddress: proxyAddress, type: 'deposit', orderId });
        if (pollR.ok) {
          const found = pollR.value.find((o) => o.orderId === orderId) ?? pollR.value[0];
          if (found) order = found;
        }
      }

      outputPmSuccess(
        output,
        {
          order_id: orderId ?? null,
          status: order.status ?? order.bridgeStatus ?? null,
          terminal: isBridgeTerminal(order),
          success: isBridgeSuccess(order),
          outcome: isBridgeTerminal(order) ? (isBridgeSuccess(order) ? 'completed' : 'failed') : 'pending',
          amount: options.amount,
          to_proxy: proxyAddress,
          deposit_address: depositAddress,
          quote_id: quote.quoteId,
          tx_hash: order.txHash ?? null,
        },
        renderDepositResult,
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
        fromTokenAddress: USDC_E_POLYGON,
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
