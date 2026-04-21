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

// Jupiter (REST swap aggregator)
// Paid API (api.jup.ag) requires x-api-key; falls back to lite-api.jup.ag when no key set.
export const JUPITER_API_KEY =
  process.env.JUPITER_API_KEY || process.env.JUP_API_KEY;
const JUP_BASE = JUPITER_API_KEY
  ? "https://api.jup.ag"
  : "https://lite-api.jup.ag";
export const JUP_SWAP_API = `${JUP_BASE}/swap/v1`;
export const JUP_PRICE_API = `${JUP_BASE}/price/v3`;

// Titan (REST Gateway swap aggregator)
// Default: global entry point auto-routes to closest region
// Override with TITAN_API_URL for regional endpoints (e.g. https://jp.partners.api.titan.exchange)
export const TITAN_API_URL =
  process.env.TITAN_API_URL || "https://partners.api.titan.exchange";
export const TITAN_AUTH_TOKEN = process.env.TITAN_AUTH_TOKEN;

// DFlow (REST swap aggregator)
export const DFLOW_API_URL = "https://dev-quote-api.dflow.net";
export const DFLOW_API_KEY = process.env.DFLOW_API_KEY;

// ============================================
// Config Paths
// ============================================

export const CONFIG_DIR = "~/.config/byreal";
export const CONFIG_FILE = "config.json";

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
