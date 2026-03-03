/**
 * API endpoint functions for Byreal CLI
 * 数据结构参考自 byreal-frontend-monorepo/apps/web/src/api/gen/types/
 */

import { apiClient } from './client.js';
import { API_ENDPOINTS } from '../core/constants.js';
import { poolNotFoundError, apiError } from '../core/errors.js';
import type {
  Pool,
  PoolDetail,
  Token,
  GlobalOverview,
  Kline,
  PoolListParams,
  TokenListParams,
  KlineParams,
  Result,
  SwapQuoteParams,
  SwapQuote,
  SwapAmmExecuteParams,
  SwapRfqExecuteParams,
  PositionListParams,
  PositionItem,
  PositionListResult,
  TopPositionsParams,
  TopPositionItem,
  TopPositionsResult,
  FeeEncodeParams,
  FeeEncodeEntry,
} from '../core/types.js';
import type { ByrealError } from '../core/errors.js';

// ============================================
// API 通用响应包装 (来自前端 ky.ts)
// ============================================

interface ApiResponse<T> {
  retCode: number;
  retMsg: string;
  result: {
    success: boolean;
    version: string;
    timestamp: number;
    ret_code: number;
    ret_msg: string | null;
    data: T;
  };
  retExtInfo: Record<string, unknown>;
  time: number;
}

// ============================================
// 分页响应结构 (来自 pageResultSimplePoolInfo.ts)
// ============================================

interface PaginatedResult<T> {
  total: number;
  pageNum: number;
  pageSize: number;
  current: number;
  pages: number;
  records: T[];
}

// ============================================
// 池子相关类型 (来自 simplePoolInfo.ts)
// ============================================

interface ApiMintInfo {
  programId: string;
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI: string;
}

interface ApiMintWithPrice {
  mintInfo: ApiMintInfo;
  price: string;
}

interface ApiPoolFeeRate {
  fixFeeRate: string;
  decayFeeInUse: number;
  decayFeeInitFeeRate: number;
  decayFeeDecreaseRate: number;
  decayFeeDecreaseInterval: number;
}

interface ApiPoolRewardItem {
  mint: ApiMintInfo;
  rewardPerSecond: string;
  rewardOpenTime: number;
  rewardEndTime: number;
  rewardType: number;
}

interface ApiSimplePoolInfo {
  poolAddress: string;
  mintA: ApiMintWithPrice;
  mintB: ApiMintWithPrice;
  baseMint?: ApiMintWithPrice;
  quoteMint?: ApiMintWithPrice;
  feeRate?: ApiPoolFeeRate;
  category?: number;  // 1=稳定币, 2=xStocks, 4=reset/launchpad, 16=普通
  price?: string;
  priceChange1h?: string;
  priceChange12h?: string;
  priceChange1d?: string;
  priceChange7d?: string;
  tvl?: string;
  feeTvl1h?: string;
  feeTvl12h?: string;
  feeTvl1d?: string;
  feeTvl7d?: string;
  volumeUsd1h?: string;
  volumeUsd12h?: string;
  volumeUsd24h?: string;
  volumeUsd1d?: string;
  volumeUsd7d?: string;
  feeUsd1h?: string;
  feeUsd12h?: string;
  feeUsd1d?: string;
  feeUsd24h?: string;
  feeUsd7d?: string;
  feeApr24h?: string;
  totalBonus?: string;
  openTime?: number;  // 毫秒时间戳
  decayFeeFlag?: number;
  rewards?: ApiPoolRewardItem[];
  displayReversed?: boolean;
  kline1h?: string[];
  kline12h?: string[];
  kline1d?: string[];
  kline7d?: string[];
  // Pool details 专有字段
  dayPriceRange?: {
    lowPrice: string;
    highPrice: string;
  };
}

interface ApiPoolsResponse extends ApiResponse<PaginatedResult<ApiSimplePoolInfo>> {}

// ============================================
// 全局概览类型 (来自 overviewGlobalDTO.ts)
// ============================================

interface ApiOverviewGlobalDTO {
  tvl?: string;
  tvlChange?: string;           // 注意：不是 tvlChange24h
  volumeUsd24h?: string;
  volumeUsd24hChange?: string;  // 注意：不是 volumeChange24h
  feeUsd24h?: string;
  feeUsd24hChange?: string;     // 注意：不是 feeChange24h
  feeAll?: string;
  volumeAll?: string;
}

