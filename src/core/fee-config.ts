/**
 * Platform fee configuration — shared across swap aggregator plugins.
 *
 * Defaults: fee collection is **on by default** with the built-in treasury
 * `DEFAULT_FEE_RECIPIENT_WALLET` @ `DEFAULT_FEE_BPS`. Env vars override:
 *   - FEE_RECIPIENT_WALLET = treasury owner address (base58, NOT the ATA)
 *   - FEE_BPS             = integer basis points; explicit `0` disables fee
 *                           entirely (returns null, no fee params sent)
 *
 * Error strategy: **graceful degradation**. Top priority is keeping swaps
 * working for the user, so misconfiguration (bad pubkey, bad bps, missing
 * on-chain ATA) is logged to stderr once and the swap proceeds fee-free.
 *
 * Fee side policy (see `pickFeeSide`): prefer input if input is a major mint;
 * else prefer output if output is a major mint; else fall back to input.
 * Aligning fee side with the major-mint side lets Ops pre-build ATAs for a
 * small set of treasury mints (SOL / USDC / USDT / USD1).
 *
 * Token-2022 support: `resolveFeeAccountForSwap` looks up each mint's owning
 * SPL program (legacy `TokenkegQfe...` vs Token-2022 `TokenzQdB...`) before
 * deriving the ATA, because the two programs produce different PDAs for the
 * same (owner, mint) pair. Treasury must pre-create its ATAs under the
 * matching program (`spl-token create-account <mint> --program-id <id>`).
 * The resolved token program is exposed via `resolveMintTokenProgram` so
 * Jupiter callers can append `instructionVersion=V2` when the fee mint is
 * Token-2022 (V1 `Route` uses legacy `Token::Transfer` and fails with
 * `InvalidAccountData` on Token-2022 ATAs — verified on mainnet).
 */

import { Connection, PublicKey } from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";

export interface FeeConfig {
  recipient: PublicKey;
  bps: number;
}

export type FeeSide = "input" | "output";

export const DEFAULT_FEE_RECIPIENT_WALLET =
  "48fcHTG4Y2xLSNUyH3CtLEL67ZseJyQes1trLgLtNNSp";
export const DEFAULT_FEE_BPS = 50;

/**
 * Major mints whose ATAs the treasury pre-builds. Fee side is picked to land
 * on one of these when possible so Ops only manages a handful of ATAs.
 */
export const MAJOR_MINTS: ReadonlySet<string> = new Set([
  "So11111111111111111111111111111111111111112", // Wrapped SOL
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
  "USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB",  // USD1
]);

/**
 * Choose which side of the swap carries the platform fee.
 *
 * Rule: input wins if it's a major mint (covers the common X/stablecoin case
 * symmetrically, AND the stablecoin→stablecoin tie-break). Fall through to
 * output-side major. Final fallback: input (matches the original policy so
 * obscure long-tail swaps still produce a deterministic fee ATA).
 */
export function pickFeeSide(
  inputMint: string,
  outputMint: string,
): { mint: string; side: FeeSide } {
  if (MAJOR_MINTS.has(inputMint)) return { mint: inputMint, side: "input" };
  if (MAJOR_MINTS.has(outputMint)) return { mint: outputMint, side: "output" };
  return { mint: inputMint, side: "input" };
}

const warnedKeys = new Set<string>();
/**
 * Internal diagnostic, gated by `DEBUG` to keep the CLI output clean — fee is
 * transparent to the user, so ATA / env / RPC degradation paths are ops
 * concerns, not user messaging. Ops can run with `DEBUG=1` to see them.
 */
function warnOnce(key: string, message: string): void {
  if (warnedKeys.has(key)) return;
  warnedKeys.add(key);
  if (process.env.DEBUG) {
    console.error(`[fee-config] ${message}`);
  }
}

// Cache `${recipientBase58}:${mint}` -> boolean so the ATA check runs once per
// (treasury, mint) per process. Ensures /quote and /swap see the same answer.
const ataExistsCache = new Map<string, boolean>();

