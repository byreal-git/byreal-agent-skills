import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// Mock os.homedir at module level so the CLI's expandTilde resolves to
// our per-test tmpHome regardless of platform-specific quirks (macOS
// libuv lookup, etc.). We dynamically pick up tmpHome via a closure.
let tmpHomeRef = '';
vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof os>('node:os');
  return { ...actual, homedir: () => tmpHomeRef || actual.homedir() };
});

// Helpers to build a temporary HOME directory and to import config.ts
// fresh after manipulating env vars / files. We mock os.homedir so the
// CLI's expandTilde resolves to our tmpHome even on macOS (where
// os.homedir does not always honor $HOME).

let tmpHome: string;
let originalEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  originalEnv = { ...process.env };
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'byreal-privy-cfg-'));
  tmpHomeRef = tmpHome;
  process.env.HOME = tmpHome;
  // Clear all Privy-related env vars to ensure deterministic resolution.
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

function writeLegacyToken(token: string) {
  const dir = path.join(tmpHome, '.openclaw');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'agent_token'), token, 'utf-8');
}

function writeSkillConfig(json: unknown) {
  const dir = path.join(tmpHome, '.openclaw', 'skills', 'agent-token', 'scripts');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(json), 'utf-8');
}

function writeByrealConfig(json: unknown) {
  const dir = path.join(tmpHome, '.config', 'byreal');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(json), 'utf-8');
}

async function importConfig() {
  // Re-import after env mutations so PRIVY_*_ENV constants pick up changes.
  return await import('./config.js');
}

describe('loadAgentToken', () => {
  it('returns env override first', async () => {
    process.env.AGENT_TOKEN = 'oc_at_envtoken';
    writeLegacyToken('oc_at_legacy');
    writeRealclaw({
      wallets: [{ address: 'A', token: 'oc_at_realclaw', type: 'solana' }],
    });
    const { loadAgentToken } = await importConfig();
    expect(loadAgentToken()).toBe('oc_at_envtoken');
  });

  it('matches realclaw wallet by address', async () => {
    writeRealclaw({
      wallets: [
        { address: 'WalletA', token: 'oc_at_aaa', type: 'solana' },
        { address: 'WalletB', token: 'oc_at_bbb', type: 'solana' },
      ],
    });
    const { loadAgentToken } = await importConfig();
    expect(loadAgentToken('WalletB')).toBe('oc_at_bbb');
  });

  it('returns null when realclaw has solana wallets but none match address', async () => {
    writeRealclaw({
      wallets: [{ address: 'WalletA', token: 'oc_at_aaa', type: 'solana' }],
    });
    writeLegacyToken('oc_at_legacy');
    const { loadAgentToken } = await importConfig();
    // Legacy is *not* used as fallback when realclaw has solana wallets but
    // none match the requested wallet address (caller raises PRIVY_WALLET_NOT_FOUND).
    expect(loadAgentToken('WalletNotInConfig')).toBeNull();
  });

  it('picks first solana wallet when no address provided', async () => {
    writeRealclaw({
      wallets: [
        { address: 'WalletA', token: 'oc_at_aaa', type: 'solana' },
        { address: 'WalletB', token: 'oc_at_bbb', type: 'solana' },
      ],
    });
    const { loadAgentToken } = await importConfig();
    expect(loadAgentToken()).toBe('oc_at_aaa');
  });

  it('falls back to legacy file when realclaw is absent', async () => {
    writeLegacyToken('oc_at_legacy');
    const { loadAgentToken } = await importConfig();
    expect(loadAgentToken()).toBe('oc_at_legacy');
  });

  it('falls back to legacy when realclaw has only EVM wallets', async () => {
    writeRealclaw({
      wallets: [{ address: '0xabc', token: 'oc_at_evm', type: 'evm' }],
    });
    writeLegacyToken('oc_at_legacy');
    const { loadAgentToken } = await importConfig();
    expect(loadAgentToken('SomeSolWallet')).toBe('oc_at_legacy');
  });

  it('returns null when no source has a token', async () => {
    const { loadAgentToken } = await importConfig();
    expect(loadAgentToken()).toBeNull();
  });
});

