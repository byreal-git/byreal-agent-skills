/**
 * Jupiter API client — swap, price
 *
 * Routing (see src/core/proxy.ts):
 *   1. proxy        — ${PROXY_URL}/jup/...   (key injected by gateway)
 *   2. direct-paid  — https://api.jup.ag/... (requires JUPITER_API_KEY)
 *   3. direct-free  — https://lite-api.jup.ag/...  (no key, rate-limited)
 */

import type { Result } from "../../core/types.js";
import { ok, err } from "../../core/types.js";
import { networkError, apiError } from "../../core/errors.js";
import {
  JUPITER_API_KEY,
  JUP_PAID_BASE,
  JUP_FREE_BASE,
} from "../../core/constants.js";
import { PROXY_URL, isProxyAvailable } from "../../core/proxy.js";
import {
  getFeeConfig,
  pickFeeSide,
  resolveFeeAccountForSwap,
} from "../../core/fee-config.js";
import { getConnection } from "../../core/solana.js";
import type { ByrealError } from "../../core/errors.js";
import type {
  JupiterQuoteResponse,
  JupiterSwapResponse,
  JupiterPriceResponse,
} from "./types.js";

export type JupiterRoute = "proxy" | "direct-paid" | "direct-free";

let lastRoute: JupiterRoute | null = null;

/** Most recent route used. Commands read this for the dry-run fallback hint. */
export function getLastRoute(): JupiterRoute | null {
  return lastRoute;
}

/**
 * Resolve the URL + headers for a given sub-path (e.g. "/swap/v1/quote").
 * Result is the full URL, ready to fetch().
 */
async function resolveRoute(subPath: string): Promise<{
  url: string;
  headers: Record<string, string>;
  route: JupiterRoute;
}> {
  if (await isProxyAvailable()) {
    lastRoute = "proxy";
    return {
      url: `${PROXY_URL.replace(/\/$/, "")}/jup${subPath}`,
      headers: {},
      route: "proxy",
    };
  }
  if (JUPITER_API_KEY) {
    lastRoute = "direct-paid";
    return {
      url: `${JUP_PAID_BASE}${subPath}`,
      headers: { "x-api-key": JUPITER_API_KEY },
      route: "direct-paid",
    };
  }
  lastRoute = "direct-free";
  return {
    url: `${JUP_FREE_BASE}${subPath}`,
    headers: {},
    route: "direct-free",
  };
}

// ============================================
// Swap API
// ============================================

export async function getQuote(params: {
  inputMint: string;
  outputMint: string;
  amount: string;
  slippageBps?: number;
  swapMode?: "ExactIn" | "ExactOut";
}): Promise<Result<JupiterQuoteResponse, ByrealError>> {
  try {
    const searchParams = new URLSearchParams({
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      amount: params.amount,
      dynamicSlippage: "true",
      maxAccounts: "64",
      swapMode: params.swapMode ?? "ExactIn",
    });
    if (params.slippageBps !== undefined) {
      searchParams.set("slippageBps", String(params.slippageBps));
    }

    // Platform fee (optional). `pickFeeSide` chooses the major-mint side
    // (input preferred). Jupiter infers the fee side at swap time from the
    // `feeAccount`'s mint; sending `feeAccount` here on /quote keeps the
    // quoted outAmount aligned with the actual swap (Jupiter would otherwise
    // assume output-side and mis-quote when fee lands on input). The ATA
    // existence check is cached per-process so /swap reuses it.
    const feeConfig = getFeeConfig();
    if (feeConfig) {
      const { mint: feeMint } = pickFeeSide(params.inputMint, params.outputMint);
      const feeAccount = await resolveFeeAccountForSwap(
        feeMint,
        getConnection(),
        feeConfig,
      );
      if (feeAccount) {
        searchParams.set("platformFeeBps", String(feeConfig.bps));
        searchParams.set("feeAccount", feeAccount);
      }
    }

    const { url, headers } = await resolveRoute("/swap/v1/quote");
    const response = await fetch(`${url}?${searchParams}`, { headers });
    if (!response.ok) {
      const text = await response.text();
      return err(apiError(`Jupiter quote failed: ${text}`, response.status));
    }
    const data = (await response.json()) as JupiterQuoteResponse;
    return ok(data);
  } catch (error) {
    return err(networkError(`Jupiter quote: ${(error as Error).message}`));
  }
}

export async function getSwapTransaction(params: {
  quoteResponse: JupiterQuoteResponse;
  userPublicKey: string;
  priorityFeeMicroLamports?: number;
}): Promise<Result<JupiterSwapResponse, ByrealError>> {
  try {
    // Platform fee (optional). `pickFeeSide` must produce the same decision
    // as in getQuote() — and it does, because it's pure and reads only the
    // two mints from the quote. resolveFeeAccountForSwap hits the per-process
    // cache populated there, so the ATA check runs at most once per
    // (treasury, mint) per CLI invocation.
    const feeConfig = getFeeConfig();
    const feeAccount = feeConfig
      ? await resolveFeeAccountForSwap(
          pickFeeSide(
            params.quoteResponse.inputMint,
            params.quoteResponse.outputMint,
          ).mint,
          getConnection(),
          feeConfig,
        )
      : null;

    const { url, headers } = await resolveRoute("/swap/v1/swap");
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({
        quoteResponse: params.quoteResponse,
        userPublicKey: params.userPublicKey,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        dynamicSlippage: true,
        prioritizationFeeLamports: {
          priorityLevelWithMaxLamports: {
            maxLamports: params.priorityFeeMicroLamports ?? 10000000,
            global: false,
            priorityLevel: "medium",
          },
        },
        ...(feeAccount ? { feeAccount } : {}),
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      return err(apiError(`Jupiter swap failed: ${text}`, response.status));
    }
    const data = (await response.json()) as JupiterSwapResponse;
    return ok(data);
  } catch (error) {
    return err(networkError(`Jupiter swap: ${(error as Error).message}`));
  }
}

// ============================================
// Price API
// ============================================

export async function getPrice(
  mints: string[],
): Promise<Result<JupiterPriceResponse, ByrealError>> {
  try {
    const { url, headers } = await resolveRoute("/price/v3");
    const response = await fetch(`${url}?ids=${mints.join(",")}`, { headers });
    if (!response.ok) {
      const text = await response.text();
      return err(apiError(`Jupiter price failed: ${text}`, response.status));
    }
    const data = (await response.json()) as JupiterPriceResponse;
    return ok(data);
  } catch (error) {
    return err(networkError(`Jupiter price: ${(error as Error).message}`));
  }
}
