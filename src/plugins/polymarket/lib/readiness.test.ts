import { describe, it, expect } from 'vitest';
import { aggregateReadiness } from './readiness.js';

const market = { active: true, acceptingOrders: true, enableOrderBook: true };

describe('aggregateReadiness', () => {
  it('ready when proxy READY, balance sufficient, market tradable', () => {
    const v = aggregateReadiness({
      walletStatus: 'READY',
      proxyAddress: '0xP',
      balance: '10',
      need: '5',
      side: 'BUY',
      market,
    });
    expect(v.ready).toBe(true);
    expect(v.proxy_address).toBe('0xP');
    expect(v.blocking_reason).toBeUndefined();
  });

  it('not ready when proxy not READY', () => {
    const v = aggregateReadiness({
      walletStatus: 'PROXY_DEPLOYING',
      proxyAddress: '0xP',
      balance: '10',
      need: '5',
      side: 'BUY',
      market,
    });
    expect(v.ready).toBe(false);
    expect(v.checks.proxy_ready.ok).toBe(false);
    expect(v.blocking_reason).toContain('proxy');
  });

  it('not ready when balance < need', () => {
    const v = aggregateReadiness({
      walletStatus: 'READY',
      proxyAddress: '0xP',
      balance: '3',
      need: '5',
      side: 'BUY',
      market,
    });
    expect(v.ready).toBe(false);
    expect(v.checks.balance.ok).toBe(false);
  });

  it('balance equal to need is sufficient', () => {
    const v = aggregateReadiness({
      walletStatus: 'READY',
      proxyAddress: '0xP',
      balance: '5',
      need: '5',
      side: 'SELL',
      market,
    });
    expect(v.checks.balance.ok).toBe(true);
  });

  it('SELL detail references shares (CONDITIONAL)', () => {
    const v = aggregateReadiness({
      walletStatus: 'READY',
      proxyAddress: '0xP',
      balance: '10',
      need: '5',
      side: 'SELL',
      market,
    });
    expect(v.checks.balance.detail).toContain('CONDITIONAL');
  });

  it('not ready when a market boolean is false', () => {
    const v = aggregateReadiness({
      walletStatus: 'READY',
      proxyAddress: '0xP',
      balance: '10',
      need: '5',
      side: 'SELL',
      market: { active: true, acceptingOrders: false, enableOrderBook: true },
    });
    expect(v.ready).toBe(false);
    expect(v.checks.market.ok).toBe(false);
  });

  it('not ready when proxyAddress missing even if status READY', () => {
    const v = aggregateReadiness({
      walletStatus: 'READY',
      proxyAddress: null,
      balance: '10',
      need: '5',
      side: 'BUY',
      market,
    });
    expect(v.ready).toBe(false);
    expect(v.checks.proxy_ready.ok).toBe(false);
  });
});
