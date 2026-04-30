/**
 * Privy proxy configuration loading.
 *
 * Resolution order (highest precedence first):
 *   1. Environment variables: AGENT_TOKEN, PRIVY_PROXY_URL, PRIVY_API_BASE_PATH
 *   2. New format:    ~/.openclaw/realclaw-config.json (multi-wallet)
 *   3. Skill config:  ~/.openclaw/skills/agent-token/scripts/config.json
 *                     (paired with ~/.openclaw/agent_token for the token)
 *                     — this is the layout claw injects for managed agents
 *   4. byreal-cli own: ~/.config/byreal/config.json#privy_proxy_url
 *
 * `loadAgentToken(walletAddress?)` consults the token sources in order.
 * `loadPrivyConfig()` resolves baseUrl + apiBasePath the same way.
 */

import * as fs from 'node:fs';
import {
  AGENT_TOKEN_ENV,
  PRIVY_PROXY_URL_ENV,
  PRIVY_API_BASE_PATH_ENV,
  PRIVY_API_BASE_PATH_DEFAULT,
  REALCLAW_CONFIG_PATH,
  SKILL_AGENT_TOKEN_CONFIG_PATH,
  LEGACY_AGENT_TOKEN_PATH,
} from '../core/constants.js';
import { loadConfig } from '../auth/config.js';
import { expandTilde } from '../auth/security.js';
import type {
  PrivyConfig,
  RealclawConfig,
  RealclawWallet,
  SkillAgentTokenConfig,
} from './types.js';

// ============================================
// realclaw-config.json
// ============================================

/**
 * Load and parse `~/.openclaw/realclaw-config.json` if present.
 * Returns null on any error (parse / IO / shape mismatch).
 */
export function loadRealclawConfig(): RealclawConfig | null {
  const path = expandTilde(REALCLAW_CONFIG_PATH);
  if (!fs.existsSync(path)) return null;
  try {
    const content = fs.readFileSync(path, 'utf-8');
    const parsed = JSON.parse(content) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const out: RealclawConfig = {};
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.baseUrl === 'string' && obj.baseUrl) out.baseUrl = obj.baseUrl;
    if (typeof obj.apiBasePath === 'string' && obj.apiBasePath)
      out.apiBasePath = obj.apiBasePath;
    if (Array.isArray(obj.wallets)) {
      const wallets: RealclawWallet[] = [];
      for (const raw of obj.wallets) {
        if (!raw || typeof raw !== 'object') continue;
        const w = raw as Record<string, unknown>;
        if (
          typeof w.address === 'string' &&
          typeof w.token === 'string' &&
          (w.type === 'solana' || w.type === 'evm')
        ) {
          wallets.push({
            address: w.address,
            token: w.token,
            type: w.type,
          });
        }
      }
      if (wallets.length > 0) out.wallets = wallets;
    }
    return out;
  } catch {
    return null;
  }
}

// ============================================
// Skill agent-token config (legacy claw-managed)
// ============================================

/**
 * Read the agent-token skill's config.json (paired with ~/.openclaw/agent_token).
 * Returns null if missing or malformed. This is what claw injects into managed
 * agents and is the layout existing users almost certainly have.
 */
export function loadSkillAgentTokenConfig(): SkillAgentTokenConfig | null {
  const path = expandTilde(SKILL_AGENT_TOKEN_CONFIG_PATH);
  if (!fs.existsSync(path)) return null;
  try {
    const content = fs.readFileSync(path, 'utf-8');
    const parsed = JSON.parse(content) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const obj = parsed as Record<string, unknown>;
    const out: SkillAgentTokenConfig = {};
    if (typeof obj.baseUrl === 'string' && obj.baseUrl) out.baseUrl = obj.baseUrl;
    if (typeof obj.apiBasePath === 'string' && obj.apiBasePath)
      out.apiBasePath = obj.apiBasePath;
    return out;
  } catch {
    return null;
  }
}

// ============================================
// Agent Token Resolution
// ============================================

/**
 * Resolve the agent token. Priority:
 *   1. AGENT_TOKEN env var
 *   2. realclaw-config.json wallets[] — match type=solana, prefer matching address
 *   3. ~/.openclaw/agent_token (legacy single-token file)
 *
 * Returns null if no source provides a token.
 *
 * If `walletAddress` is provided AND realclaw-config.json has solana wallets
 * but none match the address, returns null (caller should raise
 * PRIVY_WALLET_NOT_FOUND, not fall through to legacy).
 */
