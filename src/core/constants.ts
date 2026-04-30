/**
 * Constants for Byreal CLI
 */

import type { ByrealConfig } from "./types.js";

// ============================================
// Version
// ============================================

declare const __BYREAL_CLI_VERSION__: string | undefined;

const INJECTED_VERSION =
  typeof __BYREAL_CLI_VERSION__ === "string"
    ? __BYREAL_CLI_VERSION__
    : undefined;

export const VERSION =
  INJECTED_VERSION ?? process.env.npm_package_version ?? "0.0.0";
export const CLI_NAME = "byreal-cli";
export const NPM_PACKAGE = "@byreal-io/byreal-cli-realclaw";

// ============================================
// API Configuration
// ============================================

export const API_BASE_URL =
  process.env.BYREAL_API_URL || "https://api2.byreal.io";

export const API_ENDPOINTS = {
  // Pool endpoints (参考 dex.ts 端点配置)
  POOLS_LIST: "/byreal/api/dex/v2/pools/info/list",
  POOL_DETAILS: "/byreal/api/dex/v2/pools/details",
  POOL_KLINES: "/byreal/api/dex/v2/kline/query-ui", // 后端已返回 uiPrice

  // Token endpoints (参考 dex.ts 端点配置)
  TOKENS_LIST: "/byreal/api/dex/v2/mint/list",
  TOKEN_PRICE: "/byreal/api/dex/v2/mint/price",

  // Overview
  OVERVIEW_GLOBAL: "/byreal/api/dex/v2/overview/global",

  // Swap endpoints
  SWAP_QUOTE: "/byreal/api/router/v1/router-service/swap",

  // Position endpoints
  POSITIONS_LIST: "/byreal/api/dex/v2/position/list",
  FEE_ENCODE: "/byreal/api/dex/v2/incentive/encode-fee",

  // Copy Farmer endpoints
  COPYFARMER_TOP_POSITIONS: "/byreal/api/dex/v2/copyfarmer/top-positions",
  COPYFARMER_EPOCH_BONUS: "/byreal/api/dex/v2/copyfarmer/epoch-bonus",
  COPYFARMER_PROVIDER_OVERVIEW:
    "/byreal/api/dex/v2/copyfarmer/providerOverview",

  // Reward / Bonus claim endpoints
  UNCLAIMED_DATA: "/byreal/api/dex/v2/position/unclaimed-data",
  REWARD_ENCODE: "/byreal/api/dex/v2/incentive/encode-v2",
  REWARD_ORDER: "/byreal/api/dex/v2/incentive/order-v2",

  // Fee endpoints
  AUTO_FEE: "/byreal/api/dex/v2/main/auto-fee",
} as const;

// ============================================
// Solana Configuration
// ============================================

export const SOLANA_RPC_URL =
  process.env.SOLANA_RPC_URL ||
  "https://jenelle-p85r4h-fast-mainnet.helius-rpc.com";
export const SOLANA_CLUSTER = process.env.SOLANA_CLUSTER || "mainnet-beta";

// ============================================
// Third-party DeFi Configuration
// ============================================

// Routing priority for all three aggregators (see src/core/proxy.ts):
//   1. Byreal proxy (api-proxy) — keys injected by gateway, no local key needed
//   2. Direct with API key from env — paid upstream
//   3. Direct without key — free/anonymous upstream (Jupiter, DFlow only; Titan has no free tier)

// Jupiter (REST swap aggregator)
// Paid: api.jup.ag (requires x-api-key). Free fallback: lite-api.jup.ag.
export const JUPITER_API_KEY =
  process.env.JUPITER_API_KEY || process.env.JUP_API_KEY;
export const JUP_PAID_BASE = "https://api.jup.ag";
export const JUP_FREE_BASE = "https://lite-api.jup.ag";

// Titan (REST Gateway swap aggregator)
// Default: global entry point auto-routes to closest region.
// Override with TITAN_API_URL for regional endpoints (e.g. https://jp.partners.api.titan.exchange).
// No free tier — requires TITAN_AUTH_TOKEN when proxy is unavailable.
export const TITAN_API_URL =
  process.env.TITAN_API_URL || "https://partners.api.titan.exchange";
export const TITAN_AUTH_TOKEN = process.env.TITAN_AUTH_TOKEN;

// DFlow (REST swap aggregator)
// Paid: quote-api.dflow.net (requires x-api-key). Free fallback: dev-quote-api.dflow.net.
export const DFLOW_PAID_URL = "https://quote-api.dflow.net";
export const DFLOW_FREE_URL = "https://dev-quote-api.dflow.net";
export const DFLOW_API_KEY = process.env.DFLOW_API_KEY;