interface ApiOverviewResponse extends ApiResponse<ApiOverviewGlobalDTO> {}

// ============================================
// 代币列表类型 (来自 mintItem.ts, pageResultMintItem.ts)
// ============================================

interface ApiMintItem {
  address: string;
  logoURI: string;
  symbol: string;
  name: string;
  decimals: number;
  price: string;
  programId: string;
  tvl: string;
  category: number;
  priceChange24h: string;
  volumeUsd24h: string;
  circulatingSupply?: string;
  totalSupply?: string;
  labels?: string[];
  beginTradeTimestamp?: number;
  status: number;
  multiplier?: string;
}

interface ApiTokensResponse extends ApiResponse<PaginatedResult<ApiMintItem>> {}

// ============================================
// K线类型 (来自 kline.ts)
// ============================================

interface ApiKlineData {
  t: string | number;  // 时间戳（毫秒）
  s: string;           // address
  c: string;           // 收盘价
  h: string;           // 最高价
  l: string;           // 最低价
  o: string;           // 开盘价
  v: string;           // 交易量
}

type ApiKlineResponse = ApiResponse<ApiKlineData[]>;

// ============================================
// Swap Response Types (Router 格式 - 双层嵌套)
// ============================================

interface ApiSwapQuoteResponse {
  retCode: number;
  retMsg: string;
  result: {
    success: boolean;
    version: string;
    timestamp: number;
    ret_code: number;
    ret_msg: string | null;
    result: {
      data: {
        outAmount: string;
        inAmount: string;
        inputMint: string;
        outputMint: string;
        transaction: string;
        priceImpactPct?: string;
        routerType: string;
        orderId?: string;
        quoteId?: string;
        poolAddresses?: string[];
      };
    };
  };
  retExtInfo: Record<string, unknown>;
  time: number;
}

// ============================================
// Swap Execute Response Types
// ============================================

interface ApiSwapAmmExecuteResponse extends ApiResponse<string[]> {}

interface ApiSwapRfqExecuteResponse extends ApiResponse<{ txSignature: string; state: string }> {}

// ============================================
// Position Response Types
// ============================================

interface ApiPositionItem {
  poolAddress: string;
  positionAddress: string;
  nftMintAddress: string;
  upperTick: number;
  lowerTick: number;
  status: number;
  liquidityUsd?: string;
  earnedUsd?: string;
  earnedUsdPercent?: string;
  pnlUsd?: string;
  pnlUsdPercent?: string;
  apr?: string;
  bonusUsd?: string;
}

interface ApiPositionListResponse {
  retCode: number;
  retMsg: string;
  result: {
    success: boolean;
    version: string;
    timestamp: number;
    ret_code: number;
    ret_msg: string | null;
    data: {
      total: number;
      pageNum?: number;
      pageSize?: number;
      positions?: ApiPositionItem[];
      records?: ApiPositionItem[];
      poolMap?: Record<string, {
        mintA?: { symbol?: string; decimals?: number; address?: string };
        mintB?: { symbol?: string; decimals?: number; address?: string };
      }>;
    };
  };
  retExtInfo: Record<string, unknown>;
  time: number;
}

// ============================================
// Top Positions Response Types
// ============================================

interface ApiTopPositionItem {
  poolAddress: string;
  positionAddress: string;
  nftMintAddress: string;
  upperTick: number;
  lowerTick: number;
  walletAddress: string;
  status: number;
  liquidityUsd?: string;
  earnedUsd?: string;
  earnedUsdPercent?: string;
  pnlUsd?: string;
  pnlUsdPercent?: string;
  bonusUsd?: string;
  copies?: number;
  positionAgeMs?: number;
  totalDeposit?: string;
  totalClaimedFeesRewards?: string;
}

interface ApiTopPositionsResponse {
  retCode: number;
  retMsg: string;
  result: {
    success: boolean;
    version: string;
    timestamp: number;
    ret_code: number;
    ret_msg: string | null;
    data: {
      records: ApiTopPositionItem[];
      poolMap?: Record<string, {
        mintA?: { symbol?: string; address?: string };
        mintB?: { symbol?: string; address?: string };
      }>;
      total: number;
      pageNum: number;
      pageSize: number;
    };
  };
  retExtInfo: Record<string, unknown>;
  time: number;
}

