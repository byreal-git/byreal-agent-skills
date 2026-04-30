import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { signTransaction, signAndBroadcast } from './client.js';
import type { PrivyConfig } from './types.js';

const config: PrivyConfig = {
  proxyUrl: 'https://api.example.com',
  apiBasePath: '/byreal/api/privy-proxy/v1',
};
const TOKEN = 'oc_at_test';
const UNSIGNED = 'AQAB...base64';
const CAIP2 = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';

function makeFetchOk(body: unknown, status = 200): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response) as unknown as typeof fetch;
}

function makeFetchStatus(status: number, text = ''): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    statusText: '',
    json: async () => ({}),
    text: async () => text,
  } as unknown as Response) as unknown as typeof fetch;
}

describe('Privy client - signTransaction (broadcast=false)', () => {
  let originalFetch: typeof fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns signed base64 from nested snake_case shape (Privy SDK passthrough)', async () => {
    globalThis.fetch = makeFetchOk({
      success: true,
      retCode: 0,
      data: {
        data: { encoding: 'base64', signed_transaction: 'SIGNED_BASE64' },
        method: 'signTransaction',
      },
    });
    const r = await signTransaction(TOKEN, config, UNSIGNED);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('SIGNED_BASE64');
  });

  it('falls back to flat camelCase signedTransaction (legacy shape)', async () => {
    globalThis.fetch = makeFetchOk({
      success: true,
      retCode: 0,
      data: { signedTransaction: 'LEGACY_BASE64' },
    });
    const r = await signTransaction(TOKEN, config, UNSIGNED);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('LEGACY_BASE64');
  });

  it('unwraps BGW envelope (nested + nested)', async () => {
    globalThis.fetch = makeFetchOk({
      retCode: 0,
      retMsg: 'success',
      result: {
        success: true,
        retCode: 0,
        data: {
          data: { encoding: 'base64', signed_transaction: 'SIGNED_BGW' },
          method: 'signTransaction',
        },
      },
    });
    const r = await signTransaction(TOKEN, config, UNSIGNED);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('SIGNED_BGW');
  });

  it('maps HTTP 401 to PRIVY_AUTH_FAILED', async () => {
    globalThis.fetch = makeFetchStatus(401, 'invalid token');
    const r = await signTransaction(TOKEN, config, UNSIGNED);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('PRIVY_AUTH_FAILED');
  });

  it('maps HTTP 403 to PRIVY_AUTH_FAILED', async () => {
    globalThis.fetch = makeFetchStatus(403);
    const r = await signTransaction(TOKEN, config, UNSIGNED);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('PRIVY_AUTH_FAILED');
  });

  it('maps HTTP 422 to PRIVY_BAD_REQUEST', async () => {
    globalThis.fetch = makeFetchStatus(422, 'bad body');
    const r = await signTransaction(TOKEN, config, UNSIGNED);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('PRIVY_BAD_REQUEST');
  });

  it('maps HTTP 429 to PRIVY_RATE_LIMITED', async () => {
    globalThis.fetch = makeFetchStatus(429);
    const r = await signTransaction(TOKEN, config, UNSIGNED);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('PRIVY_RATE_LIMITED');
  });

  it('maps HTTP 502 to retryable PRIVY_UPSTREAM_ERROR', async () => {
    globalThis.fetch = makeFetchStatus(502, 'upstream gone');
    const r = await signTransaction(TOKEN, config, UNSIGNED);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('PRIVY_UPSTREAM_ERROR');
      expect(r.error.retryable).toBe(true);
    }
  });

  it('maps non-zero retCode to PRIVY_BUSINESS_ERROR', async () => {
    globalThis.fetch = makeFetchOk({
      success: false,
      retCode: 1507,
      retMsg: 'TRANSFER_FAILED',
      data: null,
    });
    const r = await signTransaction(TOKEN, config, UNSIGNED);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('PRIVY_BUSINESS_ERROR');
      expect(r.error.message).toContain('1507');
    }
  });

  it('reports missing signed_transaction as upstream error', async () => {
    globalThis.fetch = makeFetchOk({
      success: true,
      retCode: 0,
      data: { data: {}, method: 'signTransaction' },
    });
    const r = await signTransaction(TOKEN, config, UNSIGNED);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('PRIVY_UPSTREAM_ERROR');
  });

  it('handles AbortSignal timeout as PRIVY_TIMEOUT', async () => {
    globalThis.fetch = vi.fn().mockImplementation(() => {
      const e = new DOMException('Timed out', 'TimeoutError');
      return Promise.reject(e);
    }) as unknown as typeof fetch;
    const r = await signTransaction(TOKEN, config, UNSIGNED);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('PRIVY_TIMEOUT');
  });
});

describe('Privy client - signAndBroadcast (broadcast=true)', () => {
  let originalFetch: typeof fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns the on-chain hash on success', async () => {
    globalThis.fetch = makeFetchOk({
      success: true,
      retCode: 0,
      data: { hash: '5xK...' },
    });
    const r = await signAndBroadcast(TOKEN, config, UNSIGNED, CAIP2);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('5xK...');
  });

  it('reports missing hash as upstream error', async () => {
    globalThis.fetch = makeFetchOk({
      success: true,
      retCode: 0,
      data: {},
    });
    const r = await signAndBroadcast(TOKEN, config, UNSIGNED, CAIP2);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('PRIVY_UPSTREAM_ERROR');
  });

  it('passes Authorization Bearer header', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, retCode: 0, data: { hash: 'h' } }),
      text: async () => '',
    } as unknown as Response);
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    await signAndBroadcast(TOKEN, config, UNSIGNED, CAIP2);
    const callArgs = fetchSpy.mock.calls[0];
    const init = callArgs[1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${TOKEN}`,
    );
  });

  it('sends broadcast=true and caip2 in body', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, retCode: 0, data: { hash: 'h' } }),
      text: async () => '',
    } as unknown as Response);
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    await signAndBroadcast(TOKEN, config, UNSIGNED, CAIP2);
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(init.body as string);
    expect(body.broadcast).toBe(true);
    expect(body.caip2).toBe(CAIP2);
    expect(body.transaction).toBe(UNSIGNED);
    expect(body.strategyId).toBe('byreal_cli');
  });
});
