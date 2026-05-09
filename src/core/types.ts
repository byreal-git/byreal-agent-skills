/**
 * Core type definitions for Byreal CLI
 */

// ============================================
// Output Format Types
// ============================================

export type OutputFormat = 'json' | 'table' | 'csv';

export interface GlobalOptions {
  output: OutputFormat;
  debug: boolean;
  nonInteractive?: boolean;
}

// ============================================
// API Response Types
// ============================================

export interface ApiResponse<T> {
  success: boolean;
  meta: ResponseMeta;
  data: T;
}

export interface ResponseMeta {
  timestamp: string;
  version: string;
  request_id?: string;
  execution_time_ms?: number;
}

export interface PaginatedData<T> {
  items: T[];
  pagination: Pagination;
}

export interface Pagination {
  total: number;
  limit: number;
  offset: number;
}

// ============================================
// Pool Types
// ============================================

export interface Pool {
  id: string;
  pair: string;
  token_a: TokenInfo;
  token_b: TokenInfo;
  tvl_usd: number;
  volume_24h_usd: number;
  volume_7d_usd: number;
  fee_rate_bps: number;
  fee_24h_usd: number;
  apr: number;              // Fee APR (percentage)
  reward_apr: number;       // Sum of active reward APRs (percentage)
  total_apr: number;        // Fee APR + Reward APR (percentage)
  current_price: number;    // 池子价格 (token_a / token_b)
  created_at: string;
  // Price change fields (available from list API)
  price_change_1h?: number;
  price_change_24h?: number;
  price_change_7d?: number;
  // Active reward incentives (present when pool has rewards)
  rewards?: PoolReward[];
}

export interface PoolReward {
  mint: string;
  symbol: string;
  rewardPerSecond: string;
  openTime: number;
  endTime: number;
  // Incentive fields
  apr: number;              // Individual reward APR (percentage)
  daily_amount: string;     // Daily emission amount
  daily_amount_usd: number; // Daily emission in USD
  price_usd: number;        // Reward token price in USD
}

export interface PoolDetail extends Pool {
  price_range_24h: {
    low: number;
    high: number;
  };
  // Analysis fields (populated from API detail response)
  price_change_1h?: number;
  price_change_24h?: number;
  price_change_7d?: number;
  fee_7d_usd?: number;
  category?: number;
}

// ============================================
// Token Types
// ============================================

export interface TokenInfo {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  logo_uri?: string;
  price_usd?: number;  // Token 的 USD 价格
}

export interface Token extends TokenInfo {
  price_usd: number;
  price_change_24h: number;
  volume_24h_usd: number;
  market_cap_usd?: number;
  multiplier?: string;
}

// ============================================
// Overview Types
// ============================================

export interface GlobalOverview {
  tvl: number;
  tvl_change_24h: number;
  volume_24h_usd: number;
  volume_change_24h: number;
  volume_all: number;
  fee_24h_usd: number;
  fee_change_24h: number;
  fee_all: number;
  pools_count: number;
  active_positions?: number;
}

// ============================================
// K-Line Types
// ============================================

// 支持的 K 线周期（与后端 KlineType 枚举保持一致）
export type KlineInterval = '1m' | '3m' | '5m' | '15m' | '30m' | '1h' | '4h' | '12h' | '1d';