// ============================================
// Fee Encode Response Types
// ============================================

interface ApiFeeEncodeEntry {
  positionAddress: string;
  txPayload: string;
  tokens: {
    tokenAddress: string;
    tokenAmount: string;
    tokenDecimals: number;
    tokenSymbol: string;
  }[];
}

interface ApiFeeEncodeResponse extends ApiResponse<ApiFeeEncodeEntry[]> {}

// ============================================
// Transform Functions
// ============================================

function transformPool(apiPool: ApiSimplePoolInfo): Pool {
  const mintA = apiPool.mintA?.mintInfo || {};
  const mintB = apiPool.mintB?.mintInfo || {};

  // 从 baseMint/quoteMint 获取价格，用于计算池子价格
  const baseMintPrice = parseFloat(apiPool.baseMint?.price || apiPool.mintA?.price || '0');
  const quoteMintPrice = parseFloat(apiPool.quoteMint?.price || apiPool.mintB?.price || '0');
  const poolPrice = quoteMintPrice > 0 ? baseMintPrice / quoteMintPrice : 0;

  return {
    id: apiPool.poolAddress,
    pair: `${mintA.symbol || 'Unknown'}/${mintB.symbol || 'Unknown'}`,
    token_a: {
      mint: mintA.address || '',
      symbol: mintA.symbol || '',
      name: mintA.name || '',
      decimals: mintA.decimals || 0,
      logo_uri: mintA.logoURI || '',
      price_usd: parseFloat(apiPool.baseMint?.price || apiPool.mintA?.price || '0'),
    },
    token_b: {
      mint: mintB.address || '',
      symbol: mintB.symbol || '',
      name: mintB.name || '',
      decimals: mintB.decimals || 0,
      logo_uri: mintB.logoURI || '',
      price_usd: parseFloat(apiPool.quoteMint?.price || apiPool.mintB?.price || '0'),
    },
    tvl_usd: parseFloat(apiPool.tvl || '0'),
    volume_24h_usd: parseFloat(apiPool.volumeUsd1d || apiPool.volumeUsd24h || '0'),
    volume_7d_usd: parseFloat(apiPool.volumeUsd7d || '0'),
    fee_rate_bps: parseInt(apiPool.feeRate?.fixFeeRate || '0', 10) / 100, // fixFeeRate is in 1/100 bps
    fee_24h_usd: parseFloat(apiPool.feeUsd1d || apiPool.feeUsd24h || '0'),
    apr: parseFloat(apiPool.feeApr24h || '0') * 100, // 转换为百分比
    current_price: poolPrice,
    created_at: apiPool.openTime ? new Date(apiPool.openTime).toISOString() : '',
    price_change_1h: apiPool.priceChange1h ? parseFloat(apiPool.priceChange1h) * 100 : undefined,
    price_change_24h: apiPool.priceChange1d ? parseFloat(apiPool.priceChange1d) * 100 : undefined,
    price_change_7d: apiPool.priceChange7d ? parseFloat(apiPool.priceChange7d) * 100 : undefined,
  };
}

function transformToken(apiToken: ApiMintItem): Token {
  return {
    mint: apiToken.address,
    symbol: apiToken.symbol,
    name: apiToken.name,
    decimals: apiToken.decimals,
    logo_uri: apiToken.logoURI,
    price_usd: parseFloat(apiToken.price || '0'),
    price_change_24h: parseFloat(apiToken.priceChange24h || '0'),
    volume_24h_usd: parseFloat(apiToken.volumeUsd24h || '0'),
    market_cap_usd: undefined,
  };
}

function transformOverview(data: ApiOverviewGlobalDTO): GlobalOverview {
  return {
    tvl: parseFloat(data.tvl || '0'),
    tvl_change_24h: parseFloat(data.tvlChange || '0'),
    volume_24h_usd: parseFloat(data.volumeUsd24h || '0'),
    volume_change_24h: parseFloat(data.volumeUsd24hChange || '0'),
    volume_all: parseFloat(data.volumeAll || '0'),
    fee_24h_usd: parseFloat(data.feeUsd24h || '0'),
    fee_change_24h: parseFloat(data.feeUsd24hChange || '0'),
    fee_all: parseFloat(data.feeAll || '0'),
    pools_count: 0,        // 由 getGlobalOverview 从 pools list 填充
  };
}

