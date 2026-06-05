import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { signEvmTypedData } from './client.js';
import type { Eip712TypedData } from './types.js';

const TYPED: Eip712TypedData = {
  domain: { name: 'Polymarket CTF Exchange', chainId: 137 },
  types: { Order: [{ name: 'salt', type: 'uint256' }] },
  primaryType: 'Order',
  message: { salt: '1' },
};

describe('signEvmTypedData', () => {
  let calls: Array<{ url: string; init: RequestInit }>;

  beforeEach(() => {
    calls = [];
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(status: number, body: unknown) {
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(body), { status });
    });
  }

  // Contract (see signEvmTypedData doc): the CLI's agent token (oc_at_) must go
  // through the proxy's `Authorization` agent-token branch — NOT
  // `X-Privy-Access-Token` (the JWT branch, which the gateway uses and which
  // would reject our non-JWT token). This asserts that contract, not a guess.
  it('POSTs to /sign/evm-typed-data with Authorization (agent-token branch) + X-Wallet-Address + caip2 body', async () => {
    stubFetch(200, { success: true, retCode: 0, data: { signature: '0xdeadbeef' } });

    const r = await signEvmTypedData(
      'oc_at_tok',
      { proxyUrl: 'https://proxy.example.com', apiBasePath: '/byreal/api/privy-proxy/v1' },
      '0xEOA',
      'eip155:137',
      TYPED,
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      'https://proxy.example.com/byreal/api/privy-proxy/v1/sign/evm-typed-data',
    );
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer oc_at_tok');
    expect(headers['X-Wallet-Address']).toBe('0xEOA');
    // The agent token must NOT be sent on the JWT header (would be rejected).
    expect(headers['X-Privy-Access-Token']).toBeUndefined();
    const body = JSON.parse(calls[0].init.body as string);
    expect(body.caip2).toBe('eip155:137');
    expect(body.typedData).toEqual(TYPED);
    expect(body.strategyId).toBeTruthy();

    expect(r.ok).toBe(true);
    expect(r.ok && r.value).toBe('0xdeadbeef');
  });

  it('accepts a flat { signature } in the envelope data', async () => {
    stubFetch(200, { success: true, retCode: 0, data: { signature: '0xabc' } });
    const r = await signEvmTypedData(
      't',
      { proxyUrl: 'https://p', apiBasePath: '/bp' },
      '0xEOA',
      'eip155:137',
      TYPED,
    );
    expect(r.ok && r.value).toBe('0xabc');
  });

  it('maps 401 to a Privy auth error', async () => {
    stubFetch(401, {});
    const r = await signEvmTypedData(
      't',
      { proxyUrl: 'https://p', apiBasePath: '/bp' },
      '0xEOA',
      'eip155:137',
      TYPED,
    );
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.code).toBe('PRIVY_AUTH_FAILED');
  });

  it('errors when no signature in the response', async () => {
    stubFetch(200, { success: true, retCode: 0, data: {} });
    const r = await signEvmTypedData(
      't',
      { proxyUrl: 'https://p', apiBasePath: '/bp' },
      '0xEOA',
      'eip155:137',
      TYPED,
    );
    expect(r.ok).toBe(false);
  });
});