// Cache mint -> token program (legacy SPL vs Token-2022). Same mint always
// owned by the same program, so this is pure memoization per process.
const mintProgramCache = new Map<string, PublicKey>();

/**
 * Look up which SPL token program owns a given mint (legacy vs Token-2022).
 * Needed because the ATA PDA is derived from the mint's program id; deriving
 * with the wrong id produces an address the treasury didn't create.
 *
 * Fails open to legacy `TOKEN_PROGRAM_ID` on RPC failure / unknown owner so
 * the caller still has *some* ATA to verify — the subsequent on-chain
 * existence check catches the miss and degrades cleanly.
 */
export async function resolveMintTokenProgram(
  mint: string,
  connection: Connection,
): Promise<PublicKey> {
  const cached = mintProgramCache.get(mint);
  if (cached) return cached;

  try {
    const info = await connection.getAccountInfo(
      new PublicKey(mint),
      "confirmed",
    );
    if (!info) {
      warnOnce(
        `mint-missing:${mint}`,
        `Mint ${mint} not found on-chain — assuming legacy SPL Token`,
      );
      mintProgramCache.set(mint, TOKEN_PROGRAM_ID);
      return TOKEN_PROGRAM_ID;
    }
    const owner = info.owner;
    if (
      !owner.equals(TOKEN_PROGRAM_ID) &&
      !owner.equals(TOKEN_2022_PROGRAM_ID)
    ) {
      warnOnce(
        `mint-unknown-program:${mint}`,
        `Mint ${mint} owner ${owner.toBase58()} is not a known token program — falling back to legacy`,
      );
      mintProgramCache.set(mint, TOKEN_PROGRAM_ID);
      return TOKEN_PROGRAM_ID;
    }
    mintProgramCache.set(mint, owner);
    return owner;
  } catch (error) {
    warnOnce(
      `mint-rpc-error:${mint}`,
      `Failed to query mint program for ${mint} (${(error as Error).message}) — assuming legacy SPL Token`,
    );
    return TOKEN_PROGRAM_ID;
  }
}

/**
 * Resolve the effective fee configuration.
 *
 * Fee collection is ON by default (`DEFAULT_FEE_RECIPIENT_WALLET` @
 * `DEFAULT_FEE_BPS`). Environment variables can override either field:
 *   - `FEE_RECIPIENT_WALLET` overrides the treasury owner pubkey
 *   - `FEE_BPS` overrides the basis points
 *
 * To disable fees entirely, set `FEE_BPS=0` — this is the sole kill-switch
 * and returns `null`. Any other misconfiguration (bad pubkey, non-integer
 * bps, bps > 10000) emits a one-time stderr warning and also returns `null`
 * so swaps proceed fee-free rather than breaking.
 */
export function getFeeConfig(): FeeConfig | null {
  const rawWallet = process.env.FEE_RECIPIENT_WALLET;
  const rawBps = process.env.FEE_BPS;

  const rawBpsTrimmed =
    typeof rawBps === "string" ? rawBps.trim() : "";
  // Explicit disable: FEE_BPS=0 is the documented kill-switch.
  if (rawBpsTrimmed === "0") return null;

  const walletStr =
    typeof rawWallet === "string" && rawWallet.trim().length > 0
      ? rawWallet.trim()
      : DEFAULT_FEE_RECIPIENT_WALLET;
  const bpsStr = rawBpsTrimmed.length > 0 ? rawBpsTrimmed : String(DEFAULT_FEE_BPS);

  const bps = Number(bpsStr);
  if (!Number.isInteger(bps) || bps < 0) {
    warnOnce(
      `bad-bps:${bpsStr}`,
      `FEE_BPS must be a non-negative integer, got: ${bpsStr} — fee disabled`,
    );
    return null;
  }
  if (bps > 10_000) {
    warnOnce(
      `bps-too-high:${bps}`,
      `FEE_BPS exceeds 10000 (100%), got: ${bps} — fee disabled`,
    );
    return null;
  }

  let recipient: PublicKey;
  try {
    recipient = new PublicKey(walletStr);
  } catch {
    warnOnce(
      `bad-wallet:${walletStr}`,
      `FEE_RECIPIENT_WALLET is not a valid base58 pubkey: ${walletStr} — fee disabled`,
    );
    return null;
  }

  return { recipient, bps };
}

