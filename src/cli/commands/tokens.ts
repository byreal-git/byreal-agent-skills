/**
 * Tokens command implementation
 * 参数参考：GetMintListParams (getMintListParams.ts)
 */

import { Command } from 'commander';
import { api } from '../../api/endpoints.js';
import { DEFAULTS } from '../../core/constants.js';
import {
  output,
  outputError,
  outputTokensTable,
} from '../output/formatters.js';
import type { OutputFormat, TokenListParams, TokenSortField } from '../../core/types.js';

// ============================================
// List Tokens Command
// ============================================

interface ListTokensOptions {
  search?: string;
  sortField?: TokenSortField;
  sort?: 'asc' | 'desc';
  page?: string;
  pageSize?: string;
  category?: string;
}

async function listTokens(options: ListTokensOptions, globalOptions: { output: OutputFormat }): Promise<void> {
  const startTime = Date.now();

  const params: TokenListParams = {
    searchKey: options.search,
    sortField: options.sortField,
    sort: options.sort,
    page: options.page ? parseInt(options.page, 10) : 1,
    pageSize: options.pageSize ? parseInt(options.pageSize, 10) : DEFAULTS.LIST_LIMIT,
    category: options.category,
  };

  const result = await api.listTokens(params);

  if (!result.ok) {
    outputError(result.error, globalOptions.output);
    process.exit(1);
  }

  const { tokens, total, page, pageSize } = result.value;

  output(
    { tokens, total, page, pageSize },
    globalOptions.output,
    (data) => outputTokensTable(data.tokens, data.total),
    startTime
  );
}

// ============================================
// Create Tokens Command
// ============================================

export function createTokensCommand(): Command {
  const tokens = new Command('tokens')
    .description('Query token information');

  // List subcommand (default)
  tokens
    .command('list', { isDefault: true })
    .description('List available tokens (use -o json for JSON output)')
    .option('--search <keyword>', 'Search by token address (full address only)')
    .option('--sort-field <field>', 'Sort by field: tvl, volumeUsd24h, price, priceChange24h, apr24h', 'volumeUsd24h')
    .option('--sort <order>', 'Sort order: asc, desc', 'desc')
    .option('--page <n>', 'Page number', '1')
    .option('--page-size <n>', 'Results per page', String(DEFAULTS.LIST_LIMIT))
    .option('--category <cat>', 'Token category filter')
    .action(async (options: ListTokensOptions, cmd: Command) => {
      const globalOptions = cmd.optsWithGlobals();
      await listTokens(options, { output: globalOptions.output || 'table' });
    });

  return tokens;
}