function transformKline(apiKline: ApiKlineData): Kline {
  return {
    timestamp: typeof apiKline.t === 'string' ? parseInt(apiKline.t, 10) : apiKline.t,
    open: parseFloat(apiKline.o || '0'),
    high: parseFloat(apiKline.h || '0'),
    low: parseFloat(apiKline.l || '0'),
    close: parseFloat(apiKline.c || '0'),
    volume: parseFloat(apiKline.v || '0'),
  };
}

// ============================================
// API Functions
// ============================================

/**
 * 查询池子列表
 * 参数参考：PoolInfoListReq (poolInfoListReq.ts)
 */
export async function listPools(
  params: PoolListParams = {}
): Promise<Result<{ pools: Pool[]; total: number; page: number; pageSize: number }, ByrealError>> {
  const page = params.page || 1;
  const pageSize = params.pageSize || 20;

  const result = await apiClient.get<ApiPoolsResponse>(API_ENDPOINTS.POOLS_LIST, {
    page,
    pageSize,
    sortField: params.sortField || 'tvl',
    sortType: params.sortType || 'desc',
    category: params.category,
    status: params.status,
    poolAddress: params.poolAddress,
  });

  if (!result.ok) {
    return result;
  }

  const data = result.value.result?.data;
  if (!data) {
    return {
      ok: true,
      value: { pools: [], total: 0, page, pageSize },
    };
  }

  return {
    ok: true,
    value: {
      pools: data.records.map(transformPool),
      total: data.total,
      page: data.pageNum,
      pageSize: data.pageSize,
    },
  };
}

/**
 * 获取池子详情
 * 使用 GET /pools/details?poolAddress=xxx
 */
export async function getPoolInfo(
  poolId: string
): Promise<Result<PoolDetail, ByrealError>> {
  const result = await apiClient.get<ApiResponse<ApiSimplePoolInfo>>(
    API_ENDPOINTS.POOL_DETAILS,
    { poolAddress: poolId }
  );

  if (!result.ok) {
    return result;
  }

  const poolData = result.value.result?.data;
  if (!poolData) {
    return {
      ok: false,
      error: poolNotFoundError(poolId),
    };
  }

  const pool = transformPool(poolData);

  // Map rewards
  const rewards = (poolData.rewards || []).map((r) => ({
    mint: r.mint?.address || '',
    symbol: r.mint?.symbol || '',
    rewardPerSecond: r.rewardPerSecond || '0',
    openTime: r.rewardOpenTime || 0,
    endTime: r.rewardEndTime || 0,
  }));

  return {
    ok: true,
    value: {
      ...pool,
      price_range_24h: {
        low: parseFloat(poolData.dayPriceRange?.lowPrice || '0'),
        high: parseFloat(poolData.dayPriceRange?.highPrice || '0'),
      },
      price_change_1h: parseFloat(poolData.priceChange1h || '0') * 100,
      price_change_24h: parseFloat(poolData.priceChange1d || '0') * 100,
      price_change_7d: parseFloat(poolData.priceChange7d || '0') * 100,
      fee_7d_usd: parseFloat(poolData.feeUsd7d || '0'),
      category: poolData.category,
      rewards: rewards.length > 0 ? rewards : undefined,
    },
  };
}

/**
 * 查询代币列表
 * 参数参考：GetMintListParams (getMintListParams.ts)
 */
export async function listTokens(
  params: TokenListParams = {}
): Promise<Result<{ tokens: Token[]; total: number; page: number; pageSize: number }, ByrealError>> {
  const page = params.page || 1;
  const pageSize = params.pageSize || 20;

  const result = await apiClient.get<ApiTokensResponse>(API_ENDPOINTS.TOKENS_LIST, {
    page,
    pageSize,
    sortField: params.sortField || 'volumeUsd24h',
    sort: params.sort || 'desc',
    searchKey: params.searchKey,
    category: params.category,
    status: params.status,
  });

  if (!result.ok) {
    return result;
  }

  const data = result.value.result?.data;
  if (!data) {
    return {
      ok: true,
      value: { tokens: [], total: 0, page, pageSize },
    };
  }

  return {
    ok: true,
    value: {
      tokens: data.records.map(transformToken),
      total: data.total,
      page: data.pageNum,
      pageSize: data.pageSize,
    },
  };
}

