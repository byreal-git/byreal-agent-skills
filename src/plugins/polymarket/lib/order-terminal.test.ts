import { describe, it, expect } from 'vitest';
import { isTerminalStatus, classifyPoll } from './order-terminal.js';

describe('isTerminalStatus', () => {
  it('market: live and delayed are NON-terminal', () => {
    expect(isTerminalStatus('live', 'market')).toBe(false);
    expect(isTerminalStatus('delayed', 'market')).toBe(false);
  });
  it('market: matched/canceled/unmatched are terminal', () => {
    expect(isTerminalStatus('matched', 'market')).toBe(true);
    expect(isTerminalStatus('canceled', 'market')).toBe(true);
    expect(isTerminalStatus('unmatched', 'market')).toBe(true);
  });
  it('market: case-insensitive', () => {
    expect(isTerminalStatus('LIVE', 'market')).toBe(false);
    expect(isTerminalStatus('MATCHED', 'market')).toBe(true);
  });
  it('limit: live IS terminal (accepted)', () => {
    expect(isTerminalStatus('live', 'limit')).toBe(true);
  });
});

describe('classifyPoll', () => {
  it('returns settled with the order when terminal', () => {
    const r = classifyPoll({ id: 'o1', status: 'matched' }, false);
    expect(r.outcome).toBe('settled');
    expect(r.order.id).toBe('o1');
  });
  it('returns pending when not terminal and timed out', () => {
    const r = classifyPoll({ id: 'o1', status: 'live' }, true);
    expect(r.outcome).toBe('pending');
  });
  it('returns continue when not terminal and not timed out', () => {
    const r = classifyPoll({ id: 'o1', status: 'live' }, false);
    expect(r.outcome).toBe('continue');
  });
});
