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
import { CONFIG_DIR, CONFIG_FILE, DEFAULT_CONFIG, BYREAL_KEYS_DIR, FILE_PERMISSIONS } from '../core/constants.js';
import { expandTilde, ensureConfigDir, setFilePermissions } from './security.js';

// ============================================
// Config Path Helpers
// ============================================

export function getConfigDir(): string {
  return expandTilde(CONFIG_DIR);
}

export function getConfigPath(): string {
  return path.join(getConfigDir(), CONFIG_FILE);
}

export function getKeysDir(): string {
  return expandTilde(BYREAL_KEYS_DIR);
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
      auto_update: parsed.auto_update ?? DEFAULT_CONFIG.auto_update,
      keypair_path: parsed.keypair_path,
      rpc_url: parsed.rpc_url || DEFAULT_CONFIG.rpc_url,
      cluster: parsed.cluster || DEFAULT_CONFIG.cluster,
      defaults: {
        ...DEFAULT_CONFIG.defaults,
        ...(parsed.defaults || {}),
      },
    };

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
    ensureConfigDir(CONFIG_DIR);
    const configPath = getConfigPath();
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    setFilePermissions(configPath, FILE_PERMISSIONS);
    return ok(undefined);
  } catch (e) {
    return err(configInvalidError(`Failed to save config: ${(e as Error).message}`));
  }
}

// ============================================
// Config Value Access (dot-path)
// ============================================

const VALID_KEYS = new Set([
  'auto_update',
  'keypair_path',
  'rpc_url',
  'cluster',
  'defaults.priority_fee_micro_lamports',
  'defaults.slippage_bps',
  'defaults.require_confirmation',
  'defaults.auto_confirm_threshold_usd',
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
    case 'defaults.auto_confirm_threshold_usd': {
      const num = Number(value);
      if (isNaN(num) || num < 0) {
        return err(validationError('auto_confirm_threshold_usd must be a non-negative number', 'auto_confirm_threshold_usd'));
      }
      return ok(num);
    }
    case 'defaults.require_confirmation': {
      if (value !== 'true' && value !== 'false') {
        return err(validationError('require_confirmation must be "true" or "false"', 'require_confirmation'));
      }
      return ok(value === 'true');
    }
    case 'auto_update': {
      if (value !== 'true' && value !== 'false') {
        return err(validationError('auto_update must be "true" or "false"', 'auto_update'));
      }
      return ok(value === 'true');
    }
    default:
      return ok(value);
  }
}

// ============================================
// Cleanup
// ============================================

/** Delete the entire config directory */
export function deleteConfig(): Result<void, ByrealError> {
  try {
    const configDir = getConfigDir();
    if (fs.existsSync(configDir)) {
      fs.rmSync(configDir, { recursive: true, force: true });
    }
    return ok(undefined);
  } catch (e) {
    return err(configInvalidError(`Failed to delete config: ${(e as Error).message}`));
  }
}

/** Clear only keypair-related config */
export function deleteKeypairConfig(): Result<void, ByrealError> {
  const configResult = loadConfig();
  if (!configResult.ok) return configResult;

  const config = configResult.value;
  config.keypair_path = undefined;

  // Also clear keys directory
  try {
    const keysDir = getKeysDir();
    if (fs.existsSync(keysDir)) {
      fs.rmSync(keysDir, { recursive: true, force: true });
    }
  } catch {
    // Non-fatal if keys dir cleanup fails
  }

  return saveConfig(config);
}
