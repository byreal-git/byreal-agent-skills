/**
 * Configuration management for Byreal CLI
 * Handles config file and dot-path access
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { ok, err } from '../core/types.js';
import type { Result, ByrealConfig } from '../core/types.js';
import {
  ByrealError,
  configInvalidError,
  validationError,
} from '../core/errors.js';
import { CONFIG_DIR, CONFIG_FILE, DEFAULT_CONFIG, DIR_PERMISSIONS } from '../core/constants.js';
import { expandTilde } from './security.js';

// ============================================
// Config Path Helpers
// ============================================

export function getConfigDir(): string {
  return expandTilde(CONFIG_DIR);
}

export function getConfigPath(): string {
  return path.join(getConfigDir(), CONFIG_FILE);
}

export function configExists(): boolean {
  return fs.existsSync(getConfigPath());
}

// ============================================
// Config Load / Save
// ============================================

export function loadConfig(): Result<ByrealConfig, ByrealError> {
  const configPath = getConfigPath();

  if (!fs.existsSync(configPath)) {
    // Return default config if file doesn't exist
    return ok({ ...DEFAULT_CONFIG });
  }

  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(content) as Partial<ByrealConfig>;

    // Merge with defaults to fill missing fields
    const config: ByrealConfig = {
      rpc_url: parsed.rpc_url || DEFAULT_CONFIG.rpc_url,
      cluster: parsed.cluster || DEFAULT_CONFIG.cluster,
      defaults: {
        ...DEFAULT_CONFIG.defaults,
        ...(parsed.defaults || {}),
      },
    };

    // Optional Privy fields — undefined unless explicitly set on disk.
    if (typeof parsed.privy_proxy_url === 'string' && parsed.privy_proxy_url) {
      config.privy_proxy_url = parsed.privy_proxy_url;
    }
    if (
      typeof parsed.privy_api_base_path === 'string' &&
      parsed.privy_api_base_path
    ) {
      config.privy_api_base_path = parsed.privy_api_base_path;
    }

    return ok(config);
  } catch (e) {
    if (e instanceof SyntaxError) {
      return err(configInvalidError('Config file contains invalid JSON'));
    }
    return err(configInvalidError(`Failed to read config: ${(e as Error).message}`));
  }
}

export function saveConfig(config: ByrealConfig): Result<void, ByrealError> {
  try {
    const configDir = getConfigDir();
    fs.mkdirSync(configDir, { recursive: true, mode: DIR_PERMISSIONS });
    if (process.platform !== 'win32') {
      fs.chmodSync(configDir, DIR_PERMISSIONS);
    }
    const configPath = getConfigPath();
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    return ok(undefined);
  } catch (e) {
    return err(configInvalidError(`Failed to save config: ${(e as Error).message}`));
  }
}

// ============================================
// Config Value Access (dot-path)
// ============================================

const VALID_KEYS = new Set([
  'rpc_url',
  'cluster',
  'defaults.priority_fee_micro_lamports',
  'defaults.slippage_bps',
  'privy_proxy_url',
  'privy_api_base_path',
]);

export function getConfigValue(key: string): Result<unknown, ByrealError> {
  if (!VALID_KEYS.has(key)) {
    return err(validationError(`Unknown config key: ${key}. Valid keys: ${[...VALID_KEYS].join(', ')}`, 'key'));
  }

  const configResult = loadConfig();
  if (!configResult.ok) return configResult;

  const config = configResult.value;
  const parts = key.split('.');

  let current: unknown = config;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return ok(undefined);
    }
    current = (current as Record<string, unknown>)[part];
  }

  return ok(current);
}

export function setConfigValue(key: string, value: string): Result<void, ByrealError> {
  if (!VALID_KEYS.has(key)) {
    return err(validationError(`Unknown config key: ${key}. Valid keys: ${[...VALID_KEYS].join(', ')}`, 'key'));
  }

  // Validate value based on key
  const validation = validateConfigValue(key, value);
  if (!validation.ok) return validation;

  const configResult = loadConfig();
  if (!configResult.ok) return configResult;

  const config = configResult.value;
  const typedValue = validation.value;

  // Set value using dot-path
  const parts = key.split('.');
  if (parts.length === 1) {
    (config as unknown as Record<string, unknown>)[parts[0]] = typedValue;
  } else if (parts.length === 2 && parts[0] === 'defaults') {
    (config.defaults as unknown as Record<string, unknown>)[parts[1]] = typedValue;
  }

  return saveConfig(config);
}

function validateConfigValue(key: string, value: string): Result<unknown, ByrealError> {
  switch (key) {
    case 'rpc_url': {
      try {
        new URL(value);
        return ok(value);
      } catch {
        return err(validationError('rpc_url must be a valid URL', 'rpc_url'));
      }
    }
    case 'cluster': {
      const valid = ['mainnet-beta', 'devnet', 'testnet'];
      if (!valid.includes(value)) {
        return err(validationError(`cluster must be one of: ${valid.join(', ')}`, 'cluster'));
      }
      return ok(value);
    }
    case 'defaults.slippage_bps': {
      const num = Number(value);
      if (isNaN(num) || num < 0 || num > 500 || !Number.isInteger(num)) {
        return err(validationError('slippage_bps must be an integer between 0 and 500', 'slippage_bps'));
      }
      return ok(num);
    }
    case 'defaults.priority_fee_micro_lamports': {
      const num = Number(value);
      if (isNaN(num) || num < 0 || !Number.isInteger(num)) {
        return err(validationError('priority_fee_micro_lamports must be a non-negative integer', 'priority_fee_micro_lamports'));
      }
      return ok(num);
    }
    case 'privy_proxy_url': {
      try {
        new URL(value);
        return ok(value.replace(/\/+$/, ''));
      } catch {
        return err(validationError('privy_proxy_url must be a valid URL', 'privy_proxy_url'));
      }
    }
    case 'privy_api_base_path': {
      if (!value.startsWith('/')) {
        return err(validationError('privy_api_base_path must start with /', 'privy_api_base_path'));
      }
      return ok(value.replace(/\/+$/, ''));
    }
    default:
      return ok(value);
  }
}
