import { Command } from 'commander';
import Decimal from 'decimal.js';
import type { GlobalOptions } from '../../../core/types.js';
import {
  validationError,
  previewExpiredError,
  tradingNotReadyError,
  type ByrealError,
} from '../../../core/errors.js';
import { safeResolveExecutionMode } from '../../../cli/output/formatters.js';
import { printDryRunBanner, printPrivySignBanner } from '../../../core/confirm.js';
import {
  getEvmPrivyContext,
  requireEvmPrivyContext,
  privySignEvmTypedData,
} from '../../../privy/execute.js';
import { getBook } from '../api/clob.js';
import { encodeOrder } from '../api/market.js';
import {
  submitOrder,
  getOrderStatus,
  getActiveOrders,
  cancelOrder,
  cancelAll,
  submitLimitKeepalive,
} from '../api/order.js';
import { selectCancelTargets } from '../lib/cancel-view.js';
import { syncBalanceAllowance } from '../api/clob-account.js';
import { buildOrderPreview } from '../lib/order-view.js';
import { validate as validateFreshness, type PreviewSnapshot } from '../lib/freshness.js';
import { extractOrder, toEncodeReq } from '../lib/order-build.js';
import { checkOrderMinimum } from '../lib/order-minimums.js';
import { gatherReadiness } from '../readiness-gather.js';
import { runOrderPlace, type PlaceDeps } from '../order-exec.js';
import { getPmConfig } from '../config.js';
import {
  outputPmError,
  outputPmSuccess,
  renderOrderPreview,
  renderOrderPlace,
  renderActiveOrders,
  renderOrderStatusView,
  renderCancelResult,
} from '../formatters.js';

/** Resolve the EVM write-auth (token + EOA) for L2 order reads/cancels. */
function resolveOrderAuth(
  evmWalletAddress: string | undefined,
): { token: string; evmAddress: string } | { error: ByrealError } {
  try {
    const ctx = requireEvmPrivyContext(evmWalletAddress);
    return { token: ctx.token, evmAddress: ctx.address };
  } catch (e) {
    return { error: e as ByrealError };
  }
}

