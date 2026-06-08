import { Command } from 'commander';
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
import { submitOrder, getOrderStatus } from '../api/order.js';
import { syncBalanceAllowance } from '../api/clob-account.js';
import { buildOrderPreview } from '../lib/order-view.js';
import { validate as validateFreshness, type PreviewSnapshot } from '../lib/freshness.js';
import { extractOrder, toEncodeReq } from '../lib/order-build.js';
import { gatherReadiness } from '../readiness-gather.js';
import { runOrderPlace, type PlaceDeps } from '../order-exec.js';
import { getPmConfig } from '../config.js';
import {
  outputPmError,
  outputPmSuccess,
  renderOrderPreview,
  renderOrderPlace,
} from '../formatters.js';

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
    .description('Place a market (FOK) order: re-quote → Privy sign → submit → terminal poll')
    .requiredOption('--token-id <id>', 'CLOB outcome token id (asset_id)')
    .requiredOption('--side <side>', 'buy | sell')
    .option('--amount <usd>', 'BUY market: USD to spend')
    .option('--size <shares>', 'SELL market: shares to sell')
    .option('--order-type <type>', 'market (FOK) — limit is a later milestone', 'market')
    .option('--condition-id <id>', 'Market conditionId (enables readiness market checks)')
    .option('--slippage-bps <bps>', 'Market slippage tolerance (absolute Δ; default 100 = 0.01)')
    .option('--preview <json>', 'Preview snapshot JSON from `order preview` (freshness/PREVIEW_EXPIRED check)')
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
      if (orderType !== 'market') {
        outputPmError(
          output,
          validationError('order place supports market (FOK) only in this milestone; limit is next', 'order-type'),
        );
      }
      if (side === 'buy' && !options.amount) {
        outputPmError(output, validationError('market BUY requires --amount (USD)', 'amount'));
      }
      if (side === 'sell' && !options.size) {
        outputPmError(output, validationError('market SELL requires --size (shares)', 'size'));
      }

      const pm = getPmConfig(
        options.slippageBps ? { marketSlippageBps: parseInt(options.slippageBps, 10) } : {},
      );

      // ---- re-quote (public): book-sweep → signed worst price ----
      const bookR = await getBook(options.tokenId);
      if (!bookR.ok) outputPmError(output, bookR.error);
      const previewR = buildOrderPreview({
        tokenId: options.tokenId,
        conditionId: options.conditionId ?? null,
        side: side as 'buy' | 'sell',
        orderType: 'market',
        amount: options.amount,
        size: options.size,
        slippageBps: pm.marketSlippageBps,
        book: bookR.value,
        nowSec: Math.floor(Date.now() / 1000),
        ttlSec: pm.previewTtlSeconds,
      });
      if (!previewR.ok) outputPmError(output, previewR.error);
      const snap = previewR.value.preview;
      const signedPrice = String(snap.signed_worst_price);
      const freshWorst = snap.book_worst_price;

      // ---- freshness check against a round-tripped preview snapshot ----
      if (options.preview) {
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

      // encode is amount-based (T11 confirmed): BUY amount = USD, SELL amount = shares.
      const orderAmount = side === 'buy' ? String(options.amount) : String(options.size);
      const needAmount = orderAmount;

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
            orderType: 'FOK',
            submitHint:
              'Polymarket orders sign via Privy (POLY_1271); sign eip712, assemble "0x"+innerSig+suffix, then POST /clob/order. Use --execute for the full flow.',
          },
          () => {
            // table view is the JSON; unsigned-tx is JSON-oriented
            console.error('[unsigned-tx] typed-data emitted; use -o json for the payload.');
          },
          startTime,
        );
        return;
      }

      // ---- execute: readiness gate → encode → sign → submit → poll ----
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
      };

      const placeR = await runOrderPlace(
        {
          walletAddress: ctx.address,
          tokenId: options.tokenId,
          side: sideUC,
          signedPrice,
          amount: orderAmount,
          negRisk: snap.neg_risk,
        },
        deps,
      );
      if (!placeR.ok) outputPmError(output, placeR.error);

      outputPmSuccess(output, placeR.value, renderOrderPlace, startTime);
    });

  return cmd;
}
