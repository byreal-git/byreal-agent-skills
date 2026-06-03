import { describe, it, expect } from 'vitest';
import { resolvePmConfig, PM_DEFAULTS } from './config.js';

describe('resolvePmConfig', () => {
  it('returns hardcoded defaults when no file/CLI overrides', () => {
    expect(resolvePmConfig(null, {})).toEqual({
      marketSlippageBps: 100,
      previewTtlSeconds: 30,
      previewDriftBps: 100,
      detailCompactMarkets: 5,
      whitelistCacheTtlSeconds: 600,
    });
  });

  it('exposes the same values via PM_DEFAULTS', () => {
    expect(PM_DEFAULTS.marketSlippageBps).toBe(100);
    expect(PM_DEFAULTS.previewTtlSeconds).toBe(30);
    expect(PM_DEFAULTS.previewDriftBps).toBe(100);
    expect(PM_DEFAULTS.detailCompactMarkets).toBe(5);
    expect(PM_DEFAULTS.whitelistCacheTtlSeconds).toBe(600);
  });

  it('file defaults override hardcoded defaults', () => {
    const r = resolvePmConfig({ marketSlippageBps: 200, detailCompactMarkets: 8 }, {});
    expect(r.marketSlippageBps).toBe(200);
    expect(r.detailCompactMarkets).toBe(8);
    expect(r.previewTtlSeconds).toBe(30); // untouched
  });

  it('CLI overrides take precedence over file defaults', () => {
    const r = resolvePmConfig(
      { marketSlippageBps: 200 },
      { marketSlippageBps: 250 },
    );
    expect(r.marketSlippageBps).toBe(250);
  });

  it('ignores undefined CLI override fields', () => {
    const r = resolvePmConfig(null, { marketSlippageBps: undefined });
    expect(r.marketSlippageBps).toBe(100);
  });
});
