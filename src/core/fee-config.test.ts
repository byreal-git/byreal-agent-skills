import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PublicKey } from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import {
  getFeeConfig,
  isFeeEnabled,
  deriveFeeAccount,
  resolveFeeAccountForSwap,
  pickFeeSide,
  MAJOR_MINTS,
  DEFAULT_FEE_RECIPIENT_WALLET,
  DEFAULT_FEE_BPS,
  __resetFeeConfigForTests,
} from './fee-config.js';

const SAMPLE_WALLET = '7QPXY3RHTHNw4oZvJgPNtV4NQpArvQo3CqZoVtFStHh6';
const WSOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
// PYUSD — real Token-2022 mint on mainnet
const PYUSD_MINT = '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo';

function mockAccountInfo(owner: PublicKey) {
  return { owner, lamports: 1_461_600, data: Buffer.alloc(0), executable: false, rentEpoch: 0 };
}

describe('fee-config', () => {
  const originalEnv = { ...process.env };
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    delete process.env.FEE_RECIPIENT_WALLET;
    delete process.env.FEE_BPS;
    // warnOnce is gated by DEBUG (ops-only diagnostic); tests assert on the
    // warning messages, so opt in.
    process.env.DEBUG = '1';
    __resetFeeConfigForTests();
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    errSpy.mockRestore();
  });

  it('returns default config when env vars are unset (fee on by default)', () => {
    const cfg = getFeeConfig();
    expect(cfg).not.toBeNull();
    expect(cfg!.bps).toBe(DEFAULT_FEE_BPS);
    expect(cfg!.recipient.toBase58()).toBe(DEFAULT_FEE_RECIPIENT_WALLET);
    expect(isFeeEnabled()).toBe(true);
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('returns null when FEE_BPS=0 is the explicit kill-switch', () => {
    process.env.FEE_BPS = '0';
    expect(getFeeConfig()).toBeNull();
    expect(isFeeEnabled()).toBe(false);
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('FEE_BPS=0 disables even when FEE_RECIPIENT_WALLET is set', () => {
    process.env.FEE_RECIPIENT_WALLET = SAMPLE_WALLET;
    process.env.FEE_BPS = '0';
    expect(getFeeConfig()).toBeNull();
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('env FEE_RECIPIENT_WALLET overrides default wallet', () => {
    process.env.FEE_RECIPIENT_WALLET = SAMPLE_WALLET;
    const cfg = getFeeConfig();
    expect(cfg!.recipient.toBase58()).toBe(SAMPLE_WALLET);
    expect(cfg!.bps).toBe(DEFAULT_FEE_BPS);
  });

  it('env FEE_BPS overrides default bps', () => {
    process.env.FEE_BPS = '100';
    const cfg = getFeeConfig();
    expect(cfg!.bps).toBe(100);
    expect(cfg!.recipient.toBase58()).toBe(DEFAULT_FEE_RECIPIENT_WALLET);
  });

  it('both env vars set → both override defaults', () => {
    process.env.FEE_RECIPIENT_WALLET = SAMPLE_WALLET;
    process.env.FEE_BPS = '75';
    const cfg = getFeeConfig();
    expect(cfg!.recipient.toBase58()).toBe(SAMPLE_WALLET);
    expect(cfg!.bps).toBe(75);
  });

  it('warns and returns null on non-integer FEE_BPS', () => {
    process.env.FEE_RECIPIENT_WALLET = SAMPLE_WALLET;
    process.env.FEE_BPS = '1.5';
    expect(getFeeConfig()).toBeNull();
    expect(errSpy).toHaveBeenCalledWith(expect.stringMatching(/non-negative integer/));
  });

  it('warns and returns null on negative FEE_BPS', () => {
    process.env.FEE_RECIPIENT_WALLET = SAMPLE_WALLET;
    process.env.FEE_BPS = '-10';
    expect(getFeeConfig()).toBeNull();
    expect(errSpy).toHaveBeenCalledWith(expect.stringMatching(/non-negative integer/));
  });

  it('warns and returns null when FEE_BPS exceeds 10000 (100%)', () => {
    process.env.FEE_RECIPIENT_WALLET = SAMPLE_WALLET;
    process.env.FEE_BPS = '10001';
    expect(getFeeConfig()).toBeNull();
    expect(errSpy).toHaveBeenCalledWith(expect.stringMatching(/exceeds 10000/));
  });

  it('warns and returns null on invalid FEE_RECIPIENT_WALLET', () => {
    process.env.FEE_RECIPIENT_WALLET = 'not-a-real-pubkey';
    process.env.FEE_BPS = '50';
    expect(getFeeConfig()).toBeNull();
    expect(errSpy).toHaveBeenCalledWith(expect.stringMatching(/valid base58 pubkey/));
  });

  it('warnOnce only emits the same warning key once per process', () => {
    process.env.FEE_BPS = '1.5';
    getFeeConfig();
    getFeeConfig();
    getFeeConfig();
    const matching = errSpy.mock.calls.filter((call) =>
      /non-negative integer/.test(String(call[0])),
    );
    expect(matching).toHaveLength(1);
  });

  describe('pickFeeSide', () => {
    const MEME_MINT = 'ThisIsNotAStablecoin11111111111111111111111';

    it('prefers input when input is a major mint', () => {
      expect(pickFeeSide(WSOL_MINT, MEME_MINT)).toEqual({ mint: WSOL_MINT, side: 'input' });
      expect(pickFeeSide(USDC_MINT, MEME_MINT)).toEqual({ mint: USDC_MINT, side: 'input' });
    });

    it('prefers output when only output is major', () => {
      expect(pickFeeSide(MEME_MINT, USDC_MINT)).toEqual({ mint: USDC_MINT, side: 'output' });
      expect(pickFeeSide(MEME_MINT, WSOL_MINT)).toEqual({ mint: WSOL_MINT, side: 'output' });
    });

    it('input wins when both sides are major (SOL→USDC tie-break)', () => {
      expect(pickFeeSide(WSOL_MINT, USDC_MINT)).toEqual({ mint: WSOL_MINT, side: 'input' });
      expect(pickFeeSide(USDC_MINT, WSOL_MINT)).toEqual({ mint: USDC_MINT, side: 'input' });
    });

    it('falls back to input when neither side is major', () => {
      expect(pickFeeSide(MEME_MINT, MEME_MINT)).toEqual({ mint: MEME_MINT, side: 'input' });
    });

    it('MAJOR_MINTS contains the 4 expected mints', () => {
      expect(MAJOR_MINTS.size).toBe(4);
      expect(MAJOR_MINTS.has('So11111111111111111111111111111111111111112')).toBe(true);
      expect(MAJOR_MINTS.has('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')).toBe(true);
      expect(MAJOR_MINTS.has('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB')).toBe(true);
      expect(MAJOR_MINTS.has('USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB')).toBe(true);
    });
  });

  describe('deriveFeeAccount', () => {
    beforeEach(() => {
      process.env.FEE_RECIPIENT_WALLET = SAMPLE_WALLET;
      process.env.FEE_BPS = '50';
    });

    it('derives deterministic legacy ATA by default', () => {
      const ata = deriveFeeAccount(WSOL_MINT);
      expect(ata).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
      expect(deriveFeeAccount(WSOL_MINT)).toBe(ata);
    });

    it('derives different ATA under Token-2022 program', () => {
      const legacy = deriveFeeAccount(PYUSD_MINT, undefined, TOKEN_PROGRAM_ID);
      const token2022 = deriveFeeAccount(PYUSD_MINT, undefined, TOKEN_2022_PROGRAM_ID);
      expect(legacy).not.toBe(token2022);
    });

    it('throws when fee is disabled (FEE_BPS=0)', () => {
      process.env.FEE_BPS = '0';
      expect(() => deriveFeeAccount(WSOL_MINT)).toThrow(/fee is not enabled/);
    });
  });

  describe('resolveFeeAccountForSwap', () => {
    beforeEach(() => {
      process.env.FEE_RECIPIENT_WALLET = SAMPLE_WALLET;
      process.env.FEE_BPS = '50';
    });

    it('returns null when fee is disabled (FEE_BPS=0)', async () => {
      process.env.FEE_BPS = '0';
      const conn = { getAccountInfo: vi.fn() } as unknown as import('@solana/web3.js').Connection;
      expect(await resolveFeeAccountForSwap(WSOL_MINT, conn)).toBeNull();
      expect((conn.getAccountInfo as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    });

    it('derives ATA under legacy SPL program when mint is owned by legacy Token program', async () => {
      // First getAccountInfo call = mint lookup (legacy owner),
      // second = ATA existence check.
      const getAccountInfo = vi
        .fn()
        .mockResolvedValueOnce(mockAccountInfo(TOKEN_PROGRAM_ID))
        .mockResolvedValueOnce(mockAccountInfo(TOKEN_PROGRAM_ID));
      const conn = { getAccountInfo } as unknown as import('@solana/web3.js').Connection;
      const ata = await resolveFeeAccountForSwap(WSOL_MINT, conn);
      const expectedLegacy = getAssociatedTokenAddressSync(
        new PublicKey(WSOL_MINT),
        new PublicKey(SAMPLE_WALLET),
        false,
        TOKEN_PROGRAM_ID,
      ).toBase58();
      expect(ata).toBe(expectedLegacy);
    });

    it('derives ATA under Token-2022 program when mint is owned by Token-2022', async () => {
      const getAccountInfo = vi
        .fn()
        .mockResolvedValueOnce(mockAccountInfo(TOKEN_2022_PROGRAM_ID))
        .mockResolvedValueOnce(mockAccountInfo(TOKEN_2022_PROGRAM_ID));
      const conn = { getAccountInfo } as unknown as import('@solana/web3.js').Connection;
      const ata = await resolveFeeAccountForSwap(PYUSD_MINT, conn);
      const expectedToken2022 = getAssociatedTokenAddressSync(
        new PublicKey(PYUSD_MINT),
        new PublicKey(SAMPLE_WALLET),
        false,
        TOKEN_2022_PROGRAM_ID,
      ).toBase58();
      expect(ata).toBe(expectedToken2022);
      // Same mint queried twice → mint program cache hit on 2nd call.
      await resolveFeeAccountForSwap(PYUSD_MINT, conn);
      // 2 calls in first resolve (mint + ata) + 1 in second (ata only, cache hit for both)
      // The ata existence cache also kicks in, so 2nd resolve makes 0 calls.
      expect(getAccountInfo).toHaveBeenCalledTimes(2);
    });

    it('falls back to legacy program when mint lookup RPC fails', async () => {
      const getAccountInfo = vi
        .fn()
        .mockRejectedValueOnce(new Error('RPC down'))
        .mockResolvedValueOnce(mockAccountInfo(TOKEN_PROGRAM_ID));
      const conn = { getAccountInfo } as unknown as import('@solana/web3.js').Connection;
      const ata = await resolveFeeAccountForSwap(WSOL_MINT, conn);
      const expectedLegacy = getAssociatedTokenAddressSync(
        new PublicKey(WSOL_MINT),
        new PublicKey(SAMPLE_WALLET),
        false,
        TOKEN_PROGRAM_ID,
      ).toBase58();
      expect(ata).toBe(expectedLegacy);
      expect(errSpy).toHaveBeenCalledWith(expect.stringMatching(/Failed to query mint program/));
    });

    it('falls back to legacy and warns when mint owner is an unknown program', async () => {
      const bogusProgram = new PublicKey('11111111111111111111111111111111');
      const getAccountInfo = vi
        .fn()
        .mockResolvedValueOnce(mockAccountInfo(bogusProgram))
        .mockResolvedValueOnce(mockAccountInfo(TOKEN_PROGRAM_ID));
      const conn = { getAccountInfo } as unknown as import('@solana/web3.js').Connection;
      await resolveFeeAccountForSwap(WSOL_MINT, conn);
      expect(errSpy).toHaveBeenCalledWith(expect.stringMatching(/not a known token program/));
    });

    it('returns null and warns when the ATA does not exist on-chain', async () => {
      const getAccountInfo = vi
        .fn()
        .mockResolvedValueOnce(mockAccountInfo(TOKEN_PROGRAM_ID)) // mint
        .mockResolvedValueOnce(null); // ata
      const conn = { getAccountInfo } as unknown as import('@solana/web3.js').Connection;
      expect(await resolveFeeAccountForSwap(WSOL_MINT, conn)).toBeNull();
      expect(errSpy).toHaveBeenCalledWith(expect.stringMatching(/does not exist on-chain/));
    });

    it('caches the ATA-exists result per (recipient, mint)', async () => {
      const getAccountInfo = vi
        .fn()
        .mockResolvedValueOnce(mockAccountInfo(TOKEN_PROGRAM_ID)) // WSOL mint
        .mockResolvedValueOnce(mockAccountInfo(TOKEN_PROGRAM_ID)) // WSOL ata
        .mockResolvedValueOnce(mockAccountInfo(TOKEN_PROGRAM_ID)) // USDC mint
        .mockResolvedValueOnce(mockAccountInfo(TOKEN_PROGRAM_ID)); // USDC ata
      const conn = { getAccountInfo } as unknown as import('@solana/web3.js').Connection;
      await resolveFeeAccountForSwap(WSOL_MINT, conn);
      await resolveFeeAccountForSwap(WSOL_MINT, conn);
      await resolveFeeAccountForSwap(WSOL_MINT, conn);
      expect(getAccountInfo).toHaveBeenCalledTimes(2); // mint + ata once each
      await resolveFeeAccountForSwap(USDC_MINT, conn);
      expect(getAccountInfo).toHaveBeenCalledTimes(4); // +mint +ata for USDC
    });

    it('derives ATA even for off-curve (PDA / multisig) treasury', async () => {
      // System Program pubkey is off the Ed25519 curve. Supporting this is
      // required because the default built-in treasury is off-curve.
      process.env.FEE_RECIPIENT_WALLET = '11111111111111111111111111111112';
      const getAccountInfo = vi
        .fn()
        .mockResolvedValueOnce(mockAccountInfo(TOKEN_PROGRAM_ID))
        .mockResolvedValueOnce(mockAccountInfo(TOKEN_PROGRAM_ID));
      const conn = { getAccountInfo } as unknown as import('@solana/web3.js').Connection;
      const ata = await resolveFeeAccountForSwap(WSOL_MINT, conn);
      expect(ata).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
      // Both the mint lookup AND the ATA existence check ran — no derivation failure.
      expect(getAccountInfo).toHaveBeenCalledTimes(2);
    });

    it('fails open (returns derived ATA) when ATA existence RPC throws', async () => {
      const getAccountInfo = vi
        .fn()
        .mockResolvedValueOnce(mockAccountInfo(TOKEN_PROGRAM_ID)) // mint
        .mockRejectedValueOnce(new Error('RPC down')); // ata
      const conn = { getAccountInfo } as unknown as import('@solana/web3.js').Connection;
      const ata = await resolveFeeAccountForSwap(WSOL_MINT, conn);
      expect(ata).toBe(
        getAssociatedTokenAddressSync(
          new PublicKey(WSOL_MINT),
          new PublicKey(SAMPLE_WALLET),
          false,
          TOKEN_PROGRAM_ID,
        ).toBase58(),
      );
      expect(errSpy).toHaveBeenCalledWith(expect.stringMatching(/Failed to verify fee ATA/));
    });
  });
});