/**
 * 获取全局概览数据
 * 响应参考：OverviewGlobalDTO (overviewGlobalDTO.ts)
 */
export async function getGlobalOverview(): Promise<Result<GlobalOverview, ByrealError>> {
  // 并行请求：overview 数据 + pools 总数（pageSize=1 最小化开销）
  const [overviewResult, poolsResult] = await Promise.all([
    apiClient.get<ApiOverviewResponse>(API_ENDPOINTS.OVERVIEW_GLOBAL),
    apiClient.get<ApiPoolsResponse>(API_ENDPOINTS.POOLS_LIST, { page: 1, pageSize: 1 }),
  ]);

  if (!overviewResult.ok) {
    return overviewResult;
  }

  const data = overviewResult.value.result?.data;
  const poolsTotal = poolsResult.ok ? (poolsResult.value.result?.data?.total ?? 0) : 0;

  if (!data) {
    return {
      ok: true,
      value: {
        tvl: 0,
        tvl_change_24h: 0,
        volume_24h_usd: 0,
        volume_change_24h: 0,
        volume_all: 0,
        fee_24h_usd: 0,
        fee_change_24h: 0,
        fee_all: 0,
        pools_count: poolsTotal,
      },
    };
  }

  const overview = transformOverview(data);
  overview.pools_count = poolsTotal;
  return {
    ok: true,
    value: overview,
  };
}

/**
 * 获取 K 线数据
 * 参数参考：ListKLineUIParams (listKLineUIParams.ts)
 */
export async function getKlines(
  params: KlineParams
): Promise<Result<Kline[], ByrealError>> {
  const result = await apiClient.get<ApiKlineResponse>(API_ENDPOINTS.POOL_KLINES, {
    tokenAddress: params.tokenAddress,
    poolAddress: params.poolAddress,
    klineType: params.klineType,
    startTime: params.startTime,
    endTime: params.endTime,
  });

  if (!result.ok) {
    return result;
  }

  const data = result.value.result?.data;
  if (!data) {
    return { ok: true, value: [] };
  }

  return {
    ok: true,
    value: data.map(transformKline),
  };
}

// ============================================
// Swap API Functions
// ============================================

const DEFAULT_CU_PRICE = 100000; // Turbo-level fallback (micro-lamports/CU)

/**
 * Fetch current CU price from auto-fee API (Turbo = "high" tier)
 * Falls back to hardcoded default on failure.
 */
async function fetchCuPrice(): Promise<number> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await apiClient.get<any>(API_ENDPOINTS.AUTO_FEE);
    if (result.ok) {
      // DEX v2 format: { result: { data: { high, medium, extreme } } }
      // or flat: { high, medium, extreme }
      const data = result.value?.result?.data ?? result.value;
      const high = data?.high;
      if (typeof high === 'number' && high > 0) return high;
    }
  } catch {
    // ignore — use fallback
  }
  return DEFAULT_CU_PRICE;
}

/**
 * Get swap quote from router
 * Router 格式: result.result.data (双层嵌套)
 */
export async function getSwapQuote(
  params: SwapQuoteParams
): Promise<Result<SwapQuote, ByrealError>> {
  const SOL_MINT = 'So11111111111111111111111111111111111111112';
  const cuPrice = await fetchCuPrice();
  const result = await apiClient.post<ApiSwapQuoteResponse>(API_ENDPOINTS.SWAP_QUOTE, {
    inputMint: params.inputMint,
    outputMint: params.outputMint,
    amount: params.amount,
    swapMode: params.swapMode,
    slippageBps: String(params.slippageBps),
    userPublicKey: params.userPublicKey,
    // SOL wrapping: tell backend to create WSOL ATA if needed
    ...(params.inputMint === SOL_MINT ? { createInputAta: true } : {}),
    ...(params.outputMint === SOL_MINT ? { createOutputAta: true } : {}),
    // Fee & broadcast params (match frontend defaults for reliable tx landing)
    broadcastMode: 'priority',
    feeType: 'maxCap',
    feeAmount: '10000000',   // 0.01 SOL max cap
    cuPrice: String(cuPrice),
  });

  if (!result.ok) return result;

  // Router 格式: 数据直接在 result 上 (inputMint, outAmount 等)
  // result.result 是内层状态 { retCode, retMsg }
  const outerResult = result.value.result as Record<string, unknown> | undefined;
  if (!outerResult || !outerResult.inputMint) {
    return { ok: false, error: apiError('No swap quote data returned from router') };
  }

  return {
    ok: true,
    value: {
      outAmount: String(outerResult.outAmount || ''),
      inAmount: String(outerResult.inAmount || ''),
      inputMint: String(outerResult.inputMint || ''),
      outputMint: String(outerResult.outputMint || ''),
      transaction: String(outerResult.transaction || ''),
      priceImpactPct: outerResult.priceImpactPct != null ? String(outerResult.priceImpactPct) : undefined,
      routerType: String(outerResult.routerType || 'AMM'),
      orderId: outerResult.orderId ? String(outerResult.orderId) : undefined,
      quoteId: outerResult.quoteId ? String(outerResult.quoteId) : undefined,
      poolAddresses: Array.isArray(outerResult.poolAddresses) ? outerResult.poolAddresses as string[] : [],
    },
  };
}

