/**
 * Positions commands for Byreal CLI
 * - positions list: List user positions
 * - positions open: Open a new position (SDK)
 * - positions close: Close a position (SDK)
 * - positions claim: Claim fees (API)
 */

import { Command } from 'commander';
import chalk from 'chalk';
import BN from 'bn.js';
import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import type { GlobalOptions } from '../../core/types.js';
import { api } from '../../api/endpoints.js';
import { resolveKeypair, resolveAddress } from '../../auth/keypair.js';
import { uiToRaw, rawToUi } from '../../core/amounts.js';
import { getConnection, getSlippageBps } from '../../core/solana.js';
import {
  resolveExecutionMode,
  requireExecutionMode,
  printDryRunBanner,
  printConfirmBanner,
} from '../../core/confirm.js';
import {
  deserializeTransaction,
  signTransaction,
  sendAndConfirmTransaction,
} from '../../core/transaction.js';
import {
  outputJson,
  outputErrorJson,
  outputErrorTable,
  outputPositionsTable,
  outputPositionOpenPreview,
  outputPositionClosePreview,
  outputPositionClaimPreview,
  outputTransactionResult,
} from '../output/formatters.js';

// ============================================
// positions list
// ============================================

function createPositionsListCommand(): Command {
  return new Command('list')
    .description('List your positions')
    .option('--page <n>', 'Page number', '1')
    .option('--page-size <n>', 'Page size', '20')
    .option('--sort-field <field>', 'Sort field')
    .option('--sort-type <type>', 'Sort direction: asc or desc')
    .option('--pool <address>', 'Filter by pool address')
    .option('--status <status>', 'Filter by status: 0=active, 1=closed (default: 0)')
    .action(async (options, cmdObj: Command) => {
      const globalOptions = cmdObj.optsWithGlobals() as GlobalOptions;
      const format = globalOptions.output;
      const startTime = Date.now();

      // Resolve user address (required)
      const addrResult = resolveAddress(globalOptions.keypairPath);
      if (!addrResult.ok) {
        if (format === 'json') {
          outputErrorJson(addrResult.error);
        } else {
          outputErrorTable(addrResult.error);
        }
        process.exit(1);
      }

      const result = await api.listPositions({
        userAddress: addrResult.value.address,
        page: parseInt(options.page, 10),
        pageSize: parseInt(options.pageSize, 10),
        sortField: options.sortField,
        sortType: options.sortType,
        poolAddress: options.pool,
        status: options.status !== undefined ? parseInt(options.status, 10) : 0,
      });

      if (!result.ok) {
        if (format === 'json') {
          outputErrorJson(result.error);
        } else {
          outputErrorTable(result.error);
        }
        process.exit(1);
      }

      if (format === 'json') {
        outputJson(result.value, startTime);
      } else {
        outputPositionsTable(result.value.positions, result.value.total);
      }
    });
}

// ============================================
// Balance check for open position
// ============================================

const SOL_MINT = 'So11111111111111111111111111111111111111112';

async function getTokenBalance(owner: PublicKey, mint: string): Promise<BN> {
  const connection = getConnection();
  if (mint === SOL_MINT) {
    const lamports = await connection.getBalance(owner);
    return new BN(lamports.toString());
  }
  const mintPk = new PublicKey(mint);
  const [splResult, t22Result] = await Promise.allSettled([
    connection.getTokenAccountsByOwner(owner, { mint: mintPk, programId: TOKEN_PROGRAM_ID }),
    connection.getTokenAccountsByOwner(owner, { mint: mintPk, programId: TOKEN_2022_PROGRAM_ID }),
  ]);
  let total = new BN(0);
  for (const result of [splResult, t22Result]) {
    if (result.status !== 'fulfilled') continue;
    for (const { account } of result.value.value) {
      const amount = account.data.subarray(64, 72).readBigUInt64LE();
      total = total.add(new BN(amount.toString()));
    }
  }
  return total;
}

