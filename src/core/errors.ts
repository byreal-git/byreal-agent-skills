/**
 * Error definitions for Byreal CLI
 */

import type { CliError, ErrorType, ErrorSuggestion } from './types.js';

// ============================================
// Error Codes
// ============================================

export const ErrorCodes = {
  // Validation errors
  INVALID_PARAMETER: 'INVALID_PARAMETER',
  INVALID_RANGE: 'INVALID_RANGE',
  MISSING_REQUIRED: 'MISSING_REQUIRED',

  // Business errors
  POOL_NOT_FOUND: 'POOL_NOT_FOUND',
  TOKEN_NOT_FOUND: 'TOKEN_NOT_FOUND',
  INSUFFICIENT_BALANCE: 'INSUFFICIENT_BALANCE',
  SLIPPAGE_EXCEEDED: 'SLIPPAGE_EXCEEDED',
  POSITION_NOT_FOUND: 'POSITION_NOT_FOUND',

  // Auth errors
  MISSING_WALLET_ADDRESS: 'MISSING_WALLET_ADDRESS',

  // Privy signing errors
  PRIVY_NOT_CONFIGURED: 'PRIVY_NOT_CONFIGURED',
  PRIVY_WALLET_NOT_FOUND: 'PRIVY_WALLET_NOT_FOUND',
  PRIVY_AUTH_FAILED: 'PRIVY_AUTH_FAILED',
  PRIVY_BAD_REQUEST: 'PRIVY_BAD_REQUEST',
  PRIVY_RATE_LIMITED: 'PRIVY_RATE_LIMITED',
  PRIVY_UPSTREAM_ERROR: 'PRIVY_UPSTREAM_ERROR',
  PRIVY_TIMEOUT: 'PRIVY_TIMEOUT',
  PRIVY_BUSINESS_ERROR: 'PRIVY_BUSINESS_ERROR',

  // Config errors
  CONFIG_NOT_FOUND: 'CONFIG_NOT_FOUND',
  CONFIG_INVALID: 'CONFIG_INVALID',
  FILE_PERMISSION_ERROR: 'FILE_PERMISSION_ERROR',

  // Network errors
  NETWORK_ERROR: 'NETWORK_ERROR',
  API_ERROR: 'API_ERROR',
  TIMEOUT: 'TIMEOUT',

  // System errors
  RPC_ERROR: 'RPC_ERROR',
  TRANSACTION_FAILED: 'TRANSACTION_FAILED',
  TRANSACTION_TIMEOUT: 'TRANSACTION_TIMEOUT',
  SDK_ERROR: 'SDK_ERROR',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
} as const;

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];

// ============================================
// Error Class
// ============================================

export class ByrealError extends Error implements CliError {
  code: ErrorCode;
  type: ErrorType;
  details?: Record<string, unknown>;
  suggestions?: ErrorSuggestion[];
  retryable: boolean;

  constructor(options: {
    code: ErrorCode;
    type: ErrorType;
    message: string;
    details?: Record<string, unknown>;
    suggestions?: ErrorSuggestion[];
    retryable?: boolean;
  }) {
    super(options.message);
    this.name = 'ByrealError';
    this.code = options.code;
    this.type = options.type;
    this.details = options.details;
    this.suggestions = options.suggestions;
    this.retryable = options.retryable ?? false;
  }

  toJSON(): CliError {
    return {
      code: this.code,
      type: this.type,
      message: this.message,
      details: this.details,
      suggestions: this.suggestions,
      retryable: this.retryable,
    };
  }
}

// ============================================
// Error Factory Functions
// ============================================

export function poolNotFoundError(poolId: string): ByrealError {
  return new ByrealError({
    code: ErrorCodes.POOL_NOT_FOUND,
    type: 'BUSINESS',
    message: `Pool not found: ${poolId}`,
    details: { pool_id: poolId },
    suggestions: [
      {
        action: 'list',
        description: 'List available pools',
        command: 'byreal-cli pools list -o json',
      },
    ],
    retryable: false,
  });
}

export function tokenNotFoundError(mint: string): ByrealError {
  return new ByrealError({
    code: ErrorCodes.TOKEN_NOT_FOUND,
    type: 'BUSINESS',
    message: `Token not found: ${mint}`,
    details: { mint },
    suggestions: [
      {
        action: 'list',
        description: 'List available tokens',
        command: 'byreal-cli tokens list -o json',
      },
    ],
    retryable: false,
  });
}

