import { describe, it, expect, afterEach, vi } from 'vitest';
import { encodeOrder } from './market.js';
import { submitOrder, getOrderStatus } from './order.js';
import { getBalanceAllowance } from './clob-account.js';

const auth = { token: 'oc_at_t', evmAddress: '0xE' };

function stub(status: number, body: unknown, capture?: { url?: string }) {
  vi.stubGlobal('fetch', async (url: string) => {
    if (capture) capture.url = url;
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
}

describe('api wrappers', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('encodeOrder unwraps the /v1 business envelope → flat OrderEncodeDTO', async () => {
    stub(200, {
      success: true,
      ret_code: 0,
      data: { signatureSuffix: 'aa', maker: '0xm', signer: '0xm', side: 'BUY', eip712: {} },
    });
    const r = await encodeOrder(
      { walletAddress: '0xE', tokenId: 't', side: 'BUY', price: '0.5', amount: '5', orderType: 'FOK', negRisk: false },
      auth,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.signatureSuffix).toBe('aa');
  });

  it('encodeOrder surfaces a /v1 envelope error (ret_code != 0)', async () => {
    stub(200, { success: false, ret_code: 500, ret_msg: 'Internal Server Error', data: null });
    const r = await encodeOrder(
      { walletAddress: '0xE', tokenId: 't', side: 'BUY', price: '0.5', amount: '5', orderType: 'FOK', negRisk: false },
      auth,
    );
    expect(r.ok).toBe(false);
  });

  it('submitOrder returns the RAW /clob OrderResponse (no envelope)', async () => {
    stub(200, { success: true, orderID: 'o1', status: 'matched' });
    const r = await submitOrder({ order: {}, orderType: 'FOK', postOnly: false }, auth);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.orderID).toBe('o1');
  });

  it('getOrderStatus returns raw OpenOrder, path includes order id', async () => {
    const cap: { url?: string } = {};
    stub(200, { id: 'o9', status: 'live' }, cap);
    const r = await getOrderStatus('o9', auth);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.status).toBe('live');
    expect(cap.url).toContain('/clob/data/order/o9');
  });

  it('getBalanceAllowance routes SELL with token_id; raw /clob body', async () => {
    const cap: { url?: string } = {};
    stub(200, { balance: '9', allowances: {} }, cap);
    const r = await getBalanceAllowance('CONDITIONAL', 'tok9', auth);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.balance).toBe('9');
    expect(cap.url).toContain('asset_type=CONDITIONAL');
    expect(cap.url).toContain('token_id=tok9');
    expect(cap.url).toContain('signature_type=3');
  });

  it('getBalanceAllowance BUY uses COLLATERAL and omits token_id', async () => {
    const cap: { url?: string } = {};
    stub(200, { balance: '100' }, cap);
    const r = await getBalanceAllowance('COLLATERAL', undefined, auth);
    expect(r.ok).toBe(true);
    expect(cap.url).toContain('asset_type=COLLATERAL');
    expect(cap.url).not.toContain('token_id');
  });
});
