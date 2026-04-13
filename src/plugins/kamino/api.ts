/**
 * Kamino Finance REST API client
 * Docs: https://api.kamino.finance
 */

import type { Result } from '../../core/types.js';
import { ok, err } from '../../core/types.js';
import { networkError, apiError } from '../../core/errors.js';
import type { ByrealError } from '../../core/errors.js';
import { rawToUi } from '../../core/amounts.js';
import * as jupiterApi from '../jupiter/api.js';
import type {
  KaminoTransactionResponse,
  KaminoObligation,
  KaminoObligationDeposit,
  KaminoObligationBorrow,
  KaminoReserveMetrics,
  RawKaminoObligationResponse,
} from './types.js';

const KAMINO_API = 'https://api.kamino.finance';

// Well-known addresses
export const KAMINO_MAIN_MARKET = '7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF';
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

const NULL_RESERVE = '11111111111111111111111111111111';
const SF_DIVISOR = BigInt(2) ** BigInt(60); // 2^60 scale factor for Sf-encoded values

// Mint → Reserve mapping for Main Market (Kamino API requires reserve address, not mint)
const MAIN_MARKET_RESERVES: Record<string, string> = {
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 'D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59',  // USDC
  'So11111111111111111111111111111111111111112': 'd4A2prbA2nCUQC7CyJkBF9LN8F61cDzCcGJJYsC6Lfz',     // SOL
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': 'H3t2fcWBBkV1UfMMjKHJnGJvUe7P7RNJSBHsqWvagoyK',  // USDT
};