/**
 * Execute swap via AMM (DEX 格式)
 */
export async function executeSwapAmm(
  params: SwapAmmExecuteParams
): Promise<Result<{ signatures: string[] }, ByrealError>> {
  const result = await apiClient.post<ApiSwapAmmExecuteResponse>(API_ENDPOINTS.SWAP_EXECUTE_AMM, {
    preData: params.preData,
    data: params.data,
    userSignTime: params.userSignTime,
  });

  if (!result.ok) return result;

  const data = result.value.result?.data;
  if (!data || !Array.isArray(data) || data.length === 0) {
    return { ok: true, value: { signatures: [] } };
  }

  return { ok: true, value: { signatures: data } };
}

/**
 * Execute swap via RFQ
 */
export async function executeSwapRfq(
  params: SwapRfqExecuteParams
): Promise<Result<{ txSignature: string; state: string }, ByrealError>> {
  const result = await apiClient.post<ApiSwapRfqExecuteResponse>(API_ENDPOINTS.SWAP_EXECUTE_RFQ, {
    quoteId: params.quoteId,
    requestId: params.requestId,
    transaction: params.transaction,
  });

  if (!result.ok) return result;

  const data = result.value.result?.data;
  if (!data) {
    return { ok: false, error: apiError('No RFQ swap result returned') };
  }

  return { ok: true, value: data };
}

// ============================================
// Position API Functions
// ============================================

/**
 * List positions for a user (DEX 格式)
 */
export async function listPositions(
  params: PositionListParams
): Promise<Result<PositionListResult, ByrealError>> {
  const result = await apiClient.get<ApiPositionListResponse>(API_ENDPOINTS.POSITIONS_LIST, {
    userAddress: params.userAddress,
    page: params.page || 1,
    pageSize: params.pageSize || 20,
    sortField: params.sortField,
    sortType: params.sortType,
    poolAddress: params.poolAddress,
    status: params.status,
  });

  if (!result.ok) return result;

  const data = result.value.result?.data;
  if (!data) {
    return { ok: true, value: { positions: [], total: 0 } };
  }

  const poolMap = data.poolMap || {};
  const positions: PositionItem[] = (data.positions || data.records || []).map((item: ApiPositionItem) => {
    const poolInfo = poolMap[item.poolAddress];
    const symbolA = poolInfo?.mintA?.symbol || '';
    const symbolB = poolInfo?.mintB?.symbol || '';
    return {
      positionAddress: item.positionAddress,
      nftMintAddress: item.nftMintAddress,
      poolAddress: item.poolAddress,
      tickLower: item.lowerTick,
      tickUpper: item.upperTick,
      status: item.status,
      liquidityUsd: item.liquidityUsd,
      earnedUsd: item.earnedUsd,
      earnedUsdPercent: item.earnedUsdPercent,
      pnlUsd: item.pnlUsd,
      pnlUsdPercent: item.pnlUsdPercent,
      apr: item.apr,
      bonusUsd: item.bonusUsd,
      pair: symbolA && symbolB ? `${symbolA}/${symbolB}` : undefined,
      tokenSymbolA: symbolA || undefined,
      tokenSymbolB: symbolB || undefined,
    };
  });

  return {
    ok: true,
    value: { positions, total: data.total },
  };
}

