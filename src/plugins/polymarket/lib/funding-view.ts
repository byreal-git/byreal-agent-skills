/**
 * Pure transforms for funding transfer.status.
 *
 * Bridge polling timeout returns `pending` (not failure) per docs/03 §5.6.
 */

import type { BridgeSupportedAsset, BridgeOrder } from '../api/bridge.js';

export function findUsdc(assets: BridgeSupportedAsset[]): BridgeSupportedAsset | null {
  return assets.find((a) => (a.symbol ?? '').toUpperCase() === 'USDC') ?? null;
}

export interface TransferStatusItem {
  order_id: string | null;
  type: string | null;
  status: string | null;
  bridge_status: string | null;
  /** Bridge order amount (the list view returns a single `amount`, not from/to). */
  amount: string | null;
  from_chain_id: string | null;
  to_chain_id: string | null;
  tx_hash: string | null;
  created_at: string | null; // ISO 8601
  updated_at: string | null; // ISO 8601
}

const TERMINAL = new Set(['COMPLETED', 'FAILED']);

export interface TransferStatus {
  type: string;
  count: number;
  orders: TransferStatusItem[];
  all_terminal: boolean;
  note: string;
}

export function buildTransferStatus(type: string, orders: BridgeOrder[]): TransferStatus {
  const items: TransferStatusItem[] = orders.map((o) => ({
    order_id: o.orderId ?? null,
    type: o.type ?? null,
    status: o.status ?? null,
    bridge_status: o.bridgeStatus ?? null,
    amount: o.amount ?? null,
    from_chain_id: o.fromChainId ?? null,
    to_chain_id: o.toChainId ?? null,
    tx_hash: o.txHash ?? null,
    created_at: o.createdAt ?? null,
    updated_at: o.updatedAt ?? null,
  }));
  const allTerminal = items.length > 0 && items.every((i) => TERMINAL.has((i.status ?? '').toUpperCase()));
  return {
    type,
    count: items.length,
    orders: items,
    all_terminal: allTerminal,
    note: 'COMPLETED / FAILED are terminal; other states are still in flight — poll /bridge/orders again later.',
  };
}
