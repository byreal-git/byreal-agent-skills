import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// Mirror config.test.ts: mock os.homedir so expandTilde resolves to tmpHome.
let tmpHomeRef = '';
vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof os>('node:os');
  return { ...actual, homedir: () => tmpHomeRef || actual.homedir() };
});

let tmpHome: string;
let originalEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  originalEnv = { ...process.env };
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'byreal-privy-evm-'));
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

async function importConfig() {
  return await import('./config.js');
}

describe('loadEvmWallet', () => {
  it('returns the single EVM wallet when no address requested', async () => {
    writeRealclaw({
      wallets: [
        { address: 'SolA', token: 'oc_at_sol', type: 'solana' },
        { address: '0xEoaAAA', token: 'oc_at_evm', type: 'evm' },
      ],
    });
    const { loadEvmWallet } = await importConfig();
    expect(loadEvmWallet()).toEqual({ address: '0xEoaAAA', token: 'oc_at_evm' });
  });

  it('matches EVM wallet by address case-insensitively', async () => {
    writeRealclaw({
      wallets: [
        { address: '0xAbCdEf0000000000000000000000000000000001', token: 'oc_at_1', type: 'evm' },
        { address: '0x0000000000000000000000000000000000000002', token: 'oc_at_2', type: 'evm' },
      ],
    });
    const { loadEvmWallet } = await importConfig();
    // request with different casing → still matches first
    expect(loadEvmWallet('0xABCDEF0000000000000000000000000000000001')).toEqual({
      address: '0xAbCdEf0000000000000000000000000000000001',
      token: 'oc_at_1',
    });
  });

  it('returns null when realclaw has no EVM wallet', async () => {
    writeRealclaw({ wallets: [{ address: 'SolA', token: 'oc_at_sol', type: 'solana' }] });
    const { loadEvmWallet } = await importConfig();
    expect(loadEvmWallet()).toBeNull();
  });

  it('returns null when requested EVM address is not present', async () => {
    writeRealclaw({ wallets: [{ address: '0xEoaAAA', token: 'oc_at_evm', type: 'evm' }] });
    const { loadEvmWallet } = await importConfig();
    expect(loadEvmWallet('0xNotPresent')).toBeNull();
  });

  it('loadEvmAgentToken returns the token for the resolved EVM wallet', async () => {
    writeRealclaw({ wallets: [{ address: '0xEoaAAA', token: 'oc_at_evm', type: 'evm' }] });
    const { loadEvmAgentToken } = await importConfig();
    expect(loadEvmAgentToken('0xeoaaaa')).toBe('oc_at_evm');
    expect(loadEvmAgentToken()).toBe('oc_at_evm');
  });
});
