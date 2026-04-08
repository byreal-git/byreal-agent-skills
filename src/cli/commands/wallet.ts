/**
 * Wallet command (openclaw branch) - balance query only
 * Wallet address is provided via global --wallet-address option.
 */

import { Command } from 'commander';
import { Connection, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { SOLANA_RPC_URL } from '../../core/constants.js';
import { formatErrorForOutput, missingWalletAddressError } from '../../core/errors.js';
import type { WalletBalance, TokenBalance, GlobalOptions } from '../../core/types.js';
import { loadConfig } from '../../auth/index.js';
import {
  outputJson,
  outputError,
  outputWalletBalance,
  formatUsd,
} from '../output/formatters.js';
import { api } from '../../api/endpoints.js';

// ============================================
// Token2022 multiplier enrichment
// ============================================

async function fetchToken2022Multipliers(
  mints: string[],
): Promise<Map<string, { multiplier?: string; symbol?: string; name?: string }>> {
  const result = new Map<string, { multiplier?: string; symbol?: string; name?: string }>();
  if (mints.length === 0) return result;

  const settled = await Promise.allSettled(
    mints.map(mint => api.listTokens({ searchKey: mint, pageSize: 1 })),
  );

  for (let i = 0; i < mints.length; i++) {
    const s = settled[i];
    if (s.status === 'fulfilled' && s.value.ok && s.value.value.tokens.length > 0) {
      const t = s.value.value.tokens[0];
      result.set(mints[i], { multiplier: t.multiplier, symbol: t.symbol, name: t.name });
    }
  }

  return result;
}

// ============================================
// Create Wallet Command
// ============================================

export function createWalletCommand(): Command {
  const wallet = new Command('wallet')
    .description('Query wallet balance');

  // wallet balance (default)
  wallet
    .command('balance', { isDefault: true })
    .description('Query SOL and SPL token balance')
    .action(async (_options: unknown, cmd: Command) => {
      const globalOptions = cmd.optsWithGlobals() as GlobalOptions;
      const startTime = Date.now();

      const walletAddress = globalOptions.walletAddress;
      if (!walletAddress) {
        const err = missingWalletAddressError();
        outputError(err.toJSON(), globalOptions.output);
        process.exit(1);
      }

      let publicKey: PublicKey;
      try {
        publicKey = new PublicKey(walletAddress);
      } catch {
        outputError({
          code: 'INVALID_PARAMETER',
          type: 'VALIDATION',
          message: `Invalid wallet address: ${walletAddress}`,
          retryable: false,
        }, globalOptions.output);
        process.exit(1);
      }

      try {
        const configResult = loadConfig();
        const rpcUrl = configResult.ok ? configResult.value.rpc_url : SOLANA_RPC_URL;
        const connection = new Connection(rpcUrl);

        // RPC call 1: Get SOL balance
        const lamports = await connection.getBalance(publicKey);
        const solBalance = lamports / LAMPORTS_PER_SOL;

        // RPC calls 2-3: Get SPL token accounts (TOKEN_PROGRAM_ID + TOKEN_2022) in parallel
        interface RawTokenAccount { mint: string; amount: bigint; isToken2022: boolean }
        const rawAccounts: RawTokenAccount[] = [];

        const [splResult, t22Result] = await Promise.allSettled([
          connection.getTokenAccountsByOwner(publicKey, { programId: TOKEN_PROGRAM_ID }),
          connection.getTokenAccountsByOwner(publicKey, { programId: TOKEN_2022_PROGRAM_ID }),
        ]);

        for (const [result, isToken2022] of [
          [splResult, false],
          [t22Result, true],
        ] as const) {
          if (result.status !== 'fulfilled') continue;
          for (const { account } of result.value.value) {
            const data = account.data;
            const mint = new PublicKey(data.subarray(0, 32)).toBase58();
            const amount = data.subarray(64, 72).readBigUInt64LE();
            if (amount === 0n) continue;
            rawAccounts.push({ mint, amount, isToken2022 });
          }
        }

        // RPC call 4: Batch fetch mint accounts to get decimals (filter NFTs/LP NFTs)
        const uniqueMints = [...new Set(rawAccounts.map(a => a.mint))];
        const mintDecimals = new Map<string, number>();

        if (uniqueMints.length > 0) {
          for (let i = 0; i < uniqueMints.length; i += 100) {
            const batch = uniqueMints.slice(i, i + 100);
            const mintPubkeys = batch.map(m => new PublicKey(m));
            const mintInfos = await connection.getMultipleAccountsInfo(mintPubkeys);

            for (let j = 0; j < batch.length; j++) {
              const info = mintInfos[j];
              if (info?.data) {
                const decimals = info.data[44];
                mintDecimals.set(batch[j], decimals);
              }
            }
          }
        }

        // Build token list, filtering out decimals === 0 (NFTs, LP position NFTs)
        const tokens: TokenBalance[] = [];
        for (const raw of rawAccounts) {
          const decimals = mintDecimals.get(raw.mint);
          if (decimals === undefined || decimals === 0) continue;

          const amountUi = (Number(raw.amount) / Math.pow(10, decimals)).toString();
          tokens.push({
            mint: raw.mint,
            amount_raw: raw.amount.toString(),
            amount_ui: amountUi,
            decimals,
            is_native: false,
            is_token_2022: raw.isToken2022,
          });
        }

        // Enrich all tokens with symbol/name from API, and Token2022 with multiplier
        try {
          const tokenInfo = await fetchToken2022Multipliers(tokens.map(t => t.mint));
          for (const token of tokens) {
            const info = tokenInfo.get(token.mint);
            if (!info) continue;
            if (info.symbol) token.symbol = info.symbol;
            if (info.name) token.name = info.name;
            if (token.is_token_2022 && info.multiplier && parseFloat(info.multiplier) !== 1) {
              token.multiplier = info.multiplier;
              token.amount_ui_display = (parseFloat(token.amount_ui) * parseFloat(info.multiplier)).toString();
            }
          }
        } catch { /* API failure: skip enrichment */ }

        // Fetch USD prices for all tokens + SOL
        const SOL_MINT = "So11111111111111111111111111111111111111112";
        const allMints = [SOL_MINT, ...tokens.map(t => t.mint)];
        let prices: Record<string, number> = {};
        try {
          const pricesResult = await api.getTokenPrices(allMints);
          if (pricesResult.ok) prices = pricesResult.value;
        } catch { /* price fetch failure: skip USD enrichment */ }

        const solPriceUsd = prices[SOL_MINT] ?? 0;
        const balance: WalletBalance = {
          sol: {
            amount_lamports: lamports.toString(),
            amount_sol: solBalance,
            amount_usd: solPriceUsd > 0 ? solBalance * solPriceUsd : undefined,
          },
          tokens: tokens.map(t => {
            const price = prices[t.mint] ?? 0;
            const uiAmount = parseFloat(t.amount_ui_display || t.amount_ui);
            return {
              ...t,
              price_usd: price > 0 ? price : undefined,
              amount_usd: price > 0 ? formatUsd(uiAmount * price) : undefined,
            };
          }),
        };

        // Calculate total portfolio USD
        const totalUsd = (balance.sol.amount_usd ?? 0) +
          balance.tokens.reduce((sum, t) => {
            const price = prices[t.mint] ?? 0;
            const uiAmount = parseFloat(t.amount_ui_display || t.amount_ui);
            return sum + uiAmount * price;
          }, 0);

        if (globalOptions.output === 'json') {
          outputJson({ address: walletAddress, balance, totalUsd: formatUsd(totalUsd) }, startTime);
        } else {
          outputWalletBalance(balance, walletAddress);
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);

        // Detect rate limiting (429) and suggest RPC change
        if (message.includes('429') || message.includes('Too Many Requests')) {
          outputError({
            code: 'RPC_ERROR',
            type: 'NETWORK',
            message: 'RPC rate limited (429 Too Many Requests). The default public RPC has strict rate limits.',
            retryable: true,
            suggestions: [
              {
                action: 'set-rpc',
                description: 'Switch to a dedicated RPC endpoint (e.g. Helius, QuickNode, Triton)',
                command: 'byreal-cli config set rpc_url https://your-rpc-endpoint.com',
              },
            ],
          }, globalOptions.output);
          process.exit(1);
        }

        const errMsg = formatErrorForOutput(e instanceof Error ? e : new Error(message));
        outputError(errMsg.error, globalOptions.output);
        process.exit(1);
      }
    });

  return wallet;
}
