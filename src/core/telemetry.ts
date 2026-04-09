/**
 * Telemetry module for Byreal CLI — 神策 (Sensors Analytics) integration
 *
 * Lightweight implementation that directly POSTs to the 神策 data ingestion
 * endpoint, replacing sa-sdk-node to avoid heavy transitive dependencies
 * (rx, ramda, core-js, node-fetch, etc.) and gain full control over the
 * HTTP lifecycle.
 *
 * Protocol: POST form-urlencoded `data_list=<base64 JSON>&gzip=0` to sa.gif.
 *
 * Opt-out: set BYREAL_TELEMETRY=0 to disable all telemetry.
 */

import { VERSION, SOLANA_CLUSTER } from "./constants.js";
import { rawToUi } from "./amounts.js";
import { resolveDecimals } from "./token-registry.js";
import { api } from "../api/endpoints.js";

// ============================================
// Configuration
// ============================================

const SENSOR_URL =
  "https://sc-datasink.ffe390afd658c19dcbf707e0597b846d.de/sa.gif?project=Byreal";
const REQUEST_TIMEOUT_MS = 3000;

let enabled = false;
let superProperties: Record<string, unknown> = {};

// ============================================
// 神策 protocol helpers
// ============================================

function buildEnvelope(
  distinctId: string,
  event: string,
  properties: Record<string, unknown>,
): Record<string, unknown> {
  return {
    type: "track",
    event,
    time: Date.now(),
    distinct_id: distinctId,
    properties: {
      $lib: "Node",
      $lib_version: VERSION,
      ...superProperties,
      ...properties,
    },
    lib: {
      $lib: "Node",
      $lib_version: VERSION,
    },
    _track_id: Math.floor(Math.random() * 9_000_000_000) + 1_000_000_000,
  };
}

function sendEvent(envelope: Record<string, unknown>): void {
  const payload = JSON.stringify([envelope]);
  const base64 = Buffer.from(payload, "utf8").toString("base64");
  const body = `data_list=${encodeURIComponent(base64)}&gzip=0`;

  // Fire-and-forget — the pending fetch keeps the Node.js event loop alive
  // on success paths (natural return), ensuring delivery before exit.
  fetch(SENSOR_URL, {
    method: "POST",
    headers: {
      "User-Agent": `byreal-cli/${VERSION}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
    .then((res) => {
      if (process.env.DEBUG) {
        if (res.ok) {
          console.error(`[TELEMETRY] sent ${envelope.event} → ${res.status}`);
        } else {
          console.error(
            `[TELEMETRY] failed ${envelope.event} → ${res.status} ${res.statusText}`,
          );
        }
      }
    })
    .catch((err) => {
      if (process.env.DEBUG) {
        console.error(
          `[TELEMETRY] error ${envelope.event} →`,
          (err as Error).message,
        );
      }
    });
}

// ============================================
// Initialization
// ============================================

/** Initialize telemetry. Silent on failure. Respects BYREAL_TELEMETRY=0. */
export function initTelemetry(): void {
  if (process.env.BYREAL_TELEMETRY === "0") return;
  enabled = true;
  superProperties = {
    source: "cli",
    cli_version: VERSION,
    cluster: SOLANA_CLUSTER,
  };
}

// ============================================
// Core tracking
// ============================================

/** Fire-and-forget event reporting. Never throws. */
export function trackEvent(
  distinctId: string,
  event: string,
  properties: Record<string, unknown>,
): void {
  if (!enabled) return;
  try {
    const envelope = buildEnvelope(distinctId, event, properties);
    sendEvent(envelope);
  } catch {
    /* silent */
  }
}

// ============================================
// Swap event helper (async price lookup for USD)
// ============================================

export interface SwapEventData {
  tx_signature: string;
  input_mint: string;
  output_mint: string;
  in_amount: string;
  out_amount: string;
  swap_mode: string;
  router_type: string;
  confirmed: boolean;
  slippage_bps: number;
}

/**
 * Track a swap execution event with USD volume.
 * Internally fetches token prices to calculate volume_usd.
 * The entire price lookup is capped at 3s — on timeout, the event is
 * still reported without USD values (best-effort).
 */
export async function trackSwapEvent(
  distinctId: string,
  data: SwapEventData,
): Promise<void> {
  if (!enabled) return;
  try {
    const priceLookup = Promise.all([
      api.getTokenPrices([data.input_mint, data.output_mint]),
      resolveDecimals(data.input_mint),
      resolveDecimals(data.output_mint),
    ]);

    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("price lookup timeout")),
        REQUEST_TIMEOUT_MS,
      );
    });

    let priceResult: Awaited<ReturnType<typeof api.getTokenPrices>>;
    let inDecimals: number;
    let outDecimals: number;
    try {
      [priceResult, inDecimals, outDecimals] = await Promise.race([
        priceLookup,
        timeout,
      ]);
    } finally {
      clearTimeout(timer!);
    }

    let in_amount_usd: number | null = null;
    let out_amount_usd: number | null = null;
    let volume_usd: number | null = null;

    if (priceResult.ok) {
      const prices = priceResult.value;
      const inPrice = prices[data.input_mint] || 0;
      const outPrice = prices[data.output_mint] || 0;
      const inUi = parseFloat(rawToUi(data.in_amount, inDecimals));
      const outUi = parseFloat(rawToUi(data.out_amount, outDecimals));
      in_amount_usd =
        inPrice > 0 ? Math.round(inUi * inPrice * 100) / 100 : null;
      out_amount_usd =
        outPrice > 0 ? Math.round(outUi * outPrice * 100) / 100 : null;
      volume_usd = in_amount_usd ?? out_amount_usd;
    }

    trackEvent(distinctId, "CliSwapExecuted", {
      ...data,
      in_amount_usd,
      out_amount_usd,
      volume_usd,
    });
  } catch {
    // Price lookup failed or timed out — still report without USD
    trackEvent(distinctId, "CliSwapExecuted", {
      ...data,
      in_amount_usd: null,
      out_amount_usd: null,
      volume_usd: null,
    });
  }
}
