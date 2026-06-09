import { describe, it, expect, afterEach, vi } from 'vitest';
import { gatherReadiness } from './readiness-gather.js';

const auth = { token: 'oc_at_t', evmAddress: '0xEOA' };

/** Route a fetch by URL substring → JSON body. wallet/status is enveloped (/v1). */
function routeStub(routes: Array<{ match: string; body: unknown; status?: number }>) {
  vi.stubGlobal('fetch', async (url: string) => {
    const r = routes.find((x) => url.includes(x.match));
    if (!r) return new Response('not stubbed: ' + url, { status: 404 });
    return new Response(JSON.stringify(r.body), {
      status: r.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
}

describe('gatherReadiness', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('BUY ready: READY wallet + sufficient COLLATERAL + tradable market', async () => {
    routeStub([
      { match: '/v1/wallet/status', body: { success: true, ret_code: 0, data: { walletAddress: '0xEOA', proxyAddress: '0xP', status: 'READY' } } },
      { match: '/clob/balance-allowance', body: { balance: '100000000', allowances: {} } },
      { match: '/clob/markets/', body: { active: true, accepting_orders: true, closed: false } },
    ]);
    const r = await gatherReadiness({ auth, tokenId: 'tok', side: 'BUY', need: '5', conditionId: '0xcond' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.ready).toBe(true);
      expect(r.value.proxy_address).toBe('0xP');
    }
  });

  it('not ready when wallet UNINITIALIZED (no proxy)', async () => {
    routeStub([
      { match: '/v1/wallet/status', body: { success: true, ret_code: 0, data: { walletAddress: '0xEOA', status: 'UNINITIALIZED' } } },
      { match: '/clob/balance-allowance', body: { balance: '0' } },
    ]);
    const r = await gatherReadiness({ auth, tokenId: 'tok', side: 'BUY', need: '5' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.ready).toBe(false);
      expect(r.value.checks.proxy_ready.ok).toBe(false);
    }
  });

  it('degrades balance to 0 when balance-allowance fails', async () => {
    routeStub([
      { match: '/v1/wallet/status', body: { success: true, ret_code: 0, data: { walletAddress: '0xEOA', proxyAddress: '0xP', status: 'READY' } } },
      { match: '/clob/balance-allowance', body: 'auth fail', status: 400 },
      { match: '/clob/markets/', body: { active: true, accepting_orders: true, closed: false } },
    ]);
    const r = await gatherReadiness({ auth, tokenId: 'tok', side: 'BUY', need: '5', conditionId: '0xcond' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.ready).toBe(false);
      expect(r.value.checks.balance.ok).toBe(false);
    }
  });

  it('marks market unverified when no conditionId', async () => {
    routeStub([
      { match: '/v1/wallet/status', body: { success: true, ret_code: 0, data: { walletAddress: '0xEOA', proxyAddress: '0xP', status: 'READY' } } },
      { match: '/clob/balance-allowance', body: { balance: '100000000' } },
    ]);
    const r = await gatherReadiness({ auth, tokenId: 'tok', side: 'BUY', need: '5' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.checks.market.detail).toContain('not verified');
  });
});