// Reverse mapping: reserve address → token info
const RESERVE_TOKEN_MAP: Record<string, { mint: string; symbol: string; decimals: number }> = {
  'D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59': { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', symbol: 'USDC', decimals: 6 },
  'd4A2prbA2nCUQC7CyJkBF9LN8F61cDzCcGJJYsC6Lfz':  { mint: 'So11111111111111111111111111111111111111112', symbol: 'SOL', decimals: 9 },
  'H3t2fcWBBkV1UfMMjKHJnGJvUe7P7RNJSBHsqWvagoyK': { mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', symbol: 'USDT', decimals: 6 },
};

/**
 * Resolve a token mint to a Kamino reserve address for the given market.
 * Falls back to the mint itself if no mapping is found (caller should use --reserve).
 */
export function resolveReserve(mint: string, market?: string): string {
  if (market && market !== KAMINO_MAIN_MARKET) {
    return mint;
  }
  return MAIN_MARKET_RESERVES[mint] ?? mint;
}

// ============================================
// Deposit
// ============================================

export async function deposit(params: {
  wallet: string;
  market?: string;
  reserve: string;
  amount: string;
}): Promise<Result<KaminoTransactionResponse, ByrealError>> {
  try {
    const response = await fetch(`${KAMINO_API}/ktx/klend/deposit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        wallet: params.wallet,
        market: params.market ?? KAMINO_MAIN_MARKET,
        reserve: params.reserve,
        amount: params.amount,
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      return err(apiError(`Kamino deposit failed: ${text}`, response.status));
    }
    const data = await response.json() as KaminoTransactionResponse;
    return ok(data);
  } catch (error) {
    return err(networkError(`Kamino deposit: ${(error as Error).message}`));
  }
}

// ============================================
// Withdraw
// ============================================

export async function withdraw(params: {
  wallet: string;
  market?: string;
  reserve: string;
  amount: string;
}): Promise<Result<KaminoTransactionResponse, ByrealError>> {
  try {
    const response = await fetch(`${KAMINO_API}/ktx/klend/withdraw`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        wallet: params.wallet,
        market: params.market ?? KAMINO_MAIN_MARKET,
        reserve: params.reserve,
        amount: params.amount,
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      return err(apiError(`Kamino withdraw failed: ${text}`, response.status));
    }
    const data = await response.json() as KaminoTransactionResponse;
    return ok(data);
  } catch (error) {
    return err(networkError(`Kamino withdraw: ${(error as Error).message}`));
  }
}

// ============================================
// User Obligations (Positions)
// ============================================

/**
 * Decode a Sf (Scale Factor) encoded value to raw token units.
 * Kamino stores some values (e.g. borrowedAmountSf) scaled by 2^60.
 */
function sfToRaw(valueSf: string): string {
  if (valueSf === '0') return '0';
  try {
    const raw = BigInt(valueSf) / SF_DIVISOR;
    return raw.toString();
  } catch {
    return '0';
  }
}

interface RawReserveMetrics {
  reserve: string;
  liquidityToken: string;
  liquidityTokenMint: string;
  maxLtv: string;
  supplyApy: string;
  borrowApy: string;
  totalSupply: string;
  totalBorrow: string;
  totalSupplyUsd: string;
  totalBorrowUsd: string;
}

function toReserveMetrics(r: RawReserveMetrics): KaminoReserveMetrics {
  const totalSupplyUsd = parseFloat(r.totalSupplyUsd) || 0;
  const totalBorrowUsd = parseFloat(r.totalBorrowUsd) || 0;
  return {
    reserveAddress: r.reserve,
    mintAddress: r.liquidityTokenMint,
    symbol: r.liquidityToken,
    supplyApy: parseFloat(r.supplyApy) || 0,
    borrowApy: parseFloat(r.borrowApy) || 0,
    totalSupplyUsd,
    totalBorrowUsd,
    utilization: totalSupplyUsd > 0 ? totalBorrowUsd / totalSupplyUsd : 0,
    maxLtv: parseFloat(r.maxLtv) || 0,
  };
}

/**
 * Fetch all reserves in a market with supply/borrow APY, USD totals, utilization, and LTV.
 * Public: used by `kamino reserves` command. Surfaces errors instead of swallowing them.
 */
export async function getReservesMetrics(market: string): Promise<Result<KaminoReserveMetrics[], ByrealError>> {
  try {
    const response = await fetch(`${KAMINO_API}/kamino-market/${market}/reserves/metrics`);
    if (!response.ok) {
      const text = await response.text();
      return err(apiError(`Kamino reserves metrics failed: ${text}`, response.status));
    }
    const data = await response.json() as RawReserveMetrics[];
    return ok(data.map(toReserveMetrics));
  } catch (error) {
    return err(networkError(`Kamino reserves metrics: ${(error as Error).message}`));
  }
}

/**
 * Legacy lookup used by enrichObligations — must not throw or fail the status command
 * when the metrics endpoint is unavailable. Returns an empty map as a silent fallback.
 */
async function getReserveApyMap(market: string): Promise<Record<string, { supplyApy: number; borrowApy: number }>> {
  const result = await getReservesMetrics(market);
  if (!result.ok) return {};
  const map: Record<string, { supplyApy: number; borrowApy: number }> = {};
  for (const r of result.value) {
    map[r.reserveAddress] = { supplyApy: r.supplyApy, borrowApy: r.borrowApy };
  }
  return map;
}

/**
 * Fetch cToken exchange rate for a reserve from metrics history.
 * exchangeRate = cTokens per underlying (e.g. 0.85 means 1 USDC → 0.85 cTokens).
 * To convert cTokens → underlying: underlying = cTokenAmount / exchangeRate.
 */
async function getExchangeRate(market: string, reserve: string): Promise<number> {
  try {
    const now = new Date();
    const start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const end = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const startStr = start.toISOString().split('T')[0];
    const endStr = end.toISOString().split('T')[0];

    const response = await fetch(
      `${KAMINO_API}/kamino-market/${market}/reserves/${reserve}/metrics/history?start=${startStr}&end=${endStr}&frequency=hour`,
    );
    if (!response.ok) return 0;
    const data = await response.json() as { history: Array<{ metrics: { exchangeRate: string } }> };
    const history = data.history;
    if (!history || history.length === 0) return 0;
    return parseFloat(history[history.length - 1].metrics.exchangeRate) || 0;
  } catch {
    return 0;
  }
}

/**
 * Transform raw obligation API response into enriched format with symbol, amount, and USD value.
 * Converts cToken amounts to underlying via exchange rate and fetches real APY from reserve metrics.
 */
async function enrichObligations(rawObligations: RawKaminoObligationResponse[], market: string): Promise<KaminoObligation[]> {
  // Collect unique reserves and mints from active positions
  const activeReserves = new Set<string>();
  const mintsToPrice = new Set<string>();
  for (const raw of rawObligations) {
    for (const dep of raw.state.deposits) {
      if (dep.depositReserve === NULL_RESERVE || dep.depositedAmount === '0') continue;
      activeReserves.add(dep.depositReserve);
      const tokenInfo = RESERVE_TOKEN_MAP[dep.depositReserve];
      if (tokenInfo) mintsToPrice.add(tokenInfo.mint);
    }
    for (const bor of raw.state.borrows) {
      if (bor.borrowReserve === NULL_RESERVE || bor.borrowedAmountSf === '0') continue;
      activeReserves.add(bor.borrowReserve);
      const tokenInfo = RESERVE_TOKEN_MAP[bor.borrowReserve];
      if (tokenInfo) mintsToPrice.add(tokenInfo.mint);
    }
  }

  // Fetch prices, reserve metrics, and exchange rates in parallel
  const [priceResult, reserveMetrics, ...exchangeRateResults] = await Promise.all([
    mintsToPrice.size > 0 ? jupiterApi.getPrice([...mintsToPrice]) : Promise.resolve({ ok: false as const, error: null }),
    getReserveApyMap(market),
    ...[...activeReserves].map(r => getExchangeRate(market, r).then(rate => ({ reserve: r, rate }))),
  ]);

  const prices: Record<string, { usdPrice: number }> = priceResult.ok ? priceResult.value : {};
  const exchangeRates: Record<string, number> = {};
  for (const er of exchangeRateResults) {
    exchangeRates[er.reserve] = er.rate;
  }

  return rawObligations.map(raw => {
    const deposits: KaminoObligationDeposit[] = [];
    const borrows: KaminoObligationBorrow[] = [];
    let totalDepositUsd = 0;
    let totalBorrowUsd = 0;

    // Process deposits: convert cToken amount → underlying via exchange rate
    for (const dep of raw.state.deposits) {
      if (dep.depositReserve === NULL_RESERVE || dep.depositedAmount === '0') continue;

      const tokenInfo = RESERVE_TOKEN_MAP[dep.depositReserve];
      const symbol = tokenInfo?.symbol ?? dep.depositReserve.slice(0, 8) + '...';
      const decimals = tokenInfo?.decimals ?? 6;
      const mint = tokenInfo?.mint ?? dep.depositReserve;

      const cTokenUi = rawToUi(dep.depositedAmount, decimals);
      const exchangeRate = exchangeRates[dep.depositReserve] || 0;
      // underlying = cToken / exchangeRate (exchangeRate = cTokens per underlying)
      const underlyingUi = exchangeRate > 0
        ? (parseFloat(cTokenUi) / exchangeRate).toFixed(decimals)
        : cTokenUi; // fallback to cToken amount if exchange rate unavailable

      const price = prices[mint]?.usdPrice ?? 0;
      const marketValue = parseFloat(underlyingUi) * price;
      totalDepositUsd += marketValue;

      const apy = reserveMetrics[dep.depositReserve]?.supplyApy ?? 0;

      deposits.push({
        reserveAddress: dep.depositReserve,
        mintAddress: mint,
        symbol,
        amount: underlyingUi,
        cTokenAmount: cTokenUi,
        marketValue: marketValue.toFixed(4),
        apy,
      });
    }

    // Process borrows: decode Sf-encoded borrow amount
    for (const bor of raw.state.borrows) {
      if (bor.borrowReserve === NULL_RESERVE || bor.borrowedAmountSf === '0') continue;

      const tokenInfo = RESERVE_TOKEN_MAP[bor.borrowReserve];
      const symbol = tokenInfo?.symbol ?? bor.borrowReserve.slice(0, 8) + '...';
      const decimals = tokenInfo?.decimals ?? 6;
      const mint = tokenInfo?.mint ?? bor.borrowReserve;

      // borrowedAmountSf is scaled by 2^60; decode to raw then convert to UI
      const rawBorrow = sfToRaw(bor.borrowedAmountSf);
      const amountUi = rawToUi(rawBorrow, decimals);

      const price = prices[mint]?.usdPrice ?? 0;
      const marketValue = parseFloat(amountUi) * price;
      totalBorrowUsd += marketValue;

      const apy = reserveMetrics[bor.borrowReserve]?.borrowApy ?? 0;

      borrows.push({
        reserveAddress: bor.borrowReserve,
        mintAddress: mint,
        symbol,
        amount: amountUi,
        marketValue: marketValue.toFixed(4),
        apy,
      });
    }

    const netValue = totalDepositUsd - totalBorrowUsd;

    return {
      obligationAddress: raw.obligationAddress,
      deposits,
      borrows,
      totalDepositValue: `$${totalDepositUsd.toFixed(4)}`,
      totalBorrowValue: `$${totalBorrowUsd.toFixed(4)}`,
      netAccountValue: `$${netValue.toFixed(4)}`,
    };
  });
}

export async function getUserObligations(params: {
  wallet: string;
  market?: string;
}): Promise<Result<KaminoObligation[], ByrealError>> {
  try {
    const marketAddr = params.market ?? KAMINO_MAIN_MARKET;
    const response = await fetch(
      `${KAMINO_API}/kamino-market/${marketAddr}/users/${params.wallet}/obligations`,
    );
    if (!response.ok) {
      const text = await response.text();
      return err(apiError(`Kamino obligations failed: ${text}`, response.status));
    }
    const raw = await response.json() as RawKaminoObligationResponse[];
    const enriched = await enrichObligations(raw, marketAddr);
    return ok(enriched);
  } catch (error) {
    return err(networkError(`Kamino obligations: ${(error as Error).message}`));
  }
}