interface BalanceWarning {
  token: string;
  symbol: string;
  mint: string;
  required: string;
  available: string;
  deficit: string;
}

async function checkBalanceSufficiency(
  owner: PublicKey,
  mintA: string, mintB: string,
  symbolA: string, symbolB: string,
  decimalsA: number, decimalsB: number,
  amountA: BN, amountB: BN,
): Promise<BalanceWarning[]> {
  const warnings: BalanceWarning[] = [];
  const [balanceA, balanceB] = await Promise.all([
    getTokenBalance(owner, mintA),
    getTokenBalance(owner, mintB),
  ]);
  if (balanceA.lt(amountA)) {
    const deficit = amountA.sub(balanceA);
    warnings.push({
      token: 'A', symbol: symbolA, mint: mintA,
      required: rawToUi(amountA.toString(), decimalsA),
      available: rawToUi(balanceA.toString(), decimalsA),
      deficit: rawToUi(deficit.toString(), decimalsA),
    });
  }
  if (balanceB.lt(amountB)) {
    const deficit = amountB.sub(balanceB);
    warnings.push({
      token: 'B', symbol: symbolB, mint: mintB,
      required: rawToUi(amountB.toString(), decimalsB),
      available: rawToUi(balanceB.toString(), decimalsB),
      deficit: rawToUi(deficit.toString(), decimalsB),
    });
  }
  return warnings;
}

// ============================================
// positions open (SDK)
// ============================================