// ============================================
// Config Paths
// ============================================

export const CONFIG_DIR = "~/.config/byreal";
export const CONFIG_FILE = "config.json";

// ============================================
// Privy Signing Service Configuration
// ============================================

// CAIP-2 chain id for Solana mainnet (only network this CLI targets).
export const SOLANA_MAINNET_CAIP2 =
  "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

// Default REST path prefix for the Privy proxy service.
export const PRIVY_API_BASE_PATH_DEFAULT = "/byreal/api/privy-proxy/v1";

// Env var overrides for Privy configuration (highest precedence).
export const PRIVY_PROXY_URL_ENV = process.env.PRIVY_PROXY_URL;
export const PRIVY_API_BASE_PATH_ENV = process.env.PRIVY_API_BASE_PATH;
export const AGENT_TOKEN_ENV = process.env.AGENT_TOKEN;

// Filesystem locations for Privy configuration.
//
// Resolution order is enforced in src/privy/config.ts:
//   1. env vars (PRIVY_PROXY_URL, AGENT_TOKEN, ...)
//   2. REALCLAW_CONFIG_PATH         — new multi-wallet format
//   3. SKILL_AGENT_TOKEN_CONFIG_PATH — existing claw-managed setup (skill config)
//   4. LEGACY_AGENT_TOKEN_PATH      — bare token file
//   5. ~/.config/byreal/config.json#privy_proxy_url — byreal-cli own config
export const REALCLAW_CONFIG_PATH = "~/.openclaw/realclaw-config.json";
export const SKILL_AGENT_TOKEN_CONFIG_PATH =
  "~/.openclaw/skills/agent-token/scripts/config.json";
export const LEGACY_AGENT_TOKEN_PATH = "~/.openclaw/agent_token";

// Audit tags sent on every signing request.
export const PRIVY_STRATEGY_ID = "byreal_cli";
export const PRIVY_STRATEGY_NAME = "Byreal CLI";

// ============================================
// Defaults
// ============================================

export const DEFAULTS = {
  OUTPUT_FORMAT: "table" as const,
  LIST_LIMIT: 100,
  MAX_LIST_LIMIT: 100,
  SLIPPAGE_BPS: 200,
  MAX_SLIPPAGE_BPS: 500,
  PRIORITY_FEE_MICRO_LAMPORTS: 50000,
  REQUEST_TIMEOUT_MS: 30000,
} as const;

// ============================================
// Table Configuration
// ============================================

export const TABLE_CHARS = {
  top: "",
  "top-mid": "",
  "top-left": "",
  "top-right": "",
  bottom: "",
  "bottom-mid": "",
  "bottom-left": "",
  "bottom-right": "",
  left: "",
  "left-mid": "",
  mid: "",
  "mid-mid": "",
  right: "",
  "right-mid": "",
  middle: " ",
} as const;

// ============================================
// ASCII Art
// ============================================

export const LOGO = `
╔══════════════════════════════════════════════════════════╗
║                                                          ║
║   ██████╗ ██╗   ██╗██████╗ ███████╗ █████╗ ██╗           ║
║   ██╔══██╗╚██╗ ██╔╝██╔══██╗██╔════╝██╔══██╗██║           ║
║   ██████╔╝ ╚████╔╝ ██████╔╝█████╗  ███████║██║           ║
║   ██╔══██╗  ╚██╔╝  ██╔══██╗██╔══╝  ██╔══██║██║           ║
║   ██████╔╝   ██║   ██║  ██║███████╗██║  ██║███████╗      ║
║   ╚═════╝    ╚═╝   ╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝╚══════╝      ║
║                                                          ║
║   CLMM DEX on Solana                                     ║
║   https://byreal.io                                      ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝
`;

export const EXPERIMENTAL_WARNING = `
⚠️  WARNING: This CLI is experimental and under active development.
    Use at your own risk. Always verify transactions before signing.
`;

// ============================================
// Default Config
// ============================================

export const DEFAULT_CONFIG: ByrealConfig = {
  rpc_url: "https://jenelle-p85r4h-fast-mainnet.helius-rpc.com",
  cluster: "mainnet-beta",
  defaults: {
    priority_fee_micro_lamports: 50000,
    slippage_bps: 100,
  },
};

// ============================================
// File Permissions (Unix)
// ============================================

export const DIR_PERMISSIONS = 0o700;
