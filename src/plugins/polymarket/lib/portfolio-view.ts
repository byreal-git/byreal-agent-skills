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

import type { DataPosition, DataValue } from '../api/data.js';

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
  active_orders: unknown[]; // L2 → Phase B
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

function mapPosition(p: DataPosition): PortfolioPosition {
  const size = num(p.size) ?? '0';
  return {
    position_id: p.asset ?? '',
    condition_id: p.conditionId ?? null,
    event_title: p.title ?? null,
    market_title: p.title ?? null,
    outcome_label: p.outcome ?? null,
    size,
    // Phase A: sellable = size. Phase B deducts size locked in active sell orders.
    sellable_size: size,
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

export function buildPortfolio(
  positions: DataPosition[],
  valueRaw: DataValue | DataValue[] | null,
  opts: BuildPortfolioOptions,
): Portfolio {
  let mapped = positions.map(mapPosition);
  if (opts.positionId) mapped = mapped.filter((p) => p.position_id === opts.positionId);

  const pnlSum = positions.reduce((acc, p) => acc + (Number(p.cashPnl) || 0), 0);
  const value = normalizeValue(valueRaw);

  return {
    account: {
      proxy_wallet_status: opts.proxyStatus ?? 'available',
      proxy_wallet: opts.proxyAddress,
    },
    summary: {
      current_value_usd: value === null ? null : String(value),
      cash_available_usdc: null, // L2 → Phase B
      // Position-sum approximation; the official user-level aggregate is Phase B.
      pnl_usd: positions.length > 0 ? String(Number(pnlSum.toFixed(6))) : null,
      pnl_percent: null, // no clean denominator → null (PRD §4.1)
    },
    positions: mapped,
    active_orders: [], // L2 → Phase B
    partial: true,
    partial_reason: 'cash_available_usdc and active_orders require CLOB L2 auth (Phase B)',
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
): FundingBalance {
  const value = normalizeValue(valueRaw);
  return {
    proxy_wallet: proxyAddress,
    current_value_usd: value === null ? null : String(value),
    cash_available_usdc: null,
    partial: true,
  };
}