function createPositionsOpenCommand(): Command {
  return new Command('open')
    .description('Open a new CLMM position')
    .requiredOption('--pool <address>', 'Pool address')
    .requiredOption('--price-lower <price>', 'Lower price bound')
    .requiredOption('--price-upper <price>', 'Upper price bound')
    .requiredOption('--base <token>', 'Base token: MintA or MintB')
    .requiredOption('--amount <amount>', 'Amount of base token (UI amount unless --raw)')
    .option('--slippage <bps>', 'Slippage tolerance in basis points')
    .option('--raw', 'Amount is already in raw (smallest unit) format')
    .option('--dry-run', 'Preview the position without opening')
    .option('--confirm', 'Open the position')
    .action(async (options, cmdObj: Command) => {
      const globalOptions = cmdObj.optsWithGlobals() as GlobalOptions;
      const format = globalOptions.output;
      const startTime = Date.now();

      // Check execution mode
      const mode = resolveExecutionMode(options);
      requireExecutionMode(mode, 'positions open');

      // Resolve keypair (required)
      const keypairResult = resolveKeypair(globalOptions.keypairPath);
      if (!keypairResult.ok) {
        if (format === 'json') {
          outputErrorJson(keypairResult.error);
        } else {
          outputErrorTable(keypairResult.error);
        }
        process.exit(1);
      }

      const { keypair, publicKey } = keypairResult.value;

      try {
        // Lazy-load SDK
        const { getChain } = await import('../../sdk/init.js');
        const { calculateTickAlignedPriceRange } = await import('../../libs/clmm-sdk/calculate.js');
        const { getAmountBFromAmountA, getAmountAFromAmountB } = await import('../../libs/clmm-sdk/client/utils.js');

        const chain = getChain();

        // Get pool info from chain
        const poolInfo = await chain.getRawPoolInfoByPoolId(options.pool);

        // Align prices to ticks
        const { priceInTickLower, priceInTickUpper } = calculateTickAlignedPriceRange({
          tickSpacing: poolInfo.tickSpacing,
          mintDecimalsA: poolInfo.mintDecimalsA,
          mintDecimalsB: poolInfo.mintDecimalsB,
          startPrice: options.priceLower,
          endPrice: options.priceUpper,
        });

        const tickLower = priceInTickLower.tick;
        const tickUpper = priceInTickUpper.tick;

        // Determine base token and compute amounts
        const base = options.base as 'MintA' | 'MintB';
        const decimals = base === 'MintA' ? poolInfo.mintDecimalsA : poolInfo.mintDecimalsB;
        const baseAmount = options.raw
          ? new BN(options.amount)
          : new BN(uiToRaw(options.amount, decimals));

        // Calculate the other token amount
        let otherAmount: BN;
        if (base === 'MintA') {
          otherAmount = getAmountBFromAmountA({
            priceLower: priceInTickLower.price,
            priceUpper: priceInTickUpper.price,
            amountA: baseAmount,
            poolInfo,
          });
        } else {
          otherAmount = getAmountAFromAmountB({
            priceLower: priceInTickLower.price,
            priceUpper: priceInTickUpper.price,
            amountB: baseAmount,
            poolInfo,
          });
        }

        // Apply slippage to otherAmountMax
        const slippageBps = options.slippage
          ? parseInt(options.slippage, 10)
          : getSlippageBps();
        const slippageMultiplier = 10000 + slippageBps;
        const otherAmountMax = otherAmount.mul(new BN(slippageMultiplier)).div(new BN(10000));

        const otherDecimals = base === 'MintA' ? poolInfo.mintDecimalsB : poolInfo.mintDecimalsA;

        // Resolve token symbols from API
        let symbolA = 'MintA';
        let symbolB = 'MintB';
        const poolResult = await api.getPoolInfo(options.pool);
        if (poolResult.ok) {
          symbolA = poolResult.value.token_a.symbol || symbolA;
          symbolB = poolResult.value.token_b.symbol || symbolB;
        }
        const baseSymbol = base === 'MintA' ? symbolA : symbolB;
        const otherSymbol = base === 'MintA' ? symbolB : symbolA;

        // Dry-run: show preview + balance check
        if (mode === 'dry-run') {
          printDryRunBanner();

          const mintAStr = poolInfo.mintA.toBase58();
          const mintBStr = poolInfo.mintB.toBase58();
          const requiredA = base === 'MintA' ? baseAmount : otherAmountMax;
          const requiredB = base === 'MintA' ? otherAmountMax : baseAmount;

          const previewData = {
            poolAddress: options.pool,
            tickLower,
            tickUpper,
            priceLower: priceInTickLower.price.toString(),
            priceUpper: priceInTickUpper.price.toString(),
            baseAmount: rawToUi(baseAmount.toString(), decimals),
            baseToken: baseSymbol,
            otherAmount: rawToUi(otherAmountMax.toString(), otherDecimals),
            otherToken: otherSymbol,
          };

          // Check wallet balance
          const balanceWarnings = await checkBalanceSufficiency(
            publicKey, mintAStr, mintBStr,
            symbolA, symbolB,
            poolInfo.mintDecimalsA, poolInfo.mintDecimalsB,
            requiredA, requiredB,
          );

          if (format === 'json') {
            const jsonData: Record<string, unknown> = { mode: 'dry-run', ...previewData };
            if (balanceWarnings.length > 0) {
              jsonData.balanceWarnings = balanceWarnings.map((w) => ({
                symbol: w.symbol,
                mint: w.mint,
                required: w.required,
                available: w.available,
                deficit: w.deficit,
                suggestion: `Swap to get at least ${w.deficit} ${w.symbol} before opening position. Use: byreal-cli swap execute --output-mint ${w.mint} --input-mint <source-token-mint> --amount <amount> --confirm`,
              }));
            }
            outputJson(jsonData, startTime);
          } else {
            outputPositionOpenPreview(previewData);
            if (balanceWarnings.length > 0) {
              console.log(chalk.red.bold('\n  Insufficient Balance'));
              for (const w of balanceWarnings) {
                console.log(chalk.red(`    ${w.symbol}: need ${w.required}, have ${w.available} (deficit: ${w.deficit})`));
                console.log(chalk.yellow(`    → Swap to get ${w.symbol}: byreal-cli swap execute --output-mint ${w.mint} --input-mint <source-token-mint> --amount <amount> --confirm`));
              }
            } else {
              console.log(chalk.green('\n  Balance check: sufficient'));
              console.log(chalk.yellow('\n  Use --confirm to open this position'));
            }
          }
          return;
        }

        // Confirm: create position
        printConfirmBanner();

        const result = await chain.createPositionInstructions({
          userAddress: publicKey,
          poolInfo,
          tickLower,
          tickUpper,
          base,
          baseAmount,
          otherAmountMax,
        });

        // Sign and send
        result.transaction.sign([keypair]);
        const connection = getConnection();
        const sendResult = await sendAndConfirmTransaction(connection, result.transaction);

        if (!sendResult.ok) {
          if (format === 'json') {
            outputErrorJson(sendResult.error);
          } else {
            outputErrorTable(sendResult.error);
          }
          process.exit(1);
        }

        const txData = {
          signature: sendResult.value.signature,
          confirmed: sendResult.value.confirmed,
          nftAddress: result.nftAddress,
        };

        if (format === 'json') {
          outputJson(txData, startTime);
        } else {
          outputTransactionResult('Position Opened', txData);
        }
      } catch (e) {
        const message = (e as Error).message || 'Unknown SDK error';
        if (format === 'json') {
          outputErrorJson({ code: 'SDK_ERROR', type: 'SYSTEM', message, retryable: false });
        } else {
          console.error(chalk.red(`\nSDK Error: ${message}`));
          if (process.env.DEBUG) {
            console.error((e as Error).stack);
          }
        }
        process.exit(1);
      }
    });
}

