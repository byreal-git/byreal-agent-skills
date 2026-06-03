import { describe, it, expect } from 'vitest';
import { parseStringArray, parseNumberArray, deriveYesNo } from './parse.js';

describe('parseStringArray', () => {
  it('parses a JSON string array', () => {
    expect(parseStringArray('["Yes", "No"]')).toEqual(['Yes', 'No']);
  });
  it('returns [] for malformed / empty / non-array', () => {
    expect(parseStringArray('not json')).toEqual([]);
    expect(parseStringArray('')).toEqual([]);
    expect(parseStringArray(undefined)).toEqual([]);
    expect(parseStringArray('{"a":1}')).toEqual([]);
  });
  it('coerces non-string entries to strings', () => {
    expect(parseStringArray('[1, 2]')).toEqual(['1', '2']);
  });
});

describe('parseNumberArray', () => {
  it('parses numeric strings', () => {
    expect(parseNumberArray('["0.3545", "0.6455"]')).toEqual([0.3545, 0.6455]);
  });
  it('returns [] for malformed', () => {
    expect(parseNumberArray('x')).toEqual([]);
  });
});

describe('deriveYesNo', () => {
  it('aligns Yes/No prices and token ids by outcome index', () => {
    const m = {
      outcomes: '["Yes", "No"]',
      outcomePrices: '["0.3545", "0.6455"]',
      clobTokenIds: '["111", "222"]',
    };
    expect(deriveYesNo(m)).toEqual({
      yesPrice: 0.3545,
      noPrice: 0.6455,
      yesTokenId: '111',
      noTokenId: '222',
    });
  });

  it('handles reversed outcome order (No first)', () => {
    const m = {
      outcomes: '["No", "Yes"]',
      outcomePrices: '["0.9", "0.1"]',
      clobTokenIds: '["NO_TOK", "YES_TOK"]',
    };
    expect(deriveYesNo(m)).toEqual({
      yesPrice: 0.1,
      noPrice: 0.9,
      yesTokenId: 'YES_TOK',
      noTokenId: 'NO_TOK',
    });
  });

  it('is case-insensitive on outcome labels', () => {
    const m = {
      outcomes: '["YES", "no"]',
      outcomePrices: '["0.2", "0.8"]',
      clobTokenIds: '["a", "b"]',
    };
    expect(deriveYesNo(m).yesPrice).toBe(0.2);
    expect(deriveYesNo(m).noTokenId).toBe('b');
  });

  it('returns nulls when fields are missing/malformed', () => {
    expect(deriveYesNo({})).toEqual({
      yesPrice: null,
      noPrice: null,
      yesTokenId: null,
      noTokenId: null,
    });
  });
});
