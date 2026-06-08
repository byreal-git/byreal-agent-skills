import { describe, it, expect } from 'vitest';
import { selectCancelTargets, toCancelTarget } from './cancel-view.js';
import type { OpenOrder } from '../types.js';

const active: OpenOrder[] = [
  { id: 'o1', market: 'm1', asset_id: 'a1', side: 'BUY', price: '0.5', original_size: '10', size_matched: '4' },
  { id: 'o2', market: 'm1', asset_id: 'a2', side: 'SELL', price: '0.6', original_size: '5', size_matched: '0' },
  { id: 'o3', market: 'm2', asset_id: 'a3', side: 'BUY', price: '0.3', original_size: '8', size_matched: '8' },
];

describe('toCancelTarget', () => {
  it('computes remaining = original - matched', () => {
    expect(toCancelTarget(active[0]).remaining).toBe('6');
    expect(toCancelTarget(active[2]).remaining).toBe('0');
  });
});

describe('selectCancelTargets', () => {
  it('orderId selects exactly that order', () => {
    const t = selectCancelTargets(active, { orderId: 'o2' });
    expect(t.map((x) => x.order_id)).toEqual(['o2']);
  });
  it('all selects every active order', () => {
    expect(selectCancelTargets(active, { all: true }).length).toBe(3);
  });
  it('market filter narrows the set', () => {
    expect(selectCancelTargets(active, { market: 'm1' }).map((x) => x.order_id)).toEqual(['o1', 'o2']);
  });
  it('assetId filter narrows the set', () => {
    expect(selectCancelTargets(active, { assetId: 'a3' }).map((x) => x.order_id)).toEqual(['o3']);
  });
  it('unknown orderId selects nothing', () => {
    expect(selectCancelTargets(active, { orderId: 'zzz' })).toEqual([]);
  });
});
