/**
 * Bridge order terminal-state logic (docs/02 §六, docs/05 §5.6).
 * Business statuses: SIGNED / CONFIRMED / COMPLETED / FAILED; upstream bridge
 * adds DEPOSIT_DETECTED / PROCESSING / … . Terminal = COMPLETED | FAILED on
 * either the business `status` or the upstream `bridgeStatus`. Poll timeout →
 * pending (NOT failure) — the bridge keeps advancing async (re-check via status).
 */

import type { BridgeOrder } from '../api/bridge.js';

const TERMINAL = new Set(['COMPLETED', 'FAILED']);

export function isBridgeTerminal(order: BridgeOrder | undefined): boolean {
  if (!order) return false;
  const s = (order.status ?? '').toUpperCase();
  const b = (order.bridgeStatus ?? '').toUpperCase();
  return TERMINAL.has(s) || TERMINAL.has(b);
}

export function isBridgeSuccess(order: BridgeOrder | undefined): boolean {
  if (!order) return false;
  const s = (order.status ?? '').toUpperCase();
  const b = (order.bridgeStatus ?? '').toUpperCase();
  return s === 'COMPLETED' || b === 'COMPLETED';
}