describe('loadPrivyConfig', () => {
  it('uses env override for proxyUrl', async () => {
    process.env.PRIVY_PROXY_URL = 'https://env.example.com';
    writeRealclaw({ baseUrl: 'https://realclaw.example.com' });
    const { loadPrivyConfig } = await importConfig();
    expect(loadPrivyConfig()?.proxyUrl).toBe('https://env.example.com');
  });

  it('strips trailing slashes from proxyUrl', async () => {
    process.env.PRIVY_PROXY_URL = 'https://example.com///';
    const { loadPrivyConfig } = await importConfig();
    expect(loadPrivyConfig()?.proxyUrl).toBe('https://example.com');
  });

  it('uses realclaw baseUrl when env unset', async () => {
    writeRealclaw({ baseUrl: 'https://api2.byreal.io', apiBasePath: '/custom/v1' });
    const { loadPrivyConfig } = await importConfig();
    expect(loadPrivyConfig()).toEqual({
      proxyUrl: 'https://api2.byreal.io',
      apiBasePath: '/custom/v1',
    });
  });

  it('defaults apiBasePath when only baseUrl is configured', async () => {
    writeRealclaw({ baseUrl: 'https://api2.byreal.io' });
    const { loadPrivyConfig } = await importConfig();
    expect(loadPrivyConfig()).toEqual({
      proxyUrl: 'https://api2.byreal.io',
      apiBasePath: '/byreal/api/privy-proxy/v1',
    });
  });

  it('returns null when no source provides baseUrl', async () => {
    const { loadPrivyConfig } = await importConfig();
    expect(loadPrivyConfig()).toBeNull();
  });
});

describe('loadPrivyConfig — skill agent-token config fallback', () => {
  it('reads baseUrl from ~/.openclaw/skills/agent-token/scripts/config.json', async () => {
    writeSkillConfig({
      baseUrl: 'https://api2.byreal.io',
      apiBasePath: '/byreal/api/privy-proxy/v1',
    });
    const { loadPrivyConfig } = await importConfig();
    expect(loadPrivyConfig()).toEqual({
      proxyUrl: 'https://api2.byreal.io',
      apiBasePath: '/byreal/api/privy-proxy/v1',
    });
  });

  it('skill config takes precedence over byreal-cli own config', async () => {
    writeSkillConfig({ baseUrl: 'https://skill.example.com' });
    writeByrealConfig({ privy_proxy_url: 'https://byreal-cli.example.com' });
    const { loadPrivyConfig } = await importConfig();
    expect(loadPrivyConfig()?.proxyUrl).toBe('https://skill.example.com');
  });

  it('realclaw-config.json takes precedence over skill config', async () => {
    writeRealclaw({ baseUrl: 'https://realclaw.example.com' });
    writeSkillConfig({ baseUrl: 'https://skill.example.com' });
    const { loadPrivyConfig } = await importConfig();
    expect(loadPrivyConfig()?.proxyUrl).toBe('https://realclaw.example.com');
  });

  it('falls back to byreal-cli own config when skill config is absent', async () => {
    writeByrealConfig({ privy_proxy_url: 'https://byreal-cli.example.com' });
    const { loadPrivyConfig } = await importConfig();
    expect(loadPrivyConfig()?.proxyUrl).toBe('https://byreal-cli.example.com');
  });

  it('returns null if skill config exists but lacks baseUrl', async () => {
    writeSkillConfig({ apiBasePath: '/some/path' });
    const { loadPrivyConfig } = await importConfig();
    expect(loadPrivyConfig()).toBeNull();
  });

  it('handles malformed skill config gracefully', async () => {
    const dir = path.join(tmpHome, '.openclaw', 'skills', 'agent-token', 'scripts');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'config.json'), 'not json', 'utf-8');
    const { loadPrivyConfig } = await importConfig();
    expect(loadPrivyConfig()).toBeNull();
  });
});

describe('isPrivyAvailable', () => {
  it('returns true when both token and proxy are configured', async () => {
    process.env.AGENT_TOKEN = 'oc_at_x';
    process.env.PRIVY_PROXY_URL = 'https://example.com';
    const { isPrivyAvailable } = await importConfig();
    expect(isPrivyAvailable()).toBe(true);
  });

  it('returns false when only token is configured', async () => {
    process.env.AGENT_TOKEN = 'oc_at_x';
    const { isPrivyAvailable } = await importConfig();
    expect(isPrivyAvailable()).toBe(false);
  });

  it('returns false when only proxy URL is configured', async () => {
    process.env.PRIVY_PROXY_URL = 'https://example.com';
    const { isPrivyAvailable } = await importConfig();
    expect(isPrivyAvailable()).toBe(false);
  });
});
