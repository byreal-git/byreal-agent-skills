import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildPortfolio, buildFundingBalance, normalizeValue, usdcFromRaw, lockedSellSize } from './portfolio-view.js';
import type { DataPosition, DataValue } from '../api/data.js';
import type { OpenOrder } from '../types.js';

const FX = path.join(__dirname, '..', '__fixtures__');
function load<T>(name: string): T {
  return JSON.parse(fs.readFileSync(path.join(FX, name), 'utf-8')) as T;
}

describe('normalizeValue', () => {
  it('reads value from an array or bare object', () => {
    expect(normalizeValue([{ value: 39.75 }])).toBe(39.75);
    expect(normalizeValue({ value: 10 })).toBe(10);
    expect(normalizeValue(null)).toBeNull();
    expect(normalizeValue([])).toBeNull();
  });
});

describe('buildPortfolio (hand-authored data-api fixtures)', () => {
  const positions = load<DataPosition[]>('data-positions.json');
  const value = load<DataValue[]>('data-value.json');

  it('maps positions to PRD shape with full (untruncated) addresses', () => {
    const p = buildPortfolio(positions, value, { proxyAddress: '0xPROXY0000000000000000000000000000000001' });
    expect(p.account.proxy_wallet).toBe('0xPROXY0000000000000000000000000000000001'); // full
    expect(p.positions).toHaveLength(2);
    const spurs = p.positions[0];
    expect(spurs.position_id).toBe(positions[0].asset); // = token id (sell handle)
    expect(spurs.outcome_label).toBe('Yes');
    expect(spurs.size).toBe('125');
    expect(spurs.sellable_size).toBe('125'); // Phase A: = size
    expect(spurs.cash_pnl_usd).toBe('3.75');
  });

  it('summary: value from /value, pnl = sum(cashPnl), pnl_percent null, cash null (Phase B)', () => {
    const p = buildPortfolio(positions, value, { proxyAddress: '0xP' });
    expect(p.summary.current_value_usd).toBe('39.75');
    expect(p.summary.pnl_usd).toBe('-0.25'); // 3.75 + (-4.0)
    expect(p.summary.pnl_percent).toBeNull();
    expect(p.summary.cash_available_usdc).toBeNull();
    expect(p.partial).toBe(true);
  });

  it('filters by position_id', () => {
    const target = positions[1].asset!;
    const p = buildPortfolio(positions, value, { proxyAddress: '0xP', positionId: target });
    expect(p.positions).toHaveLength(1);
    expect(p.positions[0].position_id).toBe(target);
  });
});

describe('buildFundingBalance', () => {
  it('returns value + null cash (L2 Phase B)', () => {
    const value = load<DataValue[]>('data-value.json');
    const b = buildFundingBalance(value, '0xPROXY');
    expect(b.current_value_usd).toBe('39.75');
    expect(b.cash_available_usdc).toBeNull();
    expect(b.proxy_wallet).toBe('0xPROXY');
    expect(b.partial).toBe(true);
  });
});

describe('L2 helpers', () => {
  it('usdcFromRaw converts 1e6 units', () => {
    expect(usdcFromRaw('12000000')).toBe('12');
    expect(usdcFromRaw('0')).toBe('0');
    expect(usdcFromRaw(null)).toBeNull();
    expect(usdcFromRaw(undefined)).toBeNull();
  });
  it('lockedSellSize sums remaining SELL size for an asset', () => {
    const orders: OpenOrder[] = [
      { id: 'o1', asset_id: 'a1', side: 'SELL', original_size: '10', size_matched: '3' },
      { id: 'o2', asset_id: 'a1', side: 'BUY', original_size: '5', size_matched: '0' },
      { id: 'o3', asset_id: 'a2', side: 'SELL', original_size: '4', size_matched: '0' },
    ];
    expect(lockedSellSize(orders, 'a1')).toBe(7); // only the SELL on a1, remaining 7
    expect(lockedSellSize(orders, 'a2')).toBe(4);
    expect(lockedSellSize(orders, 'zzz')).toBe(0);
  });
});

describe('buildPortfolio L2', () => {
  const positions: DataPosition[] = [{ asset: 'a1', size: 10, conditionId: 'c1', title: 'M', outcome: 'Yes' }];
  it('without L2 → partial, cash null, sellable=size', () => {
    const p = buildPortfolio(positions, [{ value: 5 }], { proxyAddress: '0xP' });
    expect(p.partial).toBe(true);
    expect(p.summary.cash_available_usdc).toBeNull();
    expect(p.positions[0].sellable_size).toBe('10');
    expect(p.active_orders).toEqual([]);
  });
  it('with L2 → cash populated, active_orders shaped, sellable deducts locked SELL', () => {
    const p = buildPortfolio(positions, [{ value: 5 }], { proxyAddress: '0xP' }, {
      cashRaw: '12000000',
      activeOrders: [{ id: 'o1', asset_id: 'a1', side: 'SELL', original_size: '4', size_matched: '0', price: '0.6' }],
    });
    expect(p.partial).toBe(false);
    expect(p.summary.cash_available_usdc).toBe('12');
    expect(p.positions[0].sellable_size).toBe('6'); // 10 - 4
    expect(p.active_orders.length).toBe(1);
    expect(p.active_orders[0].order_id).toBe('o1');
  });
});

describe('buildFundingBalance L2', () => {
  it('cashRaw provided → cash populated, not partial', () => {
    const b = buildFundingBalance([{ value: 5 }], '0xP', '11500000');
    expect(b.cash_available_usdc).toBe('11.5');
    expect(b.partial).toBe(false);
  });
});
