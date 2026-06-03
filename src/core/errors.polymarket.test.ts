import { describe, it, expect } from 'vitest';
import {
  ErrorCodes,
  categoryNotFoundError,
  eventNotFoundError,
  eventNotTradableError,
  noMatchError,
  eventSearchUnavailableError,
  previewExpiredError,
  proxyWalletUnavailableError,
  unsupportedAssetError,
} from './errors.js';

describe('polymarket error factories', () => {
  it('categoryNotFoundError → CATEGORY_NOT_FOUND, BUSINESS, safe_user_message + user_action_required', () => {
    const e = categoryNotFoundError('world-cup');
    expect(e.code).toBe(ErrorCodes.CATEGORY_NOT_FOUND);
    expect(e.type).toBe('BUSINESS');
    expect(e.retryable).toBe(false);
    expect(typeof e.details?.safe_user_message).toBe('string');
    expect(e.details?.user_action_required).toBe(true);
    expect(e.details?.category_id).toBe('world-cup');
  });

  it('eventNotFoundError → EVENT_NOT_FOUND with event id detail', () => {
    const e = eventNotFoundError('53042');
    expect(e.code).toBe(ErrorCodes.EVENT_NOT_FOUND);
    expect(e.type).toBe('BUSINESS');
    expect(e.details?.event_id).toBe('53042');
  });

  it('eventNotTradableError → EVENT_NOT_TRADABLE carries reason', () => {
    const e = eventNotTradableError('53042', 'closed');
    expect(e.code).toBe(ErrorCodes.EVENT_NOT_TRADABLE);
    expect(e.details?.reason).toBe('closed');
  });

  it('noMatchError → NO_MATCH, not retryable', () => {
    const e = noMatchError('FIFA World Cup Group A Winner');
    expect(e.code).toBe(ErrorCodes.NO_MATCH);
    expect(e.retryable).toBe(false);
    expect(e.details?.query).toBe('FIFA World Cup Group A Winner');
  });

  it('eventSearchUnavailableError → EVENT_SEARCH_UNAVAILABLE, retryable (SOURCE-like)', () => {
    const e = eventSearchUnavailableError('gateway 502');
    expect(e.code).toBe(ErrorCodes.EVENT_SEARCH_UNAVAILABLE);
    expect(e.retryable).toBe(true);
  });

  it('previewExpiredError → PREVIEW_EXPIRED, retryable, reason in details', () => {
    const e = previewExpiredError('price drift exceeded');
    expect(e.code).toBe(ErrorCodes.PREVIEW_EXPIRED);
    expect(e.type).toBe('BUSINESS');
    expect(e.retryable).toBe(true);
    expect(e.details?.reason).toBe('price drift exceeded');
    // has a suggestion to re-run preview
    expect((e.suggestions?.length ?? 0)).toBeGreaterThan(0);
  });

  it('proxyWalletUnavailableError → PROXY_WALLET_UNAVAILABLE', () => {
    const e = proxyWalletUnavailableError('0xEOA');
    expect(e.code).toBe(ErrorCodes.PROXY_WALLET_UNAVAILABLE);
    expect(e.details?.eoa).toBe('0xEOA');
  });

  it('unsupportedAssetError → UNSUPPORTED_ASSET, VALIDATION', () => {
    const e = unsupportedAssetError('WBTC');
    expect(e.code).toBe(ErrorCodes.UNSUPPORTED_ASSET);
    expect(e.type).toBe('VALIDATION');
  });
});