export function networkError(message: string, details?: Record<string, unknown>): ByrealError {
  return new ByrealError({
    code: ErrorCodes.NETWORK_ERROR,
    type: 'NETWORK',
    message: `Network error: ${message}`,
    details,
    retryable: true,
  });
}

export function apiError(message: string, statusCode?: number): ByrealError {
  return new ByrealError({
    code: ErrorCodes.API_ERROR,
    type: 'NETWORK',
    message: `API error: ${message}`,
    details: statusCode ? { status_code: statusCode } : undefined,
    retryable: statusCode ? statusCode >= 500 : false,
  });
}

export function validationError(message: string, field?: string): ByrealError {
  return new ByrealError({
    code: ErrorCodes.INVALID_PARAMETER,
    type: 'VALIDATION',
    message: message,
    details: field ? { field } : undefined,
    retryable: false,
  });
}

export function missingWalletAddressError(): ByrealError {
  return new ByrealError({
    code: ErrorCodes.MISSING_WALLET_ADDRESS,
    type: 'AUTH',
    message: 'Missing --wallet-address option. Provide a wallet public key address.',
    suggestions: [
      {
        action: 'add-flag',
        description: 'Add --wallet-address to your command',
        command: 'byreal-cli <command> --wallet-address <your-wallet-address>',
      },
    ],
    retryable: false,
  });
}

export function configNotFoundError(): ByrealError {
  return new ByrealError({
    code: ErrorCodes.CONFIG_NOT_FOUND,
    type: 'SYSTEM',
    message: 'Configuration file not found at ~/.config/byreal/config.json',
    suggestions: [
      {
        action: 'set',
        description: 'Create config by setting RPC URL',
        command: 'byreal-cli config set rpc_url <url>',
      },
    ],
    retryable: false,
  });
}

export function configInvalidError(reason: string): ByrealError {
  return new ByrealError({
    code: ErrorCodes.CONFIG_INVALID,
    type: 'SYSTEM',
    message: `Invalid configuration: ${reason}`,
    suggestions: [
      {
        action: 'check',
        description: 'Check your config file at ~/.config/byreal/config.json',
      },
    ],
    retryable: false,
  });
}

export function transactionError(message: string, signature?: string): ByrealError {
  return new ByrealError({
    code: ErrorCodes.TRANSACTION_FAILED,
    type: 'SYSTEM',
    message: `Transaction failed: ${message}`,
    details: signature ? { signature } : undefined,
    suggestions: signature ? [
      {
        action: 'view',
        description: 'View transaction on Solscan',
        command: `https://solscan.io/tx/${signature}`,
      },
    ] : undefined,
    retryable: false,
  });
}


export function sdkError(message: string, details?: Record<string, unknown>): ByrealError {
  return new ByrealError({
    code: ErrorCodes.SDK_ERROR,
    type: 'SYSTEM',
    message: `SDK error: ${message}`,
    details,
    retryable: false,
  });
}

export function insufficientBalanceError(details?: Record<string, unknown>): ByrealError {
  return new ByrealError({
    code: ErrorCodes.INSUFFICIENT_BALANCE,
    type: 'BUSINESS',
    message: 'Insufficient balance for this operation',
    details,
    suggestions: [
      {
        action: 'check',
        description: 'Check your wallet balance',
        command: 'byreal-cli wallet balance --wallet-address <address>',
      },
    ],
    retryable: false,
  });
}

export function slippageExceededError(expected: string, actual: string): ByrealError {
  return new ByrealError({
    code: ErrorCodes.SLIPPAGE_EXCEEDED,
    type: 'BUSINESS',
    message: `Slippage exceeded: expected ${expected}, got ${actual}`,
    details: { expected, actual },
    suggestions: [
      {
        action: 'increase',
        description: 'Try increasing slippage tolerance',
        command: 'byreal-cli config set defaults.slippage_bps <value>',
      },
    ],
    retryable: true,
  });
}

export function positionNotFoundError(nftMint: string): ByrealError {
  return new ByrealError({
    code: ErrorCodes.POSITION_NOT_FOUND,
    type: 'BUSINESS',
    message: `Position not found: ${nftMint}`,
    details: { nft_mint: nftMint },
    suggestions: [
      {
        action: 'list',
        description: 'List your positions',
        command: 'byreal-cli positions list -o json',
      },
    ],
    retryable: false,
  });
}

// ============================================
// Privy Signing Error Factories
// ============================================

