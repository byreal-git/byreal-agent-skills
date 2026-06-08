/**
 * Pure readiness aggregation (docs/05 二·交易类, docs/09 §3).
 *
 * Checks (no allowance — full-approved at deploy):
 *  - proxy READY  (status === 'READY' AND a proxyAddress we can trust)
 *  - balance      (BUY = COLLATERAL/USDC, SELL = CONDITIONAL/shares)
 *  - market       (active && acceptingOrders && enableOrderBook)
 */
import Decimal from 'decimal.js';
import type { OrderSide, ReadinessVerdict } from '../types.js';

export interface MarketBooleans {
  active?: boolean;
  acceptingOrders?: boolean;
  enableOrderBook?: boolean;
}

export interface ReadinessInput {
  walletStatus: string;
  proxyAddress: string | null;
  balance: string;
  need: string;
  side: OrderSide;
  market: MarketBooleans;
}

export function aggregateReadiness(i: ReadinessInput): ReadinessVerdict {
  const proxyOk = i.walletStatus === 'READY' && !!i.proxyAddress;
  const balOk = new Decimal(i.balance || '0').gte(new Decimal(i.need || '0'));
  const mktOk = !!(i.market.active && i.market.acceptingOrders && i.market.enableOrderBook);

  const asset = i.side === 'BUY' ? 'USDC (COLLATERAL)' : 'shares (CONDITIONAL)';
  const checks: ReadinessVerdict['checks'] = {
    proxy_ready: { ok: proxyOk, detail: `wallet status=${i.walletStatus}` },
    balance: { ok: balOk, detail: `${asset}: have ${i.balance}, need ${i.need}` },
    market: {
      ok: mktOk,
      detail:
        `active=${!!i.market.active} acceptingOrders=${!!i.market.acceptingOrders} ` +
        `enableOrderBook=${!!i.market.enableOrderBook}`,
    },
  };

  const ready = proxyOk && balOk && mktOk;
  const blocking_reason = !proxyOk
    ? 'proxy wallet not READY'
    : !balOk
      ? 'insufficient balance'
      : !mktOk
        ? 'market not tradable'
        : undefined;

  return { ready, checks, proxy_address: i.proxyAddress, blocking_reason };
}
