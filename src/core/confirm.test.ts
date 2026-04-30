import { describe, it, expect } from 'vitest';
import { resolveExecutionMode } from './confirm.js';

describe('resolveExecutionMode', () => {
  it('returns "unsigned-tx" by default (back-compat with pre-Privy behavior)', () => {
    expect(resolveExecutionMode({})).toBe('unsigned-tx');
  });

  it('returns "dry-run" when --dry-run is set', () => {
    expect(resolveExecutionMode({ dryRun: true })).toBe('dry-run');
  });

  it('returns "execute" when --execute is set', () => {
    expect(resolveExecutionMode({ execute: true })).toBe('execute');
  });

  it('throws ByrealError when both flags are set', () => {
    let caughtCode = '';
    try {
      resolveExecutionMode({ dryRun: true, execute: true });
    } catch (e) {
      caughtCode = (e as { code?: string }).code ?? '';
    }
    expect(caughtCode).toBe('INVALID_PARAMETER');
  });
});
