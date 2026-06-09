import { Command } from 'commander';
import Decimal from 'decimal.js';
import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import type { GlobalOptions } from '../../../core/types.js';
import { validationError, sourceUnavailableError, type ByrealError } from '../../../core/errors.js';
import { safeResolveExecutionMode } from '../../../cli/output/formatters.js';
import { printDryRunBanner, printPrivySignBanner } from '../../../core/confirm.js';
import { getConnection } from '../../../core/solana.js';
import { getPrivyContext, getEvmPrivyContext, requireEvmPrivyContext, privySignMany } from '../../../privy/execute.js';
import { getBalanceAllowance } from '../api/clob-account.js';
import { loadRealclawConfig } from '../../../privy/config.js';
import { getValue } from '../api/data.js';
import {
  getSupportedAssets,
  getQuote,
  getDepositAddress,
  getOrders,
  submitDeposit,
  submitWithdraw,
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
  renderWithdrawResult,
} from '../formatters.js';

// Bridge chain ids + token addresses (P0: Solana USDC ⇄ Polygon pUSD).
const SOLANA_BRIDGE_CHAIN_ID = '1151111081099710';
const POLYGON_CHAIN_ID = '137';
const USDC_SOLANA_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
// DEPOSIT quotes the Polygon side as USDC.e (the frontend prices the inbound leg
// via this; docs/05 §2 "USDC.e 怪异点"). pUSD on the deposit direction makes
// /bridge/quote 500.
const USDC_E_POLYGON = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
// WITHDRAW quotes the Polygon side as pUSD — that is what the proxy actually
// holds, so the quote reflects the real PUSD→USDC conversion (live-verified:
// pUSD → toAmount 0.99, USDC.e → a misleading 1:1). Matches the frontend
// (quote.ts uses assets.polymarket.tokenAddress = pUSD for the withdraw leg).
const PUSD_POLYGON = '0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB';

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

      // L2 cash (best-effort): balance-allowance when the agent token is configured.
      let cashRaw: string | null | undefined;
      const ctx = getEvmPrivyContext(options.evmWalletAddress);
      if (ctx) {
        const baR = await getBalanceAllowance('COLLATERAL', undefined, {
          token: ctx.token,
          evmAddress: ctx.address,
        });
        cashRaw = baR.ok ? baR.value.balance : null;
      }
      outputPmSuccess(output, buildFundingBalance(value, proxyAddress, cashRaw), renderFundingBalance, startTime);
    });

  cmd
    .command('deposit-preview')
    .description('Preview a Solana USDC → Polymarket deposit (read-only; submit via `funding deposit --execute`)')
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

      // Body matches the working frontend request exactly (docs/09): field is
      // `signedTx`, walletAddress=proxy, no toChain/toToken/recipient.
      const submitBody = {
        quoteId: quote.quoteId,
        signedTx: '', // filled after signing (execute) — placeholder for unsigned-tx echo
        walletAddress: proxyAddress, // deposit-wallet lookup key (proxy); omitting → 40904
        fromChainId: SOLANA_BRIDGE_CHAIN_ID,
        fromTokenAddress: USDC_SOLANA_MINT,
        amount: options.amount,
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

      const subR = await submitDeposit({ ...submitBody, signedTx }, evmAuth);
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
          tx_hash: order.txHash ?? order.txSignature ?? null,
        },
        renderDepositResult,
        startTime,
      );
    });

  cmd
    .command('withdraw-preview')
    .description('Preview a Polymarket → Solana USDC withdraw (read-only; submit via `funding withdraw --execute`)')
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
        fromTokenAddress: PUSD_POLYGON, // withdraw source = proxy's pUSD (accurate conversion)
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
    .command('withdraw')
    .description('Withdraw Polymarket (Polygon proxy pUSD) → Solana USDC: quote → backend signs+relays → poll')
    .requiredOption('--amount <amount>', 'Amount in USDC (UI)')
    .requiredOption('--recipient <solanaAddress>', 'Destination Solana wallet (any address — your deposit source or main wallet)')
    .option('--evm-wallet-address <addr>', 'EVM EOA (proxy wallet source)')
    .option('--execute', 'Submit the withdraw (backend signs via Privy + relays; real fund movement)')
    .option('--dry-run', 'Preview quote + min only; no submit')
    .action(async (options, cmdObj: Command) => {
      const { output } = cmdObj.optsWithGlobals() as GlobalOptions;
      const startTime = Date.now();
      const mode = safeResolveExecutionMode(options, output);

      // proxy (Polygon source) — also the deposit-wallet lookup key for submit.
      const proxyR = await resolveProxy(options.evmWalletAddress);
      if (!proxyR.ok) outputPmError(output, proxyR.error);
      const { proxyAddress } = proxyR.value;

      const assetsR = await getSupportedAssets();
      if (!assetsR.ok) outputPmError(output, assetsR.error);
      const asset = findUsdc(assetsR.value);
      if (!asset) outputPmError(output, sourceUnavailableError('USDC not in bridge supported-assets'));
      const minW = asset.minWithdrawAmount ? new Decimal(asset.minWithdrawAmount) : null;
      if (minW && new Decimal(options.amount).lt(minW)) {
        outputPmError(output, validationError(`amount ${options.amount} below min withdraw ${minW.toString()}`, 'amount'));
      }

      // quote: Polygon pUSD (what the proxy holds) → Solana USDC. recipientAddress
      // (quote query param) = the destination Solana address.
      const quoteR = await getQuote({
        fromChainId: POLYGON_CHAIN_ID,
        fromTokenAddress: PUSD_POLYGON,
        toChainId: SOLANA_BRIDGE_CHAIN_ID,
        toTokenAddress: USDC_SOLANA_MINT,
        amount: options.amount,
        recipientAddress: options.recipient,
      });
      if (!quoteR.ok) outputPmError(output, quoteR.error);
      const quote = quoteR.value;

      // submit body — SIGNATURE-FREE (backend encodes→Privy→Relayer). Field is
      // `recipientAddr` (≠ the quote's `recipientAddress`); walletAddress = proxy.
      const submitBody = {
        walletAddress: proxyAddress,
        toChainId: SOLANA_BRIDGE_CHAIN_ID,
        toTokenAddress: USDC_SOLANA_MINT,
        recipientAddr: options.recipient,
        amount: options.amount,
        quoteId: quote.quoteId,
      };

      if (mode === 'dry-run') {
        printDryRunBanner();
        outputPmSuccess(
          output,
          {
            mode: 'dry-run',
            amount: options.amount,
            from_proxy: proxyAddress,
            to_recipient: options.recipient,
            quote_id: quote.quoteId,
            to_amount: quote.toAmount ?? null,
            min_withdraw: asset.minWithdrawAmount,
            note: 'Funds go to --recipient (your explicit target — does NOT auto-return to the deposit source). CLI does not sign withdrawals; the backend signs via Privy + relays.',
          },
          renderWithdrawResult,
          startTime,
        );
        return;
      }

      // unsigned-tx (default, back-compat): no client tx to sign — emit the
      // prepared submit request. Must work WITHOUT an agent token, so this runs
      // BEFORE resolving the EVM Privy context (mirrors `deposit`).
      if (mode === 'unsigned-tx') {
        outputPmSuccess(
          output,
          {
            submit_request: submitBody,
            submitHint:
              'Withdraw is signature-free (backend encodes → Privy signs → Relayer). POST this to /v1/bridge/withdraw/submit with Authorization: Bearer + x-evm-address, or use --execute.',
          },
          () => console.error('[unsigned-tx] withdraw submit request emitted; use -o json for the payload.'),
          startTime,
        );
        return;
      }

      // execute: EOA + agent token for the authenticated, signature-free submit.
      let evmAuth: { token: string; evmAddress: string };
      try {
        const evmCtx = requireEvmPrivyContext(options.evmWalletAddress);
        evmAuth = { token: evmCtx.token, evmAddress: evmCtx.address };
      } catch (e) {
        outputPmError(output, e as ByrealError);
        return;
      }

      // submit (no client signing) → poll 3s × ≤30s → terminal | pending
      printPrivySignBanner();
      const subR = await submitWithdraw(submitBody, evmAuth);
      if (!subR.ok) {
        // The backend signs the withdraw typed-data server-side via Privy. A 40902
        // here is a backend server-side-signing gap for withdraw (NOT a CLI bug;
        // order placement already signs fine) — surface a clear, actionable hint.
        const e = /40902|privy auth/i.test(subR.error.message)
          ? sourceUnavailableError(
              `withdraw rejected by backend (40902 Privy auth): server-side withdraw signing is not yet enabled for the agent token. ` +
                `Order placement signs fine, so this is a backend gap (server-side signing path), not a CLI bug. Original: ${subR.error.message}`,
              false,
            )
          : subR.error;
        outputPmError(output, e);
      }
      const orderId = subR.value.orderId;

      let order = subR.value;
      const deadline = Date.now() + 30_000;
      while (orderId && !isBridgeTerminal(order) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 3000));
        const pollR = await getOrders({ walletAddress: proxyAddress, type: 'withdraw', orderId });
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
          from_proxy: proxyAddress,
          to_recipient: options.recipient,
          quote_id: quote.quoteId,
          tx_hash: order.txHash ?? order.txSignature ?? null,
        },
        renderWithdrawResult,
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
