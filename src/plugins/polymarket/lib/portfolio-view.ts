/**
 * Pure transforms for portfolio.read + funding.balance (public parts).
 *
 * Phase A returns the data-api-derived fields only: positions/value/pnl keyed
 * by the proxy wallet. The L2 parts (cash_available_usdc, active_orders) need
 * CLOB auth and are deferred to Phase B — marked with `partial: true` and null
 * fields so the Skill layer knows they're not yet populated.
 *
 * Addresses are shown in FULL (CLAUDE.md: never truncate on-chain addresses).
 */

import Decimal from 'decimal.js';
import type { DataPosition, DataValue } from '../api/data.js';
import type { OpenOrder } from '../types.js';

/** USDC raw (1e6) → UI string; null on missing/invalid. */
export function usdcFromRaw(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined || raw === '') return null;
  try {
    return new Decimal(raw).div(1_000_000).toString();
  } catch {
    return null;
  }
}

/** Remaining (unmatched) size of an order. */
function remainingSize(o: OpenOrder): number {
  return (Number(o.original_size) || 0) - (Number(o.size_matched) || 0);
}

/** Shares locked in active SELL orders for an asset_id (reduces sellable_size). */
export function lockedSellSize(activeOrders: OpenOrder[], assetId: string): number {
  return activeOrders
    .filter((o) => o.asset_id === assetId && String(o.side).toUpperCase() === 'SELL')
    .reduce((acc, o) => acc + Math.max(0, remainingSize(o)), 0);
}

export interface ShapedOrder {
  order_id: string;
  market: string | null;
  asset_id: string | null;
  side: string | null;
  price: string | null;
  original_size: string | null;
  size_matched: string | null;
  status: string | null;
}

function shapeOrder(o: OpenOrder): ShapedOrder {
  return {
    order_id: String(o.id ?? ''),
    market: o.market ?? null,
    asset_id: o.asset_id ?? null,
    side: o.side ?? null,
    price: o.price ?? null,
    original_size: o.original_size ?? null,
    size_matched: o.size_matched ?? null,
    status: o.status ?? null,
  };
}

export interface PortfolioPosition {
  position_id: string; // = outcome token id (the sell handle)
  condition_id: string | null;
  event_title: string | null;
  market_title: string | null;
  outcome_label: string | null;
  size: string;
  sellable_size: string;
  avg_price: string | null;
  current_price: string | null;
  initial_value_usd: string | null;
  current_value_usd: string | null;
  cash_pnl_usd: string | null;
  cash_pnl_percent: string | null;
  redeemable: boolean;
  end_date: string | null;
}

export interface Portfolio {
  account: {
    proxy_wallet_status: string;
    proxy_wallet: string; // full address, not truncated
  };
  summary: {
    current_value_usd: string | null;
    cash_available_usdc: string | null; // L2 → Phase B
    pnl_usd: string | null;
    pnl_percent: string | null;
  };
  positions: PortfolioPosition[];
  active_orders: ShapedOrder[];
  partial: boolean;
  partial_reason?: string;
}

function num(v: number | undefined): string | null {
  return v === undefined || v === null || !Number.isFinite(v) ? null : String(v);
}

/** Normalize /value (array or bare object) to a number | null. */
export function normalizeValue(raw: DataValue | DataValue[] | null | undefined): number | null {
  if (!raw) return null;
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v && Number.isFinite(v.value as number) ? (v.value as number) : null;
}

function mapPosition(p: DataPosition, activeOrders?: OpenOrder[]): PortfolioPosition {
  const size = num(p.size) ?? '0';
  // sellable = size − shares locked in active SELL orders for this asset (L2).
  const locked = activeOrders && p.asset ? lockedSellSize(activeOrders, p.asset) : 0;
  const sellable = activeOrders ? String(Math.max(0, (Number(size) || 0) - locked)) : size;
  return {
    position_id: p.asset ?? '',
    condition_id: p.conditionId ?? null,
    event_title: p.title ?? null,
    market_title: p.title ?? null,
    outcome_label: p.outcome ?? null,
    size,
    sellable_size: sellable,
    avg_price: num(p.avgPrice),
    current_price: num(p.curPrice),
    initial_value_usd: num(p.initialValue),
    current_value_usd: num(p.currentValue),
    cash_pnl_usd: num(p.cashPnl),
    cash_pnl_percent: num(p.percentPnl),
    redeemable: p.redeemable === true,
    end_date: p.endDate ?? null,
  };
}

export interface BuildPortfolioOptions {
  proxyAddress: string;
  proxyStatus?: string;
  positionId?: string;
}

/** L2 data (CLOB auth): cash (balance-allowance raw 1e6) + active orders. */
export interface PortfolioL2 {
  cashRaw?: string | null;
  activeOrders?: OpenOrder[];
}

export function buildPortfolio(
  positions: DataPosition[],
  valueRaw: DataValue | DataValue[] | null,
  opts: BuildPortfolioOptions,
  l2?: PortfolioL2,
): Portfolio {
  const active = l2?.activeOrders;
  let mapped = positions.map((p) => mapPosition(p, active));
  if (opts.positionId) mapped = mapped.filter((p) => p.position_id === opts.positionId);

  const pnlSum = positions.reduce((acc, p) => acc + (Number(p.cashPnl) || 0), 0);
  const value = normalizeValue(valueRaw);
  const cash = l2 ? usdcFromRaw(l2.cashRaw) : null;
  const haveL2 = !!l2;

  return {
    account: {
      proxy_wallet_status: opts.proxyStatus ?? 'available',
      proxy_wallet: opts.proxyAddress,
    },
    summary: {
      current_value_usd: value === null ? null : String(value),
      cash_available_usdc: cash,
      // Position-sum approximation; the official user-level aggregate is Phase B.
      pnl_usd: positions.length > 0 ? String(Number(pnlSum.toFixed(6))) : null,
      pnl_percent: null, // no clean denominator → null (PRD §4.1)
    },
    positions: mapped,
    active_orders: active ? active.map(shapeOrder) : [],
    partial: !haveL2,
    partial_reason: haveL2 ? undefined : 'cash_available_usdc and active_orders require CLOB L2 auth (Phase B)',
  };
}

export interface FundingBalance {
  proxy_wallet: string;
  current_value_usd: string | null;
  cash_available_usdc: string | null; // L2 → Phase B
  partial: boolean;
}

export function buildFundingBalance(
  valueRaw: DataValue | DataValue[] | null,
  proxyAddress: string,
  cashRaw?: string | null,
): FundingBalance {
  const value = normalizeValue(valueRaw);
  const hasL2 = cashRaw !== undefined;
  return {
    proxy_wallet: proxyAddress,
    current_value_usd: value === null ? null : String(value),
    cash_available_usdc: hasL2 ? usdcFromRaw(cashRaw) : null,
    partial: !hasL2,
  };
}