export function loadAgentToken(walletAddress?: string): string | null {
  // 1. env override
  const envToken = AGENT_TOKEN_ENV?.trim();
  if (envToken) return envToken;

  // 2. realclaw-config.json
  const realclaw = loadRealclawConfig();
  if (realclaw?.wallets && realclaw.wallets.length > 0) {
    const solWallets = realclaw.wallets.filter((w) => w.type === 'solana');
    if (solWallets.length > 0) {
      if (walletAddress) {
        const match = solWallets.find((w) => w.address === walletAddress);
        if (match) return match.token;
        // Have solana wallets but none match the requested address.
        // Don't silently fall through — return null so caller can raise
        // PRIVY_WALLET_NOT_FOUND with a precise message.
        return null;
      }
      // No address requested — pick the first solana wallet.
      return solWallets[0].token;
    }
  }

  // 3. legacy file
  try {
    const path = expandTilde(LEGACY_AGENT_TOKEN_PATH);
    if (fs.existsSync(path)) {
      const content = fs.readFileSync(path, 'utf-8').trim();
      if (content.length > 0) return content;
    }
  } catch {
    // Ignore IO errors — treat as "no token".
  }

  return null;
}

// ============================================
// Privy Proxy Config Resolution
// ============================================

/**
 * Resolve `PrivyConfig` (baseUrl + apiBasePath). Priority:
 *   1. PRIVY_PROXY_URL / PRIVY_API_BASE_PATH env vars
 *   2. realclaw-config.json `baseUrl` / `apiBasePath`
 *   3. skill agent-token config.json `baseUrl` / `apiBasePath`
 *      (~/.openclaw/skills/agent-token/scripts/config.json)
 *   4. ~/.config/byreal/config.json `privy_proxy_url` / `privy_api_base_path`
 *
 * Returns null if no source provides a baseUrl.
 */
export function loadPrivyConfig(): PrivyConfig | null {
  let proxyUrl: string | undefined;
  let apiBasePath: string | undefined;

  // 1. env
  if (PRIVY_PROXY_URL_ENV) proxyUrl = PRIVY_PROXY_URL_ENV;
  if (PRIVY_API_BASE_PATH_ENV) apiBasePath = PRIVY_API_BASE_PATH_ENV;

  // 2. realclaw-config.json (only fill what env didn't)
  if (!proxyUrl || !apiBasePath) {
    const realclaw = loadRealclawConfig();
    if (realclaw) {
      if (!proxyUrl && realclaw.baseUrl) proxyUrl = realclaw.baseUrl;
      if (!apiBasePath && realclaw.apiBasePath) apiBasePath = realclaw.apiBasePath;
    }
  }

  // 3. ~/.openclaw/skills/agent-token/scripts/config.json
  // This is the layout claw injects for managed agents — must be supported
  // so existing users don't have to migrate config when upgrading the CLI.
  if (!proxyUrl || !apiBasePath) {
    const skill = loadSkillAgentTokenConfig();
    if (skill) {
      if (!proxyUrl && skill.baseUrl) proxyUrl = skill.baseUrl;
      if (!apiBasePath && skill.apiBasePath) apiBasePath = skill.apiBasePath;
    }
  }

  // 4. ~/.config/byreal/config.json (byreal-cli own config — useful for
  // standalone byreal-cli users who don't have the agent-token skill set up).
  if (!proxyUrl || !apiBasePath) {
    const cfgResult = loadConfig();
    if (cfgResult.ok) {
      const cfg = cfgResult.value;
      if (!proxyUrl && cfg.privy_proxy_url) proxyUrl = cfg.privy_proxy_url;
      if (!apiBasePath && cfg.privy_api_base_path)
        apiBasePath = cfg.privy_api_base_path;
    }
  }

  if (!proxyUrl) return null;

  return {
    proxyUrl: proxyUrl.replace(/\/+$/, ''),
    apiBasePath: (apiBasePath || PRIVY_API_BASE_PATH_DEFAULT).replace(/\/+$/, ''),
  };
}

/**
 * Quick check used by --output table renderings; the executable path
 * uses requirePrivyContext (in execute.ts) which throws on missing config.
 */
export function isPrivyAvailable(walletAddress?: string): boolean {
  return loadAgentToken(walletAddress) !== null && loadPrivyConfig() !== null;
}
