import { describe, it, expect, afterEach, vi } from 'vitest';
import { pmGet } from './gateway.js';

describe('pmGet', () => {
  afterEach(() => vi.unstubAllGlobals());

  function stub(status: number, body: unknown, capture?: { url?: string; init?: RequestInit }) {
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      if (capture) {
        capture.url = url;
        capture.init = init;
      }
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    });
  }

  it('builds {host}/byreal/api/gw/pm/{base}{path}?query, drops undefined params, sets UA', async () => {
    const cap: { url?: string; init?: RequestInit } = {};
    stub(200, { ok: 1 }, cap);
    const r = await pmGet<{ ok: number }>(
      'gamma',
      '/public-search',
      { q: 'world cup', limit_per_type: 30, page: undefined },
      { host: 'https://gw.test' },
    );
    expect(r.ok).toBe(true);
    expect(cap.url).toBe(
      'https://gw.test/byreal/api/gw/pm/gamma/public-search?q=world+cup&limit_per_type=30',
    );
    const headers = cap.init?.headers as Record<string, string>;
    expect(headers['User-Agent']).toBe('byreal-cli');
  });

  it('returns ok(json) on 200', async () => {
    stub(200, { tokens: [{ token_id: 'abc' }] });
    const r = await pmGet<{ tokens: { token_id: string }[] }>('clob', '/markets/0xcond', undefined, {
      host: 'https://gw.test',
    });
    expect(r.ok && r.value.tokens[0].token_id).toBe('abc');
  });

  it('maps 5xx → SOURCE_UNAVAILABLE retryable', async () => {
    stub(503, 'upstream down');
    const r = await pmGet('v1', '/categoy/tree', undefined, { host: 'https://gw.test' });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.code).toBe('SOURCE_UNAVAILABLE');
    expect(!r.ok && r.error.retryable).toBe(true);
  });

  it('maps 404 → API_ERROR not retryable', async () => {
    stub(404, 'not found');
    const r = await pmGet('v1', '/categoy/tree', undefined, { host: 'https://gw.test' });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.code).toBe('API_ERROR');
    expect(!r.ok && r.error.retryable).toBe(false);
  });

  it('maps network failure → SOURCE_UNAVAILABLE retryable', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('ECONNREFUSED');
    });
    const r = await pmGet('gamma', '/events/1', undefined, { host: 'https://gw.test' });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.code).toBe('SOURCE_UNAVAILABLE');
  });
});