// ============================================
// positions close (SDK)
// ============================================

function createPositionsCloseCommand(): Command {
  return new Command('close')
    .description('Close a position (remove all liquidity)')
    .requiredOption('--nft-mint <address>', 'Position NFT mint address')
    .option('--slippage <bps>', 'Slippage tolerance in basis points')
    .option('--dry-run', 'Preview the close without executing')
    .option('--confirm', 'Close the position')
    .action(async (options, cmdObj: Command) => {
      const globalOptions = cmdObj.optsWithGlobals() as GlobalOptions;
      const format = globalOptions.output;
      const startTime = Date.now();

      // Check execution mode
      const mode = resolveExecutionMode(options);
      requireExecutionMode(mode, 'positions close');

      // Resolve keypair (required)
      const keypairResult = resolveKeypair(globalOptions.keypairPath);
      if (!keypairResult.ok) {
        if (format === 'json') {
          outputErrorJson(keypairResult.error);
        } else {
          outputErrorTable(keypairResult.error);
        }
        process.exit(1);
      }

      const { keypair, publicKey } = keypairResult.value;

      try {
        // Lazy-load SDK
        const { getChain } = await import('../../sdk/init.js');
        const chain = getChain();

        const nftMint = new PublicKey(options.nftMint);

        // Get position info
        const positionInfo = await chain.getPositionInfoByNftMint(nftMint);
        if (!positionInfo) {
          const errMsg = `Position not found for NFT mint: ${options.nftMint}`;
          if (format === 'json') {
            outputErrorJson({ code: 'POSITION_NOT_FOUND', type: 'BUSINESS', message: errMsg, retryable: false });
          } else {
            console.error(chalk.red(`\nError: ${errMsg}`));
          }
          process.exit(1);
        }

        // Try to resolve token symbols from API pool info
        const poolAddress = positionInfo.rawPoolInfo.poolId.toBase58();
        let symbolA = positionInfo.tokenA.address.toBase58();
        let symbolB = positionInfo.tokenB.address.toBase58();
        const poolResult = await api.getPoolInfo(poolAddress);
        if (poolResult.ok) {
          symbolA = poolResult.value.token_a.symbol || symbolA;
          symbolB = poolResult.value.token_b.symbol || symbolB;
        }

        // Dry-run: show preview
        if (mode === 'dry-run') {
          printDryRunBanner();
          const previewData = {
            nftMint: options.nftMint,
            poolAddress,
            priceLower: positionInfo.uiPriceLower,
            priceUpper: positionInfo.uiPriceUpper,
            tokenAmountA: positionInfo.tokenA.uiAmount,
            tokenAmountB: positionInfo.tokenB.uiAmount,
            feeAmountA: positionInfo.tokenA.uiFeeAmount,
            feeAmountB: positionInfo.tokenB.uiFeeAmount,
            symbolA,
            symbolB,
          };

          if (format === 'json') {
            outputJson({ mode: 'dry-run', ...previewData }, startTime);
          } else {
            outputPositionClosePreview(previewData);
            console.log(chalk.yellow('\n  Use --confirm to close this position'));
          }
          return;
        }

        // Confirm: close position
        printConfirmBanner();

        const slippage = options.slippage
          ? parseInt(options.slippage, 10) / 10000
          : getSlippageBps() / 10000;

        const result = await chain.decreaseFullLiquidityInstructions({
          userAddress: publicKey,
          nftMint,
          closePosition: true,
          slippage,
        });

        // Sign and send
        result.transaction.sign([keypair]);
        const connection = getConnection();
        const sendResult = await sendAndConfirmTransaction(connection, result.transaction);

        if (!sendResult.ok) {
          if (format === 'json') {
            outputErrorJson(sendResult.error);
          } else {
            outputErrorTable(sendResult.error);
          }
          process.exit(1);
        }

        const txData = {
          signature: sendResult.value.signature,
          confirmed: sendResult.value.confirmed,
        };

        if (format === 'json') {
          outputJson(txData, startTime);
        } else {
          outputTransactionResult('Position Closed', txData);
        }
      } catch (e) {
        const message = (e as Error).message || 'Unknown SDK error';
        if (format === 'json') {
          outputErrorJson({ code: 'SDK_ERROR', type: 'SYSTEM', message, retryable: false });
        } else {
          console.error(chalk.red(`\nSDK Error: ${message}`));
          if (process.env.DEBUG) {
            console.error((e as Error).stack);
          }
        }
        process.exit(1);
      }
    });
}