export interface Kline {
  timestamp: number;  // 毫秒时间戳
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// ============================================
// List Query Parameters (与前端 API 保持一致)
// ============================================

// 池子排序字段（来自 PoolInfoListReqSortField）
export type PoolSortField = 'tvl' | 'volumeUsd24h' | 'feeUsd24h' | 'apr24h';

// 代币排序字段（来自 GetMintListSortField）
export type TokenSortField = 'tvl' | 'volumeUsd24h' | 'price' | 'priceChange24h' | 'apr24h';

// 池子分类
export type PoolCategory = 1 | 2 | 4 | 16;  // 1=稳定币, 2=xStocks, 4=reset/launchpad, 16=普通

export interface PoolListParams {
  // 分页
  page?: number;
  pageSize?: number;
  // 排序
  sortField?: PoolSortField;
  sortType?: 'asc' | 'desc';
  // 过滤
  category?: string;  // 池子分类
  status?: number;    // 池子状态
  poolAddress?: string;  // 按池子地址过滤
}

export interface TokenListParams {
  // 分页
  page?: number;
  pageSize?: number;
  // 排序
  sortField?: TokenSortField;
  sort?: 'asc' | 'desc';
  // 过滤
  searchKey?: string;   // 搜索关键字（按 symbol/name）
  category?: string;    // 分类
  status?: number;      // 状态
}

export interface KlineParams {
  tokenAddress: string;   // Token mint 地址（必需）
  poolAddress: string;    // 池子地址（必需）
  klineType: KlineInterval;  // K线周期（必需）
  startTime?: number;     // 开始时间戳（秒级）
  endTime?: number;       // 结束时间戳（秒级）
}

// ============================================
// Error Types
// ============================================

export type ErrorType = 'VALIDATION' | 'BUSINESS' | 'AUTH' | 'NETWORK' | 'SYSTEM';

export interface ErrorSuggestion {
  action: string;
  description: string;
  command?: string;
  adjusted_amount?: number;
}

export interface CliError {
  code: string;
  type: ErrorType;
  message: string;
  details?: Record<string, unknown>;
  suggestions?: ErrorSuggestion[];
  retryable: boolean;
}

export interface ErrorResponse {
  success: false;
  error: CliError;
}

// ============================================
// Result Types (for internal use)
// ============================================

export type Result<T, E = CliError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

// ============================================
// Key Source Types
// ============================================

/** 密钥来源：仅支持配置文件 */
export type KeySource =
  | 'config'             // ~/.config/byreal/config.json（通过 wallet set 配置）
  | 'none';              // 未配置

export interface KeySourceInfo {
  source: KeySource;
  label: string;
  path?: string;
}

// ============================================
// Config Types
// ============================================

export interface ByrealDefaults {
  priority_fee_micro_lamports: number;
  slippage_bps: number;
  require_confirmation: boolean;
  auto_confirm_threshold_usd: number;
}

export interface ByrealConfig {
  auto_update?: boolean;
  keypair_path?: string;
  rpc_url: string;
  cluster: string;
  defaults: ByrealDefaults;
}

// ============================================
// Wallet Types
// ============================================

export interface WalletInfo {
  address: string;
  source: KeySource;
  source_label: string;
  keypair_path?: string;
  config_path?: string;
}

export interface WalletBalance {
  sol: { amount_lamports: string; amount_sol: number; amount_usd?: number };
  tokens: TokenBalance[];
}

export interface TokenBalance {
  mint: string;
  symbol?: string;
  name?: string;
  amount_raw: string;
  amount_ui: string;
  amount_ui_display?: string;
  multiplier?: string;
  decimals: number;
  is_native: boolean;
  is_token_2022: boolean;
  price_usd?: number;
  amount_usd?: string;
}

// ============================================
// Swap Types
// ============================================

export interface SwapQuoteParams {
  inputMint: string;
  outputMint: string;
  amount: string;
  swapMode: 'in' | 'out';
  slippageBps: number;
  userPublicKey?: string;
}

export interface SwapQuote {
  outAmount: string;
  inAmount: string;
  inputMint: string;
  outputMint: string;
  transaction: string;
  priceImpactPct?: string;
  routerType: string;
  orderId?: string;
  quoteId?: string;
  poolAddresses: string[];
}

export interface SwapAmmExecuteParams {
  preData: string[];
  data: string[];
  userSignTime: number;
}

export interface SwapRfqExecuteParams {
  quoteId: string;
  requestId: string;
  transaction: string;
}

// ============================================
// Position Types
// ============================================

export interface PositionListParams {
  userAddress: string;
  page?: number;
  pageSize?: number;
  sortField?: string;
  sortType?: 'asc' | 'desc';
  poolAddress?: string;
  status?: number;
}

export interface PositionItem {
  positionAddress: string;
  nftMintAddress: string;
  poolAddress: string;
  tickLower: number;
  tickUpper: number;
  status: number;
  liquidityUsd?: string;
  earnedUsd?: string;
  earnedUsdPercent?: string;
  pnlUsd?: string;
  pnlUsdPercent?: string;
  apr?: string;
  bonusUsd?: string;
  // From poolMap
  pair?: string;
  tokenSymbolA?: string;
  tokenSymbolB?: string;
}

export interface PositionListResult {
  positions: PositionItem[];
  total: number;
}

// ============================================
// Copy Farmer / Top Positions Types
// ============================================

export type TopPositionsSortField = 'liquidity' | 'earned' | 'pnl' | 'copies' | 'bonus' | 'closeTime';

export interface TopPositionsParams {
  poolAddress: string;
  page?: number;
  pageSize?: number;
  sortField?: TopPositionsSortField;
  sortType?: 'asc' | 'desc';
  status?: number; // 0=OPEN, 1=CLOSED
}

export interface TopPositionItem {
  poolAddress: string;
  positionAddress: string;
  nftMintAddress: string;
  walletAddress: string;
  tickLower: number;
  tickUpper: number;
  status: number;
  liquidityUsd: string;
  earnedUsd: string;
  earnedUsdPercent: string;
  pnlUsd: string;
  pnlUsdPercent: string;
  bonusUsd: string;
  copies: number;
  positionAgeMs: number;
  totalDeposit: string;
  totalClaimedFeesRewards: string;
  // From poolMap enrichment
  pair?: string;
  tokenSymbolA?: string;
  tokenSymbolB?: string;
  // Enriched by CLI (from on-chain pool data)
  inRange?: boolean;
  priceLower?: string;
  priceUpper?: string;
}

export interface TopPositionsResult {
  positions: TopPositionItem[];
  total: number;
  page: number;
  pageSize: number;
}

// ============================================
// Fee Claim Types
// ============================================

export interface FeeEncodeParams {
  walletAddress: string;
  positionAddresses: string[];
}

export interface FeeEncodeEntry {
  positionAddress: string;
  txPayload: string;
  tokens: {
    tokenAddress: string;
    tokenAmount: string;
    tokenDecimals: number;
    tokenSymbol: string;
  }[];
}

// ============================================
// Reward / Bonus Claim Types
// ============================================

export interface PositionRewardItem {
  positionAddress: string;
  tokenAddress: string;
  tokenSymbol: string;
  syncedTokenAmount: string;
  lockedTokenAmount: string;
  claimedTokenAmount: string;
  price: string;
  tokenDecimals: number;
}

export interface UnclaimedDataResult {
  unclaimedOpenIncentives: PositionRewardItem[];
  unclaimedClosedIncentives: PositionRewardItem[];
}

export interface EpochBonusInfo {
  epochTime: number;
  epochStartTime: number;
  claimTime: number;
  endTime: number;
  totalBonusUsd: string;
}

export interface ProviderOverviewInfo {
  totalBonus: string;
  unclaimedBonus: string;
  copiesBonus: string;
  followsBonus: string;
  copies: number;
  follows: number;
}

export interface RewardEncodeParams {
  walletAddress: string;
  positionAddresses: string[];
  type: 1 | 2; // 1=incentive rewards, 2=copyfarmer bonus
}

export interface RewardClaimInfoDTO {
  tokenAddress: string;
  tokenAmount: number;
  tokenDecimals: number;
  tokenSymbol: string;
}

export interface RewardClaimRawTxInfo {
  poolAddress: string;
  txPayload: string;
  txCode: string;
  rewardClaimInfo: RewardClaimInfoDTO[];
}

export interface RewardEncodeResult {
  orderCode: string;
  rewardEncodeItems: RewardClaimRawTxInfo[];
}

export interface RewardOrderParams {
  orderCode: string;
  walletAddress: string;
  signedTxPayload: { txCode: string; poolAddress: string; signedTx: string }[];
}

export interface RewardClaimTxResult {
  poolAddress: string;
  txSignature: string;
  status: number;
}

export interface ClaimTokenItem {
  tokenAddress: string;
  tokenSymbol: string;
  tokenAmount: string;
  tokenDecimals: number;
}

export interface RewardOrderResult {
  orderCode: string;
  txList: RewardClaimTxResult[];
  claimTokenList: ClaimTokenItem[];
}

// ============================================
// AutoSwap (Zap) Types
// Mirrors apps/web/src/features/zap/types.ts (Router TRD v3 — Quote + Build-Tx two-phase flow).
// ============================================

/** Backend CommonResult — the inner result.status sub-object that carries business error codes. */
export interface AutoswapCommonResult {
  retCode: number;
  retMsg?: string;
  ret_code?: number;
  ret_msg?: string;
}

/** Price impact severity. */
export type AutoswapImpactLevel = 'ok' | 'warning' | 'blocked';

/** QuoteContext — HMAC-signed stateless context, 30s TTL */
export interface AutoSwapQuoteContext {
  flowType: string;
  intent: Record<string, unknown>;
  quoteRaw?: string | null;
  swapInAmount: string;
  expireAtMs: number;
  provider?: string;
  issuedAtMs?: number;
  swapSlippageBps?: number;
  poolPriceSlippageBps?: number;
}

/** Optional fee/broadcast fields shared by every build-tx request. */
export interface AutoswapFeePayload {
  broadcastMode?: string;
  feeType?: string;
  feeAmount?: string;
  cuPrice?: string;
  jitoTip?: string;
}

/** Swap quote view shared by Zap-In and Zap-Out. */
export interface AutoswapSwapQuoteView {
  provider: string;
  swapInAmount: string;
  expectedSwapOutAmount: string;
  minSwapOutAmount: string;
  priceImpactPct: string;
  priceImpactBps: number;
  impactLevel: AutoswapImpactLevel;
}

/** Zap-In: estimated token-A and token-B amounts after the swap. */
export interface AutoswapZapInPreviewView {
  estimatedToken0Amount: string;
  estimatedToken1Amount: string;
  note?: string;
}

/** Zap-Out: estimated withdrawn amounts and final received output. */
export interface AutoswapZapOutQuoteView {
  estimatedWithdrawToken0Amount: string;
  estimatedWithdrawToken1Amount: string;
  estimatedReceiveOutputAmount: string;
  swapQuote?: AutoswapSwapQuoteView | null;
}

// --- Zap-In Open Position (Create) ---

export interface AutoSwapZapInOpenPositionQuoteRequest {
  poolAddress: string;
  userPublicKey: string;
  inputMint: string;
  amount: string;
  tickLowerIndex: number;
  tickUpperIndex: number;
  slippageBps: number;
}

export interface AutoSwapZapInOpenPositionBuildTxRequest extends AutoswapFeePayload {
  quoteId: string;
  quoteContext: AutoSwapQuoteContext;
  positionNftMint: string;
  copyPosition?: string;
}

/** Quote response (shared by Create and Increase). */
export interface AutoSwapZapInQuoteResponse {
  result?: AutoswapCommonResult | null;
  provider?: string;
  quote?: AutoswapSwapQuoteView | null;
  preview?: AutoswapZapInPreviewView | null;
  quoteId?: string;
  quoteContext?: AutoSwapQuoteContext;
  quoteExpireAtMs?: number;
}

/** Build-Tx response (shared by Create and Increase). */
export interface AutoSwapZapInBuildTxResponse {
  result?: AutoswapCommonResult | null;
  transaction?: string | null;
  networkFee?: string;
  cu?: string;
  selectedProvider?: string;
  quote?: AutoswapSwapQuoteView | null;
  preview?: AutoswapZapInPreviewView | null;
}

// --- Zap-In Increase Liquidity ---

export interface AutoSwapZapInIncreaseLiquidityQuoteRequest {
  poolAddress: string;
  userPublicKey: string;
  inputMint: string;
  amount: string;
  personalPosition: string;
  slippageBps: number;
}

export interface AutoSwapZapInIncreaseLiquidityBuildTxRequest extends AutoswapFeePayload {
  quoteId: string;
  quoteContext: AutoSwapQuoteContext;
}

// --- Zap-Out (Decrease / Close) ---

export interface AutoSwapZapOutQuoteRequest {
  poolAddress: string;
  userPublicKey: string;
  personalPosition: string;
  outputMint: string;
  closePosition?: boolean;
  liquidity?: string;
  slippageBps: number;
}

export interface AutoSwapZapOutBuildTxRequest extends AutoswapFeePayload {
  quoteId: string;
  quoteContext: AutoSwapQuoteContext;
}

export interface AutoSwapZapOutQuoteResponse {
  result?: AutoswapCommonResult | null;
  provider?: string;
  preview?: AutoswapZapOutQuoteView | null;
  quoteId?: string;
  quoteContext?: AutoSwapQuoteContext;
  quoteExpireAtMs?: number;
}

export interface AutoSwapZapOutBuildTxResponse {
  result?: AutoswapCommonResult | null;
  transaction?: string | null;
  networkFee?: string;
  cu?: string;
  selectedProvider?: string;
  quote?: AutoswapSwapQuoteView | null;
}
