import { describe, it, expect } from 'vitest';
import { assembleSignature, stripOwner, toSubmitBody, toEncodeReq } from './order-build.js';
import type { OrderEncodeDTO } from '../types.js';

describe('assembleSignature', () => {
  it('concatenates inner sig (0x-stripped) + suffix (0x-stripped) under one 0x', () => {
    const inner = '0x' + 'ab'.repeat(65);
    const suffix = '0x' + 'cd'.repeat(10);
    expect(assembleSignature(inner, suffix)).toBe('0x' + 'ab'.repeat(65) + 'cd'.repeat(10));
  });
  it('accepts suffix without 0x prefix', () => {
    const inner = '0x' + '11'.repeat(65);
    expect(assembleSignature(inner, '22'.repeat(4))).toBe('0x' + '11'.repeat(65) + '22'.repeat(4));
  });
  it('accepts inner sig without 0x prefix', () => {
    expect(assembleSignature('33'.repeat(65), '0x' + '44'.repeat(2))).toBe(
      '0x' + '33'.repeat(65) + '44'.repeat(2),
    );
  });
});

describe('stripOwner', () => {
  it('removes owner, keeps everything else', () => {
    const o = { maker: '0xm', owner: '0xo', makerAmount: '5' };
    const s = stripOwner(o);
    expect('owner' in s).toBe(false);
    expect(s.maker).toBe('0xm');
    expect(s.makerAmount).toBe('5');
  });
  it('is a no-op when there is no owner', () => {
    const o = { maker: '0xm' };
    expect(stripOwner(o)).toEqual({ maker: '0xm' });
  });
});

describe('toSubmitBody', () => {
  it('injects assembled signature on the order, owner stripped, market postOnly=false', () => {
    const dto = {
      eip712: {} as never,
      signatureSuffix: 'aa',
      order: { maker: '0xm', owner: '0xo' },
    } as unknown as OrderEncodeDTO;
    const body = toSubmitBody(dto, '0x' + 'bb'.repeat(65), 'FOK');
    expect(body.orderType).toBe('FOK');
    expect(body.postOnly).toBe(false);
    expect('owner' in body.order).toBe(false);
    expect(body.order.signature).toBe('0x' + 'bb'.repeat(65) + 'aa');
  });
});

describe('toEncodeReq', () => {
  it('maps params into the encode request shape (default FOK)', () => {
    const req = toEncodeReq({
      walletAddress: '0xE',
      tokenId: 't1',
      conditionId: 'c1',
      side: 'BUY',
      signedPrice: '0.66',
      size: '7',
      negRisk: true,
    });
    expect(req).toEqual({
      walletAddress: '0xE',
      tokenId: 't1',
      conditionId: 'c1',
      side: 'BUY',
      price: '0.66',
      size: '7',
      orderType: 'FOK',
      negRisk: true,
    });
  });
});
