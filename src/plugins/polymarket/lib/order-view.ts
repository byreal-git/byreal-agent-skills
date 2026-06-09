/**
 * order.preview core: turn a live book + order params into an immutable preview
 * snapshot (docs/03 §4). Market orders sweep the book for worstPrice and apply
 * the absolute slippage buffer; limit orders echo the user price. Pure (book +
 * clock injected); the command layer fetches the book and prints.
 */

import { ok, err } from '../../../core/types.js';
import type { Result } from '../../../core/types.js';
import type { ByrealError } from '../../../core/errors.js';
import { validationError, sourceUnavailableError } from '../../../core/errors.js';
import type { OrderBook } from '../api/clob.js';
import { sweep } from './book-sweep.js';
import { applySlippage, floorToTick, ceilToTick } from './slippage.js';
import { buildSnapshot, type PreviewSnapshot } from './freshness.js';

export interface OrderPreviewInput {
  tokenId: string;
  conditionId: string | null;
  side: 'buy' | 'sell';
  orderType: 'market' | 'limit';
  amount?: string; // BUY market: USD to spend
  size?: string; // SELL market: shares; limit: order size
  price?: string; // limit price
  slippageBps: number;
  book: OrderBook;
  nowSec: number;
  ttlSec: number;
}

export interface OrderPreview {
  preview: PreviewSnapshot;
  /** Market only: whether the current book can fully fill (FOK would succeed). */
  fully_fills: boolean;
  warning?: string;
}

function bookTick(book: OrderBook): number {
  const t = Number((book as { tick_size?: number | string }).tick_size);
  return Number.isFinite(t) && t > 0 ? t : 0.01;
}

export function buildOrderPreview(input: OrderPreviewInput): Result<OrderPreview, ByrealError> {
  const tickSize = bookTick(input.book);
  const negRisk = (input.book as { neg_risk?: boolean }).neg_risk === true;
  const asks = input.book.asks ?? [];
  const bids = input.book.bids ?? [];

  // ---- limit order: echo user price, no book sweep ----
  if (input.orderType === 'limit') {
    if (!input.price) return err(validationError('Limit orders require --price', 'price'));
    if (!input.size) return err(validationError('Limit orders require --size', 'size'));
    const priceNum = Number(input.price);
    if (!(priceNum > 0 && priceNum < 1)) {
      return err(validationError('Limit price must be 0 < p < 1', 'price'));
    }
    // align to tick: BUY ceil, SELL floor (toward marketable side stays valid)
    const signed = input.side === 'buy' ? ceilToTick(priceNum, tickSize) : floorToTick(priceNum, tickSize);
    const snapshot = buildSnapshot(
      {
        token_id: input.tokenId,
        condition_id: input.conditionId,
        side: input.side,
        order_type: 'GTC',
        amount: null,
        size: input.size,
        tick_size: tickSize,
        neg_risk: negRisk,
        book_worst_price: signed,
        signed_worst_price: signed,
        avg_price: signed,
        fills: [],
        slippage_bps: 0,
      },
      input.nowSec,
      input.ttlSec,
    );
    return ok({ preview: snapshot, fully_fills: true });
  }

  // ---- market order (FOK): sweep book ----
  if (input.side === 'buy') {
    if (!input.amount) return err(validationError('Market BUY requires --amount (USD)', 'amount'));
  } else if (!input.size) {
    return err(validationError('Market SELL requires --size (shares)', 'size'));
  }

  const levels = input.side === 'buy' ? asks : bids;
  if (levels.length === 0) {
    return err(sourceUnavailableError(`empty ${input.side === 'buy' ? 'ask' : 'bid'} book for token ${input.tokenId}`));
  }

  const target = Number(input.side === 'buy' ? input.amount : input.size);
  if (!(target > 0)) return err(validationError('Amount/size must be > 0', 'amount'));

  const swept = sweep(levels, target, input.side === 'buy' ? 'buy-usd' : 'sell-shares');
  if (swept.worstPrice <= 0) {
    return err(sourceUnavailableError(`could not derive a worst price from the book for ${input.tokenId}`));
  }

  const signed = applySlippage({
    worst: swept.worstPrice,
    side: input.side,
    slippageBps: input.slippageBps,
    tickSize,
  });

  const snapshot = buildSnapshot(
    {
      token_id: input.tokenId,
      condition_id: input.conditionId,
      side: input.side,
      order_type: 'FOK',
      amount: input.side === 'buy' ? input.amount ?? null : null,
      size: input.side === 'sell' ? input.size ?? null : null,
      tick_size: tickSize,
      neg_risk: negRisk,
      book_worst_price: swept.worstPrice,
      signed_worst_price: signed,
      avg_price: swept.avgPrice,
      fills: swept.fills,
      slippage_bps: input.slippageBps,
    },
    input.nowSec,
    input.ttlSec,
  );

  return ok({
    preview: snapshot,
    fully_fills: swept.fullyFilled,
    warning: swept.fullyFilled
      ? undefined
      : 'Current book cannot fully fill this size; an FOK order would be rejected. Reduce size or retry.',
  });
}
