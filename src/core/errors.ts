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
  KEYPAIR_NOT_FOUND: 'KEYPAIR_NOT_FOUND',
  INVALID_KEYPAIR: 'INVALID_KEYPAIR',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  WALLET_NOT_CONFIGURED: 'WALLET_NOT_CONFIGURED',

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

export function keypairNotFoundError(): ByrealError {
  return new ByrealError({
    code: ErrorCodes.KEYPAIR_NOT_FOUND,
    type: 'AUTH',
    message: 'No keypair found. Please configure a wallet.',
    suggestions: [
      {
        action: 'set',
        description: 'Set keypair path via wallet set',
        command: 'byreal-cli wallet set <keypair-path>',
      },
      {
        action: 'flag',
        description: 'Or use --keypair-path flag',
        command: 'byreal-cli --keypair-path ~/.config/byreal/keys/main.json wallet address',
      },
    ],
    retryable: false,
  });
}

export function invalidKeypairError(reason: string, path?: string): ByrealError {
  return new ByrealError({
    code: ErrorCodes.INVALID_KEYPAIR,
    type: 'AUTH',
    message: `Invalid keypair${path ? ` at ${path}` : ''}: ${reason}`,
    details: path ? { path } : undefined,
    suggestions: [
      {
        action: 'check',
        description: 'Ensure the file is a valid Solana keypair JSON (64-byte number array)',
      },
    ],
    retryable: false,
  });
}

export function permissionError(filePath: string, expected: string, actual: string): ByrealError {
  return new ByrealError({
    code: ErrorCodes.FILE_PERMISSION_ERROR,
    type: 'AUTH',
    message: `File permission too open: ${filePath} (expected ${expected}, got ${actual})`,
    details: { path: filePath, expected, actual },
    suggestions: [
      {
        action: 'fix',
        description: `Fix permissions with chmod`,
        command: `chmod ${expected} ${filePath}`,
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
        description: 'Create config by setting a keypair',
        command: 'byreal-cli wallet set <keypair-path>',
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
        action: 'reset',
        description: 'Reset configuration',
        command: 'byreal-cli wallet reset --confirm',
      },
    ],
    retryable: false,
  });
}

export function walletNotConfiguredError(): ByrealError {
  return new ByrealError({
    code: ErrorCodes.WALLET_NOT_CONFIGURED,
    type: 'AUTH',
    message: 'No wallet configured. Set a keypair to get started.',
    suggestions: [
      {
        action: 'set',
        description: 'Set keypair path',
        command: 'byreal-cli wallet set <keypair-path>',
      },
      {
        action: 'flag',
        description: 'Or use --keypair-path flag for one-time use',
        command: 'byreal-cli --keypair-path <path> wallet address',
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

export function transactionTimeoutError(signature?: string): ByrealError {
  return new ByrealError({
    code: ErrorCodes.TRANSACTION_TIMEOUT,
    type: 'SYSTEM',
    message: 'Transaction confirmation timed out',
    details: signature ? { signature } : undefined,
    suggestions: [
      {
        action: 'check',
        description: 'The transaction may still be processed. Check the explorer.',
        command: signature ? `https://solscan.io/tx/${signature}` : undefined,
      },
    ],
    retryable: true,
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
        command: 'byreal-cli wallet balance',
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