export function isFeeEnabled(): boolean {
  return getFeeConfig() !== null;
}

/**
 * Derive the fee treasury's Associated Token Account for the given mint.
 * Pure address derivation — does not touch chain.
 *
 * `tokenProgramId` selects the SPL token program to derive under:
 *   - omit / `TOKEN_PROGRAM_ID` → legacy SPL ATA (default, matches 99% of mints)
 *   - `TOKEN_2022_PROGRAM_ID`   → Token-2022 ATA (different PDA seed)
 *
 * Callers that don't know which program a mint belongs to should use
 * `resolveFeeAccountForSwap`, which queries the mint on-chain first.
 *
 * `allowOwnerOffCurve=true` so the treasury can be a PDA (e.g. Squads multisig
 * vault) — the default built-in treasury is off-curve. On-curve wallets
 * derive to the same ATA either way; `true` is strictly a superset.
 */
export function deriveFeeAccount(
  mint: string,
  config?: FeeConfig,
  tokenProgramId?: PublicKey,
): string {
  const cfg = config ?? getFeeConfig();
  if (!cfg) {
    throw new Error("deriveFeeAccount called but fee is not enabled");
  }
  const mintPubkey = new PublicKey(mint);
  return getAssociatedTokenAddressSync(
    mintPubkey,
    cfg.recipient,
    true,
    tokenProgramId ?? TOKEN_PROGRAM_ID,
  ).toBase58();
}

/**
 * Resolve the fee account for a given input mint, including the on-chain ATA
 * existence check. Returns null if:
 *   - fee is disabled (env unset / misconfigured);
 *   - the treasury's ATA for this mint does not exist on-chain.
 *
 * On RPC failure we fail **open** (return the derived ATA and let the
 * aggregator surface any error) — transient RPC flakes should not silently
 * disable fees forever. The result is cached per `(recipient, mint)` so
 * `/quote` and `/swap` always see the same answer within one CLI invocation.
 */
export async function resolveFeeAccountForSwap(
  mint: string,
  connection: Connection,
  config?: FeeConfig,
): Promise<string | null> {
  const cfg = config ?? getFeeConfig();
  if (!cfg) return null;

  const tokenProgram = await resolveMintTokenProgram(mint, connection);

  let ata: string;
  try {
    ata = deriveFeeAccount(mint, cfg, tokenProgram);
  } catch (error) {
    warnOnce(
      `ata-derive-error:${cfg.recipient.toBase58()}:${mint}`,
      `Failed to derive fee ATA for mint ${mint} (${(error as Error).message}) — fee disabled for this mint`,
    );
    return null;
  }
  const cacheKey = `${cfg.recipient.toBase58()}:${mint}`;
  const cached = ataExistsCache.get(cacheKey);
  if (cached === true) return ata;
  if (cached === false) return null;

  try {
    const info = await connection.getAccountInfo(
      new PublicKey(ata),
      "confirmed",
    );
    const exists = info !== null;
    ataExistsCache.set(cacheKey, exists);
    if (!exists) {
      warnOnce(
        `ata-missing:${cacheKey}`,
        `Fee treasury ATA does not exist on-chain for mint ${mint} (ata=${ata}) — fee disabled for this mint`,
      );
      return null;
    }
    return ata;
  } catch (error) {
    warnOnce(
      `ata-rpc-error:${cacheKey}`,
      `Failed to verify fee ATA on-chain (${(error as Error).message}) — assuming it exists`,
    );
    return ata;
  }
}

/**
 * Test-only helper: clear warnOnce / ATA / mint-program caches between cases.
 */
export function __resetFeeConfigForTests(): void {
  warnedKeys.clear();
  ataExistsCache.clear();
  mintProgramCache.clear();
}