// ============================================
// positions claim (API)
// ============================================

function createPositionsClaimCommand(): Command {
  return new Command('claim')
    .description('Claim accumulated fees from positions')
    .requiredOption('--nft-mints <addresses>', 'Comma-separated NFT mint addresses (from positions list)')
    .option('--dry-run', 'Preview the claim without executing')
    .option('--confirm', 'Execute the claim')
    .action(async (options, cmdObj: Command) => {
      const globalOptions = cmdObj.optsWithGlobals() as GlobalOptions;
      const format = globalOptions.output;
      const startTime = Date.now();

      // Check execution mode
      const mode = resolveExecutionMode(options);
      requireExecutionMode(mode, 'positions claim');

      // Resolve keypair (required)
      const keypairResult = resolveKeypair(globalOptions.keypairPath);
      if (!keypairResult.ok) {
        if (format === 'json') {
          outputErrorJson(keypairResult.error);
        } else {
          outputErrorTable(keypairResult.error);
        }
        process.exit(1);
      }

      const { keypair, address } = keypairResult.value;
      const nftMints = options.nftMints.split(',').map((s: string) => s.trim());

      // Resolve NFT mints → position addresses via positions list API
      const listResult = await api.listPositions({
        userAddress: address,
        page: 1,
        pageSize: 100,
      });

      if (!listResult.ok) {
        if (format === 'json') {
          outputErrorJson(listResult.error);
        } else {
          outputErrorTable(listResult.error);
        }
        process.exit(1);
      }

      const nftToPosition = new Map<string, string>();
      for (const pos of listResult.value.positions) {
        nftToPosition.set(pos.nftMintAddress, pos.positionAddress);
      }

      const positionAddresses: string[] = [];
      const notFound: string[] = [];
      for (const nft of nftMints) {
        const posAddr = nftToPosition.get(nft);
        if (posAddr) {
          positionAddresses.push(posAddr);
        } else {
          notFound.push(nft);
        }
      }

      if (notFound.length > 0) {
        const errMsg = `Position not found for NFT mint(s): ${notFound.join(', ')}`;
        if (format === 'json') {
          outputErrorJson({ code: 'POSITION_NOT_FOUND', type: 'BUSINESS', message: errMsg, retryable: false });
        } else {
          console.error(chalk.red(`\nError: ${errMsg}`));
          console.log(chalk.gray('  Use "byreal-cli positions list" to see your NFT mint addresses'));
        }
        process.exit(1);
      }

      // Encode fee transactions
      const encodeResult = await api.encodeFee({
        walletAddress: address,
        positionAddresses,
      });

      if (!encodeResult.ok) {
        if (format === 'json') {
          outputErrorJson(encodeResult.error);
        } else {
          outputErrorTable(encodeResult.error);
        }
        process.exit(1);
      }

      const entries = encodeResult.value;

      if (entries.length === 0) {
        if (format === 'json') {
          outputJson({ message: 'No fees to claim', entries: [] }, startTime);
        } else {
          console.log(chalk.yellow('\nNo fees to claim for the specified positions'));
        }
        return;
      }

      // Dry-run: show preview
      if (mode === 'dry-run') {
        printDryRunBanner();
        if (format === 'json') {
          outputJson({ mode: 'dry-run', entries }, startTime);
        } else {
          outputPositionClaimPreview(entries);
          console.log(chalk.yellow('\n  Use --confirm to claim these fees'));
        }
        return;
      }

      // Confirm: execute all fee claims
      printConfirmBanner();

      const connection = getConnection();
      const results: { positionAddress: string; signature?: string; error?: string }[] = [];

      for (const entry of entries) {
        const txResult = deserializeTransaction(entry.txPayload);
        if (!txResult.ok) {
          results.push({
            positionAddress: entry.positionAddress,
            error: txResult.error.message,
          });
          continue;
        }

        const signedTx = signTransaction(txResult.value, keypair);
        const sendResult = await sendAndConfirmTransaction(connection, signedTx);

        if (!sendResult.ok) {
          results.push({
            positionAddress: entry.positionAddress,
            error: sendResult.error.message,
          });
        } else {
          results.push({
            positionAddress: entry.positionAddress,
            signature: sendResult.value.signature,
          });
        }
      }

      if (format === 'json') {
        outputJson({ results }, startTime);
      } else {
        console.log(chalk.green.bold('\nFee Claim Results\n'));
        for (const r of results) {
          if (r.signature) {
            console.log(chalk.green(`  ${r.positionAddress}`));
            console.log(chalk.gray(`    Signature: ${r.signature}`));
            console.log(chalk.blue(`    Explorer: https://solscan.io/tx/${r.signature}`));
          } else {
            console.log(chalk.red(`  ${r.positionAddress}`));
            console.log(chalk.red(`    Error: ${r.error}`));
          }
          console.log();
        }

        const succeeded = results.filter(r => r.signature).length;
        const failed = results.filter(r => r.error).length;
        console.log(chalk.gray(`  ${succeeded} succeeded, ${failed} failed`));
      }
    });
}

// ============================================
// positions (parent command)
// ============================================

export function createPositionsCommand(): Command {
  const cmd = new Command('positions')
    .description('Manage CLMM positions');

  cmd.addCommand(createPositionsListCommand());
  cmd.addCommand(createPositionsOpenCommand());
  cmd.addCommand(createPositionsCloseCommand());
  cmd.addCommand(createPositionsClaimCommand());

  return cmd;
}
