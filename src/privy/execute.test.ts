import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// Mock os.homedir for deterministic ~ expansion (see config.test.ts).
let tmpHomeRef = '';
vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof os>('node:os');
  return { ...actual, homedir: () => tmpHomeRef || actual.homedir() };
});

let tmpHome: string;
let originalEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  originalEnv = { ...process.env };
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'byreal-privy-exec-'));
  tmpHomeRef = tmpHome;
  process.env.HOME = tmpHome;
  delete process.env.AGENT_TOKEN;
  delete process.env.PRIVY_PROXY_URL;
  delete process.env.PRIVY_API_BASE_PATH;
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...originalEnv };
  try {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

function writeRealclaw(json: unknown) {
  const dir = path.join(tmpHome, '.openclaw');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'realclaw-config.json'), JSON.stringify(json), 'utf-8');
}

async function importExec() {
  return await import('./execute.js');
}

describe('requirePrivyContext', () => {
  it('throws PRIVY_NOT_CONFIGURED when nothing is set', async () => {
    const { requirePrivyContext } = await importExec();
    let caughtCode = '';
    try {
      requirePrivyContext();
    } catch (e) {
      caughtCode = (e as { code?: string }).code ?? '';
    }
    expect(caughtCode).toBe('PRIVY_NOT_CONFIGURED');
  });

  it('returns context when env vars are set', async () => {
    process.env.AGENT_TOKEN = 'oc_at_x';
    process.env.PRIVY_PROXY_URL = 'https://example.com';
    const { requirePrivyContext } = await importExec();
    const ctx = requirePrivyContext();
    expect(ctx.token).toBe('oc_at_x');
    expect(ctx.config.proxyUrl).toBe('https://example.com');
    expect(ctx.caip2).toBe('solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp');
  });

  it('throws PRIVY_WALLET_NOT_FOUND when realclaw has solana wallets but address mismatches', async () => {
    process.env.PRIVY_PROXY_URL = 'https://example.com';
    writeRealclaw({
      wallets: [{ address: 'WalletA', token: 'oc_at_a', type: 'solana' }],
    });
    const { requirePrivyContext } = await importExec();
    let caughtCode = '';
    try {
      requirePrivyContext('WalletDoesNotExist');
    } catch (e) {
      caughtCode = (e as { code?: string }).code ?? '';
    }
    expect(caughtCode).toBe('PRIVY_WALLET_NOT_FOUND');
  });

  it('returns context when address matches a realclaw wallet', async () => {
    process.env.PRIVY_PROXY_URL = 'https://example.com';
    writeRealclaw({
      wallets: [
        { address: 'WalletA', token: 'oc_at_a', type: 'solana' },
        { address: 'WalletB', token: 'oc_at_b', type: 'solana' },
      ],
    });
    const { requirePrivyContext } = await importExec();
    const ctx = requirePrivyContext('WalletB');
    expect(ctx.token).toBe('oc_at_b');
  });
});

describe('privyBroadcastOne / Many', () => {
  let originalFetch: typeof fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('privyBroadcastOne returns signature on success', async () => {
    process.env.AGENT_TOKEN = 'oc_at_x';
    process.env.PRIVY_PROXY_URL = 'https://example.com';
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, retCode: 0, data: { hash: 'sig123' } }),
      text: async () => '',
    } as unknown as Response) as unknown as typeof fetch;
    const { requirePrivyContext, privyBroadcastOne } = await importExec();
    const r = await privyBroadcastOne(requirePrivyContext(), 'AQAB');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.signature).toBe('sig123');
  });

  it('privyBroadcastMany aggregates per-tx outcomes', async () => {
    process.env.AGENT_TOKEN = 'oc_at_x';
    process.env.PRIVY_PROXY_URL = 'https://example.com';
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      callCount += 1;
      if (callCount === 1) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, retCode: 0, data: { hash: 'h1' } }),
          text: async () => '',
        } as unknown as Response;
      }
      // Second call simulates a 502.
      return {
        ok: false,
        status: 502,
        json: async () => ({}),
        text: async () => 'upstream',
      } as unknown as Response;
    }) as unknown as typeof fetch;
    const { requirePrivyContext, privyBroadcastMany } = await importExec();
    const r = await privyBroadcastMany(requirePrivyContext(), ['t1', 't2']);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.successCount).toBe(1);
      expect(r.value.failCount).toBe(1);
      expect(r.value.results[0].signature).toBe('h1');
      expect(r.value.results[1].error).toBeDefined();
    }
  });
});

describe('privySignMany', () => {
  let originalFetch: typeof fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns all signed txs when all succeed', async () => {
    process.env.AGENT_TOKEN = 'oc_at_x';
    process.env.PRIVY_PROXY_URL = 'https://example.com';
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      callCount += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          retCode: 0,
          data: {
            data: { encoding: 'base64', signed_transaction: `signed-${callCount}` },
            method: 'signTransaction',
          },
        }),
        text: async () => '',
      } as unknown as Response;
    }) as unknown as typeof fetch;
    const { requirePrivyContext, privySignMany } = await importExec();
    const r = await privySignMany(requirePrivyContext(), ['a', 'b']);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.signedTxs).toHaveLength(2);
      expect(r.value.signedTxs[0].signedTx).toBe('signed-1');
      expect(r.value.signedTxs[1].signedTx).toBe('signed-2');
    }
  });

  it('fail-fast on first error', async () => {
    process.env.AGENT_TOKEN = 'oc_at_x';
    process.env.PRIVY_PROXY_URL = 'https://example.com';
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      callCount += 1;
      if (callCount === 1) {
        return {
          ok: false,
          status: 401,
          json: async () => ({}),
          text: async () => 'expired',
        } as unknown as Response;
      }
      throw new Error('should not be called');
    }) as unknown as typeof fetch;
    const { requirePrivyContext, privySignMany } = await importExec();
    const r = await privySignMany(requirePrivyContext(), ['a', 'b']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('PRIVY_AUTH_FAILED');
    expect(callCount).toBe(1);
  });
});