export function createOrderCommand(): Command {
  const cmd = new Command('order').description('Polymarket orders (preview + place; cancel/active are next milestone)');

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

  cmd
    .command('place')
    .description('Place an order: market (FOK; re-quote→sign→submit→poll) or limit (GTC; resting + keepalive)')
    .requiredOption('--token-id <id>', 'CLOB outcome token id (asset_id)')
    .requiredOption('--side <side>', 'buy | sell')
    .option('--amount <usd>', 'BUY market: USD to spend')
    .option('--size <shares>', 'SELL market, or limit (both sides): shares')
    .option('--price <p>', 'Limit price (limit orders only; 0 < p < 1)')
    .option('--order-type <type>', 'market (FOK) | limit (GTC)', 'market')
    .option('--condition-id <id>', 'Market conditionId (enables readiness market checks)')
    .option('--slippage-bps <bps>', 'Market slippage tolerance (absolute Δ; default 100 = 0.01)')
    .option('--preview <json>', 'Preview snapshot JSON from `order preview` (market freshness/PREVIEW_EXPIRED check)')
    .option('--evm-wallet-address <0x>', 'EVM EOA (defaults to realclaw-config evm wallet)')
    .option('--execute', 'Sign + submit the order via Privy (real on-chain order)')
    .option('--dry-run', 'Preview signed price + readiness only; no encode/sign/submit')
    .action(async (options, cmdObj: Command) => {
      const { output } = cmdObj.optsWithGlobals() as GlobalOptions;
      const startTime = Date.now();
      const mode = safeResolveExecutionMode(options, output);

      const side = String(options.side).toLowerCase();
      if (side !== 'buy' && side !== 'sell') {
        outputPmError(output, validationError('--side must be buy or sell', 'side'));
      }
      const sideUC = side.toUpperCase() as 'BUY' | 'SELL';
      const orderType = String(options.orderType).toLowerCase();
      if (orderType !== 'market' && orderType !== 'limit') {
        outputPmError(output, validationError('--order-type must be market or limit', 'order-type'));
      }
      const kind = orderType === 'limit' ? 'limit' : 'market';

      // input validation per kind
      if (kind === 'market') {
        if (side === 'buy' && !options.amount) {
          outputPmError(output, validationError('market BUY requires --amount (USD)', 'amount'));
        }
        if (side === 'sell' && !options.size) {
          outputPmError(output, validationError('market SELL requires --size (shares)', 'size'));
        }
      } else {
        if (!options.price) outputPmError(output, validationError('limit orders require --price', 'price'));
        if (!options.size) outputPmError(output, validationError('limit orders require --size (shares)', 'size'));
      }

      const pm = getPmConfig(
        options.slippageBps ? { marketSlippageBps: parseInt(options.slippageBps, 10) } : {},
      );

      // ---- price source: market = book-sweep + slippage; limit = user price (tick-aligned) ----
      const bookR = await getBook(options.tokenId);
      if (!bookR.ok) outputPmError(output, bookR.error);
      const previewR = buildOrderPreview({
        tokenId: options.tokenId,
        conditionId: options.conditionId ?? null,
        side: side as 'buy' | 'sell',
        orderType: kind,
        amount: options.amount,
        size: options.size,
        price: options.price,
        slippageBps: pm.marketSlippageBps,
        book: bookR.value,
        nowSec: Math.floor(Date.now() / 1000),
        ttlSec: pm.previewTtlSeconds,
      });
      if (!previewR.ok) outputPmError(output, previewR.error);
      const snap = previewR.value.preview;
      const signedPrice = String(snap.signed_worst_price);
      const freshWorst = snap.book_worst_price;

      // ---- freshness check against a round-tripped preview snapshot (market only) ----
      if (kind === 'market' && options.preview) {
        let prior: PreviewSnapshot;
        try {
          prior = JSON.parse(options.preview) as PreviewSnapshot;
        } catch {
          outputPmError(output, validationError('--preview must be the JSON snapshot from `order preview`', 'preview'));
          return;
        }
        const v = validateFreshness(prior, freshWorst, Math.floor(Date.now() / 1000), pm.previewDriftBps);
        if (!v.ok) outputPmError(output, previewExpiredError(v.reason));
      }

      // encode is amount-based: BUY amount = USD, SELL amount = shares. For a limit
      // BUY the user gives shares (--size) + --price, so USD = size × signed price
      // (encode's BUY branch divides amount/price back to shares). SELL = shares.
      const encOrderType: 'FOK' | 'GTC' = kind === 'limit' ? 'GTC' : 'FOK';
      const orderAmount =
        kind === 'limit'
          ? side === 'buy'
            ? new Decimal(options.size).mul(signedPrice).toString()
            : String(options.size)
          : side === 'buy'
            ? String(options.amount)
            : String(options.size);
      const needAmount = orderAmount;

      // ---- minimum-order pre-check (local; mirrors frontend + book min_order_size)
      //      so dry-run surfaces "too small" with numbers instead of a cryptic
      //      CLOB `invalid taker amount` at execute time. ----
      const minOrderSizeRaw = (bookR.value as { min_order_size?: string | number }).min_order_size;
      const minOrderSize = minOrderSizeRaw !== undefined ? Number(minOrderSizeRaw) : undefined;
      const sharesForCheck =
        side === 'buy' && kind === 'market'
          ? Number(orderAmount) / Number(signedPrice)
          : Number(options.size);
      const notionalForCheck =
        side === 'buy' && kind === 'market'
          ? Number(orderAmount)
          : Number(options.size) * Number(signedPrice);
      const minChk = checkOrderMinimum({
        kind,
        side: sideUC,
        shares: sharesForCheck,
        notionalUsd: notionalForCheck,
        minOrderSize,
      });
      if (!minChk.ok) {
        outputPmError(output, validationError(minChk.reason ?? 'order below minimum', side === 'buy' && kind === 'market' ? 'amount' : 'size'));
      }

      // ---- dry-run: signed price + best-effort readiness, no side effects ----
      if (mode === 'dry-run') {
        printDryRunBanner();
        const ctx = getEvmPrivyContext(options.evmWalletAddress);
        let readiness = null;
        if (ctx) {
          const rr = await gatherReadiness({
            auth: { token: ctx.token, evmAddress: ctx.address },
            tokenId: options.tokenId,
            side: sideUC,
            need: needAmount,
            conditionId: options.conditionId,
          });
          readiness = rr.ok ? rr.value : null;
        }
        const dryView = {
          mode: 'dry-run',
          order_type: encOrderType,
          side: sideUC,
          signed_price: signedPrice,
          amount: orderAmount,
          book_worst_price: freshWorst,
          avg_price: snap.avg_price,
          fully_fills: previewR.value.fully_fills,
          warning: previewR.value.warning,
          readiness,
        };
        outputPmSuccess(output, dryView, renderOrderPlace, startTime);
        return;
      }

      // ---- unsigned-tx + execute both need the agent token (encode needs auth) ----
      let ctx;
      try {
        ctx = requireEvmPrivyContext(options.evmWalletAddress);
      } catch (e) {
        outputPmError(output, e as ByrealError);
        return;
      }
      const auth = { token: ctx.token, evmAddress: ctx.address };

      // ---- unsigned-tx (back-compat): emit the to-sign typed-data + suffix, no sign/submit ----
      if (mode === 'unsigned-tx') {
        const encR = await encodeOrder(
          toEncodeReq({
            walletAddress: ctx.address,
            tokenId: options.tokenId,
            side: sideUC,
            signedPrice,
            amount: orderAmount,
            negRisk: snap.neg_risk,
            orderType: encOrderType,
          }),
          auth,
        );
        if (!encR.ok) outputPmError(output, encR.error);
        outputPmSuccess(
          output,
          {
            typedDataToSign: encR.value.eip712,
            signatureSuffix: encR.value.signatureSuffix,
            order: extractOrder(encR.value),
            orderType: encOrderType,
            submitHint:
              'Polymarket orders sign via Privy (POLY_1271); sign eip712, assemble "0x"+innerSig+suffix, then POST /clob/order' +
              (kind === 'limit'
                ? ' with orderType GTC, then POST /v1/market/limit-order/submit {eoaAddress, orderId} to keep it alive.'
                : '.') +
              ' Use --execute for the full flow.',
          },
          () => {
            // table view is the JSON; unsigned-tx is JSON-oriented
            console.error('[unsigned-tx] typed-data emitted; use -o json for the payload.');
          },
          startTime,
        );
        return;
      }

      // ---- execute: readiness gate → encode → sign → submit → poll/accept ----
      printPrivySignBanner();
      const rr = await gatherReadiness({
        auth,
        tokenId: options.tokenId,
        side: sideUC,
        need: needAmount,
        conditionId: options.conditionId,
      });
      if (!rr.ok) outputPmError(output, rr.error);
      if (!rr.value.ready) {
        outputPmError(output, tradingNotReadyError(rr.value.blocking_reason ?? 'account not ready'));
      }

      const deps: PlaceDeps = {
        encode: (req) => encodeOrder(req, auth),
        sign: (eip712) => privySignEvmTypedData(ctx, eip712),
        submit: (body) => submitOrder(body, auth),
        syncBalance: async (assetType, tokenId) => {
          await syncBalanceAllowance(assetType, tokenId, auth);
        },
        pollOnce: (orderId) => getOrderStatus(orderId, auth),
        sleep: (ms) => new Promise((res) => setTimeout(res, ms)),
        now: () => Date.now(),
        // limit only: register the backend keepalive heartbeat (eoaAddress = EOA,
        // orderId = the CLOB order id). Throwing here is caught by runOrderPlace
        // as best-effort — the order is already accepted.
        registerKeepalive:
          kind === 'limit'
            ? async (orderId) => {
                const r = await submitLimitKeepalive(ctx.address, orderId, auth);
                if (!r.ok) throw r.error;
              }
            : undefined,
      };

      const placeR = await runOrderPlace(
        {
          walletAddress: ctx.address,
          tokenId: options.tokenId,
          side: sideUC,
          signedPrice,
          amount: orderAmount,
          negRisk: snap.neg_risk,
          kind,
        },
        deps,
      );
      if (!placeR.ok) outputPmError(output, placeR.error);

      outputPmSuccess(output, placeR.value, renderOrderPlace, startTime);
    });

  cmd
    .command('active')
    .description('List active (open) orders (L2)')
    .option('--market <conditionId>', 'Filter by market conditionId')
    .option('--asset-id <tokenId>', 'Filter by outcome token id')
    .option('--evm-wallet-address <0x>', 'EVM EOA (defaults to realclaw-config evm wallet)')
    .action(async (options, cmdObj: Command) => {
      const { output } = cmdObj.optsWithGlobals() as GlobalOptions;
      const startTime = Date.now();
      const auth = resolveOrderAuth(options.evmWalletAddress);
      if ('error' in auth) outputPmError(output, auth.error);
      const params: Record<string, string> = {};
      if (options.market) params.market = options.market;
      if (options.assetId) params.asset_id = options.assetId;
      const r = await getActiveOrders(params, auth);
      if (!r.ok) outputPmError(output, r.error);
      outputPmSuccess(output, { orders: r.value }, renderActiveOrders, startTime);
    });

  cmd
    .command('status')
    .description('Read a single order status (L2)')
    .requiredOption('--order-id <id>', 'CLOB order id')
    .option('--evm-wallet-address <0x>', 'EVM EOA (defaults to realclaw-config evm wallet)')
    .action(async (options, cmdObj: Command) => {
      const { output } = cmdObj.optsWithGlobals() as GlobalOptions;
      const startTime = Date.now();
      const auth = resolveOrderAuth(options.evmWalletAddress);
      if ('error' in auth) outputPmError(output, auth.error);
      const r = await getOrderStatus(options.orderId, auth);
      if (!r.ok) outputPmError(output, r.error);
      outputPmSuccess(output, r.value, renderOrderStatusView, startTime);
    });

  cmd
    .command('cancel')
    .description('Cancel open orders: --dry-run previews the target set; --execute cancels')
    .option('--order-id <id>', 'Cancel a specific order id')
    .option('--all', 'Cancel ALL open orders')
    .option('--market <conditionId>', 'Filter target set by market')
    .option('--asset-id <tokenId>', 'Filter target set by outcome token id')
    .option('--evm-wallet-address <0x>', 'EVM EOA (defaults to realclaw-config evm wallet)')
    .option('--execute', 'Cancel the orders (write)')
    .option('--dry-run', 'Preview the orders that would be canceled; no write')
    .action(async (options, cmdObj: Command) => {
      const { output } = cmdObj.optsWithGlobals() as GlobalOptions;
      const startTime = Date.now();
      const mode = safeResolveExecutionMode(options, output);
      const auth = resolveOrderAuth(options.evmWalletAddress);
      if ('error' in auth) outputPmError(output, auth.error);

      // Lock the target set from the current active orders.
      const activeR = await getActiveOrders(
        options.market ? { market: options.market } : {},
        auth,
      );
      if (!activeR.ok) outputPmError(output, activeR.error);
      const targets = selectCancelTargets(activeR.value, {
        orderId: options.orderId,
        market: options.market,
        assetId: options.assetId,
        all: options.all,
      });

      if (mode !== 'execute') {
        if (mode === 'dry-run') printDryRunBanner();
        outputPmSuccess(
          output,
          { mode, targets, count: targets.length },
          renderCancelResult,
          startTime,
        );
        return;
      }

      printPrivySignBanner();
      if (targets.length === 0) {
        outputPmError(output, validationError('no matching open orders to cancel', 'order-id'));
      }

      // --all → /cancel-all; otherwise delete each target id.
      const canceled: string[] = [];
      const failed: Array<{ order_id: string; error: string }> = [];
      if (options.all && !options.orderId) {
        const r = await cancelAll(auth);
        if (!r.ok) outputPmError(output, r.error);
        canceled.push(...(r.value.canceled ?? targets.map((t) => t.order_id)));
        for (const [id, msg] of Object.entries(r.value.not_canceled ?? {})) failed.push({ order_id: id, error: msg });
      } else {
        for (const t of targets) {
          const r = await cancelOrder(t.order_id, auth);
          if (r.ok && !(r.value.not_canceled && r.value.not_canceled[t.order_id])) canceled.push(t.order_id);
          else failed.push({ order_id: t.order_id, error: r.ok ? (r.value.not_canceled?.[t.order_id] ?? 'not canceled') : r.error.message });
        }
      }

      outputPmSuccess(
        output,
        { mode: 'execute', canceled, failed, canceled_count: canceled.length, failed_count: failed.length },
        renderCancelResult,
        startTime,
      );
    });

  return cmd;
}
