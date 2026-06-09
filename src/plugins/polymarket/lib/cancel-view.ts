/**
 * Pure selection/shaping for order cancel (docs/03 cancel flow). cancel.preview
 * locks the set of orders that would be canceled; cancel.execute deletes them.
 */
import type { OpenOrder } from '../types.js';

export interface CancelTarget {
  order_id: string;
  market?: string;
  asset_id?: string;
  side?: string;
  price?: string;
  remaining?: string;
}

export function toCancelTarget(o: OpenOrder): CancelTarget {
  const orig = Number(o.original_size ?? 0);
  const matched = Number(o.size_matched ?? 0);
  const remaining = Number.isFinite(orig - matched) ? String(orig - matched) : undefined;
  return {
    order_id: String(o.id ?? ''),
    market: o.market,
    asset_id: o.asset_id,
    side: o.side,
    price: o.price,
    remaining,
  };
}

export interface CancelSelect {
  orderId?: string;
  market?: string;
  assetId?: string;
  all?: boolean;
}

/**
 * Select cancel targets from the active set:
 *  - orderId → exactly that order (if present)
 *  - all     → every active order
 *  - market/assetId → filter by those
 */
export function selectCancelTargets(active: OpenOrder[], sel: CancelSelect): CancelTarget[] {
  let chosen = active;
  if (sel.orderId) {
    chosen = active.filter((o) => String(o.id) === sel.orderId);
  } else if (!sel.all) {
    if (sel.market) chosen = chosen.filter((o) => o.market === sel.market);
    if (sel.assetId) chosen = chosen.filter((o) => o.asset_id === sel.assetId);
  }
  return chosen.map(toCancelTarget);
}
