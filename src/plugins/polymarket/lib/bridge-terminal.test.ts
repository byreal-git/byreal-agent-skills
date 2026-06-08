import { describe, it, expect } from 'vitest';
import { isBridgeTerminal, isBridgeSuccess } from './bridge-terminal.js';

describe('isBridgeTerminal', () => {
  it('COMPLETED / FAILED are terminal (status or bridgeStatus, case-insensitive)', () => {
    expect(isBridgeTerminal({ status: 'COMPLETED' })).toBe(true);
    expect(isBridgeTerminal({ status: 'FAILED' })).toBe(true);
    expect(isBridgeTerminal({ bridgeStatus: 'completed' })).toBe(true);
  });
  it('in-flight statuses are not terminal', () => {
    expect(isBridgeTerminal({ status: 'SIGNED' })).toBe(false);
    expect(isBridgeTerminal({ status: 'CONFIRMED', bridgeStatus: 'PROCESSING' })).toBe(false);
    expect(isBridgeTerminal(undefined)).toBe(false);
  });
});

describe('isBridgeSuccess', () => {
  it('only COMPLETED is success', () => {
    expect(isBridgeSuccess({ status: 'COMPLETED' })).toBe(true);
    expect(isBridgeSuccess({ bridgeStatus: 'COMPLETED' })).toBe(true);
    expect(isBridgeSuccess({ status: 'FAILED' })).toBe(false);
    expect(isBridgeSuccess({ status: 'SIGNED' })).toBe(false);
  });
});
