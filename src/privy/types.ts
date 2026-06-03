/**
 * Privy proxy integration types.
 */

// ============================================
// Configuration
// ============================================

export interface PrivyConfig {
  /** Base URL of the Privy proxy service (no trailing slash). */
  proxyUrl: string;
  /** REST path prefix (e.g. "/byreal/api/privy-proxy/v1"). */
  apiBasePath: string;
}

/** Resolved per-command signing context. */
export interface PrivyContext {
  token: string;
  config: PrivyConfig;
  /** CAIP-2 chain id (Solana mainnet only). */
  caip2: string;
}

// ============================================
// realclaw-config.json (new multi-wallet format)
// ============================================

export interface RealclawWallet {
  address: string;
  token: string;
  type: 'solana' | 'evm';
}

export interface RealclawConfig {
  baseUrl?: string;
  apiBasePath?: string;
  wallets?: RealclawWallet[];
}

// ============================================
// agent-token skill config (legacy claw-managed setup)
//   ~/.openclaw/skills/agent-token/scripts/config.json
// Shape: { "baseUrl": "...", "apiBasePath": "..." }
// Token lives separately in ~/.openclaw/agent_token (single file).
// ============================================

export interface SkillAgentTokenConfig {
  baseUrl?: string;
  apiBasePath?: string;
}

// ============================================
// Signing Request / Response
// ============================================

export interface SignSolanaTransactionRequest {
  /** Base64 unsigned VersionedTransaction. */
  transaction: string;
  /** When true, the proxy signs and broadcasts; otherwise it returns a signed base64 tx. */
  broadcast?: boolean;
  /** CAIP-2 chain id. Required when broadcast=true. */
  caip2?: string;
  strategyId?: string;
  strategyName?: string;
}

/**
 * Response shapes from POST /sign/solana-transaction.
 *
 * The Privy proxy returns two different shapes depending on `broadcast`:
 *
 *   broadcast=true  → SignBroadcastResponse  { caip2, hash }
 *   broadcast=false → SignOnlyResponse       { data: { encoding, signed_transaction }, method }
 *
 * The legacy / camelCase fields (`signedTransaction`) are kept as a fallback
 * for older / direct-mode envelopes; the parsing helper in client.ts checks
 * the nested snake_case form first.
 */
export interface SignBroadcastResponse {
  hash: string;
  caip2?: string;
}

export interface SignOnlyResponseInner {
  encoding?: string;
  signed_transaction?: string;
}

export interface SignOnlyResponse {
  data?: SignOnlyResponseInner;
  method?: string;
  /** Legacy fallback (older proxy versions). */
  signedTransaction?: string;
}

export type SignSolanaTransactionResponse =
  | SignBroadcastResponse
  | SignOnlyResponse;

// ============================================
// EVM typed-data signing (Polymarket order signing)
// ============================================

/** EIP-712 typed data payload (domain/types/primaryType/message). */
export interface Eip712TypedData {
  domain: Record<string, unknown>;
  types: Record<string, unknown>;
  primaryType: string;
  message: Record<string, unknown>;
}

export interface SignEvmTypedDataRequest {
  /** CAIP-2 chain id, e.g. "eip155:137" for Polygon. */
  caip2: string;
  /** The EIP-712 typed data to sign. */
  typedData: Eip712TypedData;
  strategyId?: string;
  strategyName?: string;
}

/**
 * Response from POST /sign/evm-typed-data. The proxy returns the signature
 * either flat (`{ signature }`) or nested under `data` depending on mode;
 * the client checks both.
 */
export interface SignEvmTypedDataResponseInner {
  signature?: string;
}

export interface SignEvmTypedDataResponse {
  signature?: string;
  data?: SignEvmTypedDataResponseInner;
}

// ============================================
// Response Envelopes (direct + BGW)
// ============================================

export interface PrivyEnvelopeDirect<T> {
  success: boolean;
  retCode: number;
  retMsg?: string;
  data: T | null;
}

export interface PrivyEnvelopeBgw<T> {
  retCode: number;
  retMsg: string;
  result: PrivyEnvelopeDirect<T>;
}

export type PrivyEnvelope<T> = PrivyEnvelopeDirect<T> | PrivyEnvelopeBgw<T>;

export function isBgwEnvelope<T>(env: PrivyEnvelope<T>): env is PrivyEnvelopeBgw<T> {
  return (
    env !== null &&
    typeof env === 'object' &&
    'result' in env &&
    typeof (env as PrivyEnvelopeBgw<T>).result === 'object'
  );
}

/** Unwrap either envelope shape, returning the inner direct envelope. */
export function unwrapEnvelope<T>(env: PrivyEnvelope<T>): PrivyEnvelopeDirect<T> {
  if (isBgwEnvelope(env)) return env.result;
  return env;
}
