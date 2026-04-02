/**
 * Wallet command - manage keypair and view balance
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Command } from 'commander';
import { Connection, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { SOLANA_RPC_URL } from '../../core/constants.js';
import { formatErrorForOutput, walletNotConfiguredError } from '../../core/errors.js';
import type { WalletInfo, WalletBalance, TokenBalance, GlobalOptions } from '../../core/types.js';
import {
  resolveKeypair,
  resolveAddress,
  parsePrivateKeyInput,
  loadConfig,
  saveConfig,
  getConfigPath,
  getKeysDir,
  deleteKeypairConfig,
  ensureConfigDir,
  setFilePermissions,
} from '../../auth/index.js';
import { FILE_PERMISSIONS } from '../../core/constants.js';
import {
  outputJson,
  outputError,
  outputWalletAddress,
  outputWalletInfo,
  outputWalletBalance,
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
    .description('Manage wallet keypair');

  // wallet address (default)
  wallet
    .command('address', { isDefault: true })
    .description('Show wallet public key address')
    .action((_options: unknown, cmd: Command) => {
      const globalOptions = cmd.optsWithGlobals() as GlobalOptions;
      const startTime = Date.now();

      const result = resolveAddress();

      if (!result.ok) {
        outputError(result.error.toJSON(), globalOptions.output);
        process.exit(1);
      }

      const { address, source } = result.value;

      if (globalOptions.output === 'json') {
        outputJson({ address, source: source.source, source_label: source.label }, startTime);
      } else {
        outputWalletAddress(address, source.label);
      }
    });

  // wallet balance
  wallet
    .command('balance')
    .description('Query SOL and SPL token balance')
    .action(async (_options: unknown, cmd: Command) => {
      const globalOptions = cmd.optsWithGlobals() as GlobalOptions;
      const startTime = Date.now();

      const keypairResult = resolveKeypair();

      if (!keypairResult.ok) {
        outputError(keypairResult.error.toJSON(), globalOptions.output);
        process.exit(1);
      }

      const { publicKey, address } = keypairResult.value;

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
          // getMultipleAccountsInfo supports up to 100 per call
          for (let i = 0; i < uniqueMints.length; i += 100) {
            const batch = uniqueMints.slice(i, i + 100);
            const mintPubkeys = batch.map(m => new PublicKey(m));
            const mintInfos = await connection.getMultipleAccountsInfo(mintPubkeys);

            for (let j = 0; j < batch.length; j++) {
              const info = mintInfos[j];
              if (info?.data) {
                // Mint layout: decimals is a single byte at offset 44
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

        // Enrich Token2022 tokens with multiplier from API (graceful on failure)
        const t22Mints = tokens.filter(t => t.is_token_2022).map(t => t.mint);
        try {
          const t22Info = await fetchToken2022Multipliers(t22Mints);
          for (const token of tokens) {
            const info = t22Info.get(token.mint);
            if (!info) continue;
            if (info.symbol) token.symbol = info.symbol;
            if (info.name) token.name = info.name;
            if (info.multiplier && parseFloat(info.multiplier) !== 1) {
              token.multiplier = info.multiplier;
              token.amount_ui_display = (parseFloat(token.amount_ui) * parseFloat(info.multiplier)).toString();
            }
          }
        } catch { /* API failure: skip multiplier enrichment */ }

        const balance: WalletBalance = {
          sol: {
            amount_lamports: lamports.toString(),
            amount_sol: solBalance,
          },
          tokens,
        };

        if (globalOptions.output === 'json') {
          outputJson({ address, balance }, startTime);
        } else {
          outputWalletBalance(balance, address);
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

  // wallet set --private-key
  wallet
    .command('set')
    .description('Set keypair via private key')
    .requiredOption('--private-key <key>', 'Base58 or JSON array private key')
    .action((options: { privateKey: string }, cmd: Command) => {
      const globalOptions = cmd.optsWithGlobals() as GlobalOptions;
      const startTime = Date.now();

      const parseResult = parsePrivateKeyInput(options.privateKey);
      if (!parseResult.ok) {
        outputError(parseResult.error.toJSON(), globalOptions.output);
        process.exit(1);
      }

      // Write keypair to keys dir
      ensureConfigDir('~/.config/byreal/keys');
      const keysDir = getKeysDir();
      const destPath = path.join(keysDir, 'id.json');
      fs.writeFileSync(destPath, JSON.stringify(Array.from(parseResult.value)));
      setFilePermissions(destPath, FILE_PERMISSIONS);
      const storedPath = '~/.config/byreal/keys/id.json';

      // Save to config
      const configResult = loadConfig();
      if (!configResult.ok) {
        outputError(configResult.error.toJSON(), globalOptions.output);
        process.exit(1);
      }

      const config = configResult.value;
      config.keypair_path = storedPath;
      const saveResult = saveConfig(config);
      if (!saveResult.ok) {
        outputError(saveResult.error.toJSON(), globalOptions.output);
        process.exit(1);
      }

      // Read the address from the keypair for confirmation
      const addrResult = resolveAddress();

      if (globalOptions.output === 'json') {
        outputJson({
          keypair_path: storedPath,
          config_path: getConfigPath(),
          address: addrResult.ok ? addrResult.value.address : undefined,
        }, startTime);
      } else {
        console.log(`\nKeypair configured successfully.`);
        console.log(`  Path: ${storedPath}`);
        console.log(`  Config: ${getConfigPath()}`);
        if (addrResult.ok) {
          console.log(`  Address: ${addrResult.value.address}`);
        }
      }
    });

  // wallet info
  wallet
    .command('info')
    .description('Show detailed wallet information')
    .action((_options: unknown, cmd: Command) => {
      const globalOptions = cmd.optsWithGlobals() as GlobalOptions;
      const startTime = Date.now();

      const result = resolveKeypair();

      if (!result.ok) {
        outputError(result.error.toJSON(), globalOptions.output);
        process.exit(1);
      }

      const { address, source } = result.value;

      const info: WalletInfo = {
        address,
        source: source.source,
        source_label: source.label,
        keypair_path: source.path,
        config_path: getConfigPath(),
      };

      if (globalOptions.output === 'json') {
        outputJson(info, startTime);
      } else {
        outputWalletInfo(info);
      }
    });

  // wallet reset
  wallet
    .command('reset')
    .description('Remove all keypair configuration')
    .option('--confirm', 'Confirm deletion without interactive prompt')
    .action((options: { confirm?: boolean }, cmd: Command) => {
      const globalOptions = cmd.optsWithGlobals() as GlobalOptions;
      const startTime = Date.now();

      // In non-interactive mode, require --confirm
      if (!options.confirm) {
        if (globalOptions.nonInteractive) {
          const err = walletNotConfiguredError();
          err.message = 'Use --confirm flag in non-interactive mode to reset wallet config';
          outputError(err.toJSON(), globalOptions.output);
          process.exit(1);
        }

        // Interactive confirmation via stderr prompt
        process.stderr.write(
          '\nThis will remove all keypair paths from config and delete copied keys.\n' +
          'Use --confirm to proceed: byreal-cli wallet reset --confirm\n',
        );
        process.exit(1);
      }

      const result = deleteKeypairConfig();

      if (!result.ok) {
        outputError(result.error.toJSON(), globalOptions.output);
        process.exit(1);
      }

      if (globalOptions.output === 'json') {
        outputJson({ reset: true, message: 'All keypair configuration has been removed' }, startTime);
      } else {
        console.log('\nKeypair configuration has been reset.');
        console.log('  All keypair paths removed from config.');
        console.log('  Keys directory cleaned.');
      }
    });

  return wallet;
}
