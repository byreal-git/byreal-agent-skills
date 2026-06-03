/**
 * Polymarket plugin configuration (pm_* keys).
 *
 * Precedence (highest first): CLI overrides → ~/.config/byreal/config.json
 * `defaults.pm_*` → hardcoded PM_DEFAULTS.
 *
 * Defaults are fixed per the TRD review (2026-06-03); see
 * docs/polymarket-cli/05-prd-analysis.md §4.4 and §5.6.
 *
 * `resolvePmConfig` is the pure merge core (unit-tested); `getPmConfig`
 * wraps it by reading the byreal-cli config file.
 */

import { loadConfig } from '../../auth/config.js';

export interface PmConfig {
  /** Market-order worstPrice buffer, absolute prob points: Δ = bps/10000. */
  marketSlippageBps: number;
  /** order.preview snapshot TTL in seconds. */
  previewTtlSeconds: number;
  /** order.place price-drift threshold (bps) before PREVIEW_EXPIRED. */
  previewDriftBps: number;
  /** event.detail compact top-N markets. */
  detailCompactMarkets: number;
  /** event.search whitelist cache TTL in seconds. */
  whitelistCacheTtlSeconds: number;
}

export const PM_DEFAULTS: PmConfig = {
  marketSlippageBps: 100,
  previewTtlSeconds: 30,
  previewDriftBps: 100,
  detailCompactMarkets: 5,
  whitelistCacheTtlSeconds: 600,
};

/** Pure merge: hardcoded defaults ← file defaults ← CLI overrides. */
export function resolvePmConfig(
  fileDefaults: Partial<PmConfig> | null,
  cliOverrides: Partial<PmConfig>,
): PmConfig {
  const merged: PmConfig = { ...PM_DEFAULTS };
  if (fileDefaults) {
    for (const key of Object.keys(merged) as (keyof PmConfig)[]) {
      const v = fileDefaults[key];
      if (typeof v === 'number' && Number.isFinite(v)) merged[key] = v;
    }
  }
  for (const key of Object.keys(merged) as (keyof PmConfig)[]) {
    const v = cliOverrides[key];
    if (typeof v === 'number' && Number.isFinite(v)) merged[key] = v;
  }
  return merged;
}

/** Best-effort read of `defaults.pm_*` numeric overrides from byreal config. */
function readFileDefaults(): Partial<PmConfig> | null {
  const result = loadConfig();
  if (!result.ok) return null;
  // `defaults` is loosely read for forward-compat pm_* keys (not in the strict
  // ByrealDefaults schema), so cast through unknown.
  const defaults = (result.value.defaults as unknown) as Record<string, unknown> | undefined;
  if (!defaults || typeof defaults !== 'object') return null;
  const num = (k: string): number | undefined => {
    const v = defaults[k];
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
  };
  return {
    marketSlippageBps: num('pm_market_slippage_bps'),
    previewTtlSeconds: num('pm_preview_ttl_seconds'),
    previewDriftBps: num('pm_preview_drift_bps'),
    detailCompactMarkets: num('pm_detail_compact_markets'),
    whitelistCacheTtlSeconds: num('pm_whitelist_cache_ttl_seconds'),
  };
}

/** Resolve the effective PmConfig, applying CLI overrides last. */
export function getPmConfig(cliOverrides: Partial<PmConfig> = {}): PmConfig {
  return resolvePmConfig(readFileDefaults(), cliOverrides);
}
