/**
 * Terminal-state logic for order polling (docs/03, docs/06 C9).
 *
 * ⚠️ For MARKET orders, `live`/`delayed` = NON-terminal (keep polling); every
 * other status (incl. `matched`) = terminal. For LIMIT orders, HTTP 200 with
 * `live` = terminal (the order was accepted; no settlement poll). Do not confuse
 * the two — market `live` ≠ limit `live`.
 */
import type { OpenOrder } from '../types.js';

const MARKET_NON_TERMINAL = new Set(['live', 'delayed']);

export function isTerminalStatus(status: string, kind: 'market' | 'limit'): boolean {
  // Limit: acceptance (HTTP 200 + live) is the terminal state — no settlement poll.
  if (kind === 'limit') return true;
  const s = (status ?? '').toLowerCase();
  return !MARKET_NON_TERMINAL.has(s);
}

export interface PollClassification {
  outcome: 'settled' | 'pending' | 'continue';
  order: OpenOrder;
}

/**
 * Classify a single market poll result:
 *  - terminal status         → settled
 *  - non-terminal + timedOut → pending (don't fail; user re-checks via order status)
 *  - non-terminal + time left → continue (poll again)
 */
export function classifyPoll(order: OpenOrder, timedOut: boolean): PollClassification {
  if (isTerminalStatus(order.status ?? '', 'market')) return { outcome: 'settled', order };
  if (timedOut) return { outcome: 'pending', order };
  return { outcome: 'continue', order };
}
