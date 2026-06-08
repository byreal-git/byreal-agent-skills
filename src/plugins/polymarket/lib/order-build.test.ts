import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { assembleSignature, extractOrder, toSubmitBody, toEncodeReq } from './order-build.js';
import type { OrderEncodeDTO } from '../types.js';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../__fixtures__/order-encode-binary.json', import.meta.url)), 'utf8'),
);
const realDto = fixture.data as OrderEncodeDTO;

describe('assembleSignature', () => {
  it('concatenates inner sig (0x-stripped) + suffix (0x-stripped) under one 0x', () => {
    const inner = '0x' + 'ab'.repeat(65);
    const suffix = '0x' + 'cd'.repeat(10);
    expect(assembleSignature(inner, suffix)).toBe('0x' + 'ab'.repeat(65) + 'cd'.repeat(10));
  });
  it('accepts suffix without 0x prefix (real DTO suffix is not 0x-prefixed)', () => {
    const inner = '0x' + '11'.repeat(65);
    expect(assembleSignature(inner, '22'.repeat(4))).toBe('0x' + '11'.repeat(65) + '22'.repeat(4));
    expect(String(realDto.signatureSuffix).startsWith('0x')).toBe(false);
  });
});

describe('extractOrder (flat DTO → submit order)', () => {
  it('keeps order fields, drops encode-meta + owner', () => {
    const o = extractOrder(realDto);
    // order fields present
    for (const k of ['salt', 'maker', 'signer', 'taker', 'tokenId', 'makerAmount', 'takerAmount', 'side', 'signatureType', 'timestamp', 'metadata', 'builder']) {
      expect(o[k]).toBeDefined();
    }
    // encode-meta + owner dropped
    for (const k of ['eip712', 'orderId', 'appDomainSep', 'contentsHash', 'signatureSuffix', 'owner', 'orderType']) {
      expect(k in o).toBe(false);
    }
    // invariants from the real fixture
    expect(o.maker).toBe(o.signer);
    expect(o.taker).toBe('0x0000000000000000000000000000000000000000');
    expect(o.signatureType).toBe(3);
  });
});

describe('toSubmitBody', () => {
  it('extracts order from flat DTO, owner stripped, signature assembled, market postOnly=false', () => {
    const innerSig = '0x' + 'bb'.repeat(65);
    const body = toSubmitBody(realDto, innerSig, 'FOK');
    expect(body.orderType).toBe('FOK');
    expect(body.postOnly).toBe(false);
    expect('owner' in body.order).toBe(false);
    expect(body.order.signature).toBe('0x' + 'bb'.repeat(65) + String(realDto.signatureSuffix));
    expect(body.order.maker).toBe(realDto.maker);
  });
});

describe('toEncodeReq', () => {
  it('maps params into the amount-based encode request (default FOK)', () => {
    const req = toEncodeReq({
      walletAddress: '0xE',
      tokenId: 't1',
      side: 'BUY',
      signedPrice: '0.66',
      amount: '5',
      negRisk: true,
    });
    expect(req).toEqual({
      walletAddress: '0xE',
      tokenId: 't1',
      side: 'BUY',
      price: '0.66',
      amount: '5',
      orderType: 'FOK',
      negRisk: true,
    });
  });
});