export function privyNotConfiguredError(): ByrealError {
  return new ByrealError({
    code: ErrorCodes.PRIVY_NOT_CONFIGURED,
    type: 'AUTH',
    message:
      'Privy signing is not configured. The --execute flag requires a Privy agent token and proxy URL.',
    suggestions: [
      {
        action: 'setup-realclaw',
        description:
          'Place ~/.openclaw/realclaw-config.json with baseUrl and wallets[]',
      },
      {
        action: 'setup-legacy',
        description:
          'Or place ~/.openclaw/agent_token plus a Privy proxy URL in ~/.config/byreal/config.json',
        command: 'byreal-cli config set privy_proxy_url <url>',
      },
      {
        action: 'fallback-unsigned',
        description:
          'Or drop --execute to keep the default behavior of emitting an unsigned transaction for an external signer',
      },
    ],
    retryable: false,
  });
}

export function privyWalletNotFoundError(walletAddress: string): ByrealError {
  return new ByrealError({
    code: ErrorCodes.PRIVY_WALLET_NOT_FOUND,
    type: 'AUTH',
    message: `No Privy agent token found for wallet address ${walletAddress}.`,
    details: { walletAddress },
    suggestions: [
      {
        action: 'check-config',
        description:
          'Confirm ~/.openclaw/realclaw-config.json has a wallets[] entry with type="solana" matching this address',
      },
      {
        action: 'fallback-unsigned',
        description:
          'Or drop --execute to skip Privy signing and emit an unsigned transaction (the default)',
      },
    ],
    retryable: false,
  });
}

export function privyAuthError(message: string): ByrealError {
  return new ByrealError({
    code: ErrorCodes.PRIVY_AUTH_FAILED,
    type: 'AUTH',
    message: `Privy authentication failed: ${message}`,
    suggestions: [
      {
        action: 'check-token',
        description:
          'Verify that your agent token is valid and not expired. Tokens are revoked after grant revocation.',
      },
    ],
    retryable: false,
  });
}

export function privyBadRequestError(message: string): ByrealError {
  return new ByrealError({
    code: ErrorCodes.PRIVY_BAD_REQUEST,
    type: 'VALIDATION',
    message: `Privy proxy rejected request: ${message}`,
    retryable: false,
  });
}

export function privyRateLimitedError(): ByrealError {
  return new ByrealError({
    code: ErrorCodes.PRIVY_RATE_LIMITED,
    type: 'NETWORK',
    message: 'Privy proxy rate-limited the request. Please retry later.',
    retryable: true,
  });
}

export function privyUpstreamError(message: string, retryable = true): ByrealError {
  return new ByrealError({
    code: ErrorCodes.PRIVY_UPSTREAM_ERROR,
    type: 'NETWORK',
    message: `Privy proxy upstream error: ${message}`,
    retryable,
  });
}

export function privyTimeoutError(timeoutMs: number): ByrealError {
  return new ByrealError({
    code: ErrorCodes.PRIVY_TIMEOUT,
    type: 'NETWORK',
    message: `Privy proxy did not respond within ${timeoutMs}ms.`,
    retryable: true,
  });
}

export function privyBusinessError(retCode: number, retMsg: string): ByrealError {
  return new ByrealError({
    code: ErrorCodes.PRIVY_BUSINESS_ERROR,
    type: 'BUSINESS',
    message: `Privy business error retCode=${retCode}: ${retMsg}`,
    details: { retCode, retMsg },
    retryable: false,
  });
}

export function conflictingFlagsError(flagA: string, flagB: string): ByrealError {
  return new ByrealError({
    code: ErrorCodes.INVALID_PARAMETER,
    type: 'VALIDATION',
    message: `Conflicting flags: ${flagA} and ${flagB} cannot be used together.`,
    suggestions: [
      {
        action: 'pick-one',
        description: `Use either ${flagA} or ${flagB}, not both.`,
      },
    ],
    retryable: false,
  });
}

// ============================================
// Error Formatting
// ============================================

export function formatErrorForOutput(error: ByrealError | Error): {
  success: false;
  error: CliError;
} {
  if (error instanceof ByrealError) {
    return {
      success: false,
      error: error.toJSON(),
    };
  }

  // Convert unknown errors
  return {
    success: false,
    error: {
      code: ErrorCodes.UNKNOWN_ERROR,
      type: 'SYSTEM',
      message: error.message || 'An unknown error occurred',
      retryable: false,
    },
  };
}