// ============================================
// Top Positions API Functions
// ============================================

/**
 * List top positions for a pool (Copy Farmer)
 */
export async function listTopPositions(
  params: TopPositionsParams
): Promise<Result<TopPositionsResult, ByrealError>> {
  const page = params.page || 1;
  const pageSize = params.pageSize || 20;

  const result = await apiClient.post<ApiTopPositionsResponse>(API_ENDPOINTS.COPYFARMER_TOP_POSITIONS, {
    poolAddress: params.poolAddress,
    page,
    pageSize,
    sortField: params.sortField || 'liquidity',
    sortType: params.sortType || 'desc',
    status: params.status ?? 0,
  });

  if (!result.ok) return result;

  const data = result.value.result?.data;
  if (!data) {
    return { ok: true, value: { positions: [], total: 0, page, pageSize } };
  }

  const poolMap = data.poolMap || {};
  const positions: TopPositionItem[] = (data.records || []).map((item: ApiTopPositionItem) => {
    const poolInfo = poolMap[item.poolAddress];
    const symbolA = poolInfo?.mintA?.symbol || '';
    const symbolB = poolInfo?.mintB?.symbol || '';
    return {
      poolAddress: item.poolAddress,
      positionAddress: item.positionAddress,
      nftMintAddress: item.nftMintAddress,
      walletAddress: item.walletAddress,
      tickLower: item.lowerTick,
      tickUpper: item.upperTick,
      status: item.status,
      liquidityUsd: item.liquidityUsd || '0',
      earnedUsd: item.earnedUsd || '0',
      earnedUsdPercent: item.earnedUsdPercent || '0',
      pnlUsd: item.pnlUsd || '0',
      pnlUsdPercent: item.pnlUsdPercent || '0',
      bonusUsd: item.bonusUsd || '0',
      copies: item.copies || 0,
      positionAgeMs: item.positionAgeMs || 0,
      totalDeposit: item.totalDeposit || '0',
      totalClaimedFeesRewards: item.totalClaimedFeesRewards || '0',
      pair: symbolA && symbolB ? `${symbolA}/${symbolB}` : undefined,
      tokenSymbolA: symbolA || undefined,
      tokenSymbolB: symbolB || undefined,
    };
  });

  return {
    ok: true,
    value: {
      positions,
      total: data.total,
      page: data.pageNum,
      pageSize: data.pageSize,
    },
  };
}

// ============================================
// Fee API Functions
// ============================================

/**
 * Encode fee claim transactions (DEX 格式)
 */
export async function encodeFee(
  params: FeeEncodeParams
): Promise<Result<FeeEncodeEntry[], ByrealError>> {
  const result = await apiClient.post<ApiFeeEncodeResponse>(API_ENDPOINTS.FEE_ENCODE, {
    walletAddress: params.walletAddress,
    positionAddresses: params.positionAddresses,
  });

  if (!result.ok) return result;

  const data = result.value.result?.data;
  if (!data) {
    return { ok: true, value: [] };
  }

  return { ok: true, value: data };
}

/**
 * 批量查询 token 价格
 * GET /mint/price?mints=mint1,mint2,...
 * 返回 { [mint]: price_usd }
 */
export async function getTokenPrices(
  mints: string[]
): Promise<Result<Record<string, number>, ByrealError>> {
  if (mints.length === 0) {
    return { ok: true, value: {} };
  }

  const result = await apiClient.get<ApiResponse<Record<string, string>>>(
    API_ENDPOINTS.TOKEN_PRICE,
    { mints: mints.join(',') }
  );

  if (!result.ok) return result;

  const data = result.value.result?.data;
  if (!data) {
    return { ok: true, value: {} };
  }

  const prices: Record<string, number> = {};
  for (const [mint, priceStr] of Object.entries(data)) {
    prices[mint] = parseFloat(priceStr || '0');
  }
  return { ok: true, value: prices };
}

// Export all API functions
export const api = {
  listPools,
  getPoolInfo,
  listTokens,
  getGlobalOverview,
  getKlines,
  getSwapQuote,
  executeSwapAmm,
  executeSwapRfq,
  listPositions,
  listTopPositions,
  encodeFee,
  getTokenPrices,
};
