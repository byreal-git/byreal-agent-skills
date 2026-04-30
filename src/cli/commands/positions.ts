/**
 * Positions commands for Byreal CLI (openclaw branch).
 *
 * Three execution modes (see src/core/confirm.ts):
 *   - default:            emit base64 unsigned transaction(s) (back-compat).
 *   - --execute:          sign + broadcast via Privy proxy.
 *   - --dry-run:          preview only; no transaction generated.
 *
 * - positions list: List user positions
 * - positions open: Open a new position (SDK)
 * - positions close: Close a position (SDK)
 * - positions claim: Claim fees (API)
 * - positions claim-rewards / claim-bonus: atomic encode + sign + submit
 */

import { Command } from "commander";
import chalk from "chalk";
import BN from "bn.js";
import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import type { GlobalOptions } from "../../core/types.js";
import { api } from "../../api/endpoints.js";
import { uiToRaw, rawToUi } from "../../core/amounts.js";
import { getConnection, getSlippageBps } from "../../core/solana.js";
import {
  printDryRunBanner,
  printPrivySignBanner,
} from "../../core/confirm.js";
import {
  deserializeTransaction,
  serializeTransaction,
} from "../../core/transaction.js";
import {
  ByrealError,
  missingWalletAddressError,
} from "../../core/errors.js";
import {
  requirePrivyContext,
  privyBroadcastOne,
  privyBroadcastMany,
  privySignMany,
} from "../../privy/index.js";
import {
  outputJson,
  outputErrorJson,
  outputErrorTable,
  outputPositionsTable,
  outputPositionOpenPreview,
  outputPositionClosePreview,
  outputPositionIncreasePreview,
  outputPositionDecreasePreview,
  outputPositionClaimPreview,
  outputRewardsPreview,
  outputBonusPreview,
  outputPositionAnalysisTable,
  outputTopPositionsTable,
  outputCopyPositionPreview,
  outputRewardOrderResult,
  outputTransactionResult,
  outputMultiBroadcastResult,
  safeResolveExecutionMode,
  formatUsd,
} from "../output/formatters.js";

// ============================================
// positions list
// ============================================

function createPositionsListCommand(): Command {
  return new Command("list")
    .description("List positions for your wallet or any wallet address")
    .option("--user <address>", "Query positions for a specific wallet address (read-only, no --wallet-address needed)")
    .option("--page <n>", "Page number", "1")
    .option("--page-size <n>", "Page size", "20")
    .option("--sort-field <field>", "Sort field")
    .option("--sort-type <type>", "Sort direction: asc or desc")
    .option("--pool <address>", "Filter by pool address")
    .option(
      "--status <status>",
      "Filter by status: 0=active, 1=closed (default: 0)",
    )
    .action(async (options, cmdObj: Command) => {
      const globalOptions = cmdObj.optsWithGlobals() as GlobalOptions;
      const format = globalOptions.output;
      const startTime = Date.now();

      // Resolve target address: --user takes priority, fallback to --wallet-address
      const userAddress = options.user || globalOptions.walletAddress;
      if (!userAddress) {
        const errMsg = "Provide --user <address> or global --wallet-address to specify which wallet to query.";
        if (format === "json") {
          outputErrorJson({ code: "MISSING_ADDRESS", type: "VALIDATION", message: errMsg, retryable: false });
        } else {
          console.error(chalk.red(`\nError: ${errMsg}`));
        }
        process.exit(1);
      }

      if (options.user && format !== "json") {
        console.log(chalk.gray(`\n  Positions for: ${options.user}\n`));
      }

      const result = await api.listPositions({
        userAddress,
        page: parseInt(options.page, 10),
        pageSize: parseInt(options.pageSize, 10),
        sortField: options.sortField,
        sortType: options.sortType,
        poolAddress: options.pool,
        status: options.status !== undefined ? parseInt(options.status, 10) : 0,
      });

      if (!result.ok) {
        if (format === "json") {
          outputErrorJson(result.error);
        } else {
          outputErrorTable(result.error);
        }
        process.exit(1);
      }

      if (format === "json") {
        const enriched = {
          ...result.value,
          positions: result.value.positions.map((p) => ({
            ...p,
            liquidityUsdDisplay: p.liquidityUsd ? formatUsd(parseFloat(p.liquidityUsd)) : "$0.00",
            earnedUsdDisplay: p.earnedUsd ? formatUsd(parseFloat(p.earnedUsd)) : "$0.00",
            pnlUsdDisplay: p.pnlUsd
              ? (parseFloat(p.pnlUsd) < 0
                ? `-${formatUsd(Math.abs(parseFloat(p.pnlUsd)))}`
                : formatUsd(parseFloat(p.pnlUsd)))
              : "$0.00",
            bonusUsdDisplay: p.bonusUsd ? formatUsd(parseFloat(p.bonusUsd)) : "$0.00",
          })),
        };
        outputJson(enriched, startTime);
      } else {
        outputPositionsTable(result.value.positions, result.value.total);
      }
    });
}

// ============================================
// Balance check for open position
// ============================================

const SOL_MINT = "So11111111111111111111111111111111111111112";

// Well-known token symbols for display
const KNOWN_SYMBOLS: Record<string, string> = {
  So11111111111111111111111111111111111111112: "SOL",
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: "USDC",
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: "USDT",
  "4SoQ8UkWfeDH47T56PA53CZCeW4KytYCiU65CwBWoJUt": "MNT",
  D6xWgRCSHoMEB5fqPwk3p6Stxirn5ytm2WwboSTTx4oE: "PYBOBO",
  AymATz4TCL9sWNEEV9Kvyz45CHVhDZ6kUgjTJPzLpU9P: "XAUT",
  XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB: "TSLAx",
  "98sMhvDwXj1RQi5c5Mndm3vPe9cBqPrbLaufMXFNMh5g": "HYPE",
  Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh: "NVDAx",
  Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ: "QQQx",
};

interface WalletBalanceSummary {
  sol: string;
  tokens: { mint: string; symbol: string; amount: string; decimals: number }[];
}

async function fetchWalletBalanceSummary(
  owner: PublicKey,
): Promise<WalletBalanceSummary> {
  const connection = getConnection();

  // SOL balance
  const lamports = await connection.getBalance(owner);
  const solUi = (lamports / LAMPORTS_PER_SOL).toString();

  // SPL + Token-2022 accounts
  interface RawAccount {
    mint: string;
    amount: bigint;
  }
  const rawAccounts: RawAccount[] = [];

  const [splResult, t22Result] = await Promise.allSettled([
    connection.getTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }),
    connection.getTokenAccountsByOwner(owner, {
      programId: TOKEN_2022_PROGRAM_ID,
    }),
  ]);

  for (const result of [splResult, t22Result]) {
    if (result.status !== "fulfilled") continue;
    for (const { account } of result.value.value) {
      const data = account.data;
      const mint = new PublicKey(data.subarray(0, 32)).toBase58();
      const amount = data.subarray(64, 72).readBigUInt64LE();
      if (amount === 0n) continue;
      rawAccounts.push({ mint, amount });
    }
  }

  // Batch fetch decimals
  const uniqueMints = [...new Set(rawAccounts.map((a) => a.mint))];
  const mintDecimals = new Map<string, number>();

  if (uniqueMints.length > 0) {
    for (let i = 0; i < uniqueMints.length; i += 100) {
      const batch = uniqueMints.slice(i, i + 100);
      const mintPubkeys = batch.map((m) => new PublicKey(m));
      const mintInfos = await connection.getMultipleAccountsInfo(mintPubkeys);
      for (let j = 0; j < batch.length; j++) {
        const info = mintInfos[j];
        if (info?.data) {
          mintDecimals.set(batch[j], info.data[44]);
        }
      }
    }
  }

  // Build token list, filtering out NFTs (decimals === 0)
  const tokens: WalletBalanceSummary["tokens"] = [];

  // Add SOL as first entry
  tokens.push({ mint: SOL_MINT, symbol: "SOL", amount: solUi, decimals: 9 });

  for (const raw of rawAccounts) {
    const decimals = mintDecimals.get(raw.mint);
    if (decimals === undefined || decimals === 0) continue;
    const amountUi = (Number(raw.amount) / Math.pow(10, decimals)).toString();
    const symbol = KNOWN_SYMBOLS[raw.mint] || raw.mint.slice(0, 8) + "...";
    tokens.push({ mint: raw.mint, symbol, amount: amountUi, decimals });
  }

  return { sol: solUi, tokens };
}

// ATA program used to derive Associated Token Account addresses
const ASSOCIATED_TOKEN_PROGRAM = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);

function getAtaAddress(
  owner: PublicKey,
  mint: PublicKey,
  tokenProgramId: PublicKey,
): PublicKey {
  const [address] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), tokenProgramId.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM,
  );
  return address;
}

async function getTokenBalance(owner: PublicKey, mint: string): Promise<BN> {
  const connection = getConnection();
  if (mint === SOL_MINT) {
    const lamports = await connection.getBalance(owner);
    return new BN(lamports.toString());
  }
  const mintPk = new PublicKey(mint);

  // Only check ATA balance — the CLMM SDK transfers from ATA, not other accounts.
  // Using getTokenAccountsByOwner would sum ALL accounts for this mint (ATA + non-ATA),
  // which over-reports available balance when leftover non-ATA accounts exist.
  const ataSpl = getAtaAddress(owner, mintPk, TOKEN_PROGRAM_ID);
  const ataT22 = getAtaAddress(owner, mintPk, TOKEN_2022_PROGRAM_ID);

  const [splInfo, t22Info] = await Promise.allSettled([
    connection.getAccountInfo(ataSpl),
    connection.getAccountInfo(ataT22),
  ]);

  let total = new BN(0);
  for (const result of [splInfo, t22Info]) {
    if (result.status !== "fulfilled") continue;
    const info = result.value;
    if (!info?.data || info.data.length < 72) continue;
    const amount = info.data.subarray(64, 72).readBigUInt64LE();
    total = total.add(new BN(amount.toString()));
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
  mintA: string,
  mintB: string,
  symbolA: string,
  symbolB: string,
  decimalsA: number,
  decimalsB: number,
  amountA: BN,
  amountB: BN,
): Promise<BalanceWarning[]> {
  const warnings: BalanceWarning[] = [];
  const [balanceA, balanceB] = await Promise.all([
    getTokenBalance(owner, mintA),
    getTokenBalance(owner, mintB),
  ]);
  if (balanceA.lt(amountA)) {
    const deficit = amountA.sub(balanceA);
    warnings.push({
      token: "A",
      symbol: symbolA,
      mint: mintA,
      required: rawToUi(amountA.toString(), decimalsA),
      available: rawToUi(balanceA.toString(), decimalsA),
      deficit: rawToUi(deficit.toString(), decimalsA),
    });
  }
  if (balanceB.lt(amountB)) {
    const deficit = amountB.sub(balanceB);
    warnings.push({
      token: "B",
      symbol: symbolB,
      mint: mintB,
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
  return new Command("open")
    .description("Open a new CLMM position")
    .requiredOption("--pool <address>", "Pool address")
    .requiredOption("--price-lower <price>", "Lower price bound")
    .requiredOption("--price-upper <price>", "Upper price bound")
    .option(
      "--base <token>",
      "Base token: MintA or MintB (required unless --amount-usd)",
    )
    .option(
      "--amount <amount>",
      "Amount of base token (UI amount unless --raw)",
    )
    .option(
      "--amount-usd <usd>",
      "Investment amount in USD (auto-calculates token split, mutually exclusive with --amount)",
    )
    .option("--slippage <bps>", "Slippage tolerance in basis points")
    .option("--raw", "Amount is already in raw (smallest unit) format")
    .option("--dry-run", "Preview the position without opening")
    .option("--execute", "Sign + broadcast on-chain via Privy (default emits unsigned tx for back-compat)")
    .action(async (options, cmdObj: Command) => {
      const globalOptions = cmdObj.optsWithGlobals() as GlobalOptions;
      const format = globalOptions.output;
      const startTime = Date.now();

      // Check execution mode
      const mode = safeResolveExecutionMode(options, format);

      // Resolve wallet address from global option
      const walletAddress = globalOptions.walletAddress;
      if (!walletAddress) {
        const err = missingWalletAddressError();
        if (format === "json") {
          outputErrorJson(err.toJSON());
        } else {
          outputErrorTable(err.toJSON());
        }
        process.exit(1);
      }
      const publicKey = new PublicKey(walletAddress);

      // Validate mutually exclusive options
      const useAmountUsd = !!options.amountUsd;
      const useTokenAmount = !!options.amount;
      if (useAmountUsd && useTokenAmount) {
        const err = {
          code: "INVALID_PARAMS",
          type: "VALIDATION" as const,
          message:
            "--amount and --amount-usd are mutually exclusive. Use one or the other.",
          retryable: false,
        };
        if (format === "json") {
          outputErrorJson(err);
        } else {
          outputErrorTable(err);
        }
        process.exit(1);
      }
      if (!useAmountUsd && !useTokenAmount) {
        const err = {
          code: "MISSING_PARAMS",
          type: "VALIDATION" as const,
          message: "Either --amount (with --base) or --amount-usd is required.",
          retryable: false,
        };
        if (format === "json") {
          outputErrorJson(err);
        } else {
          outputErrorTable(err);
        }
        process.exit(1);
      }
      if (useTokenAmount && !options.base) {
        const err = {
          code: "MISSING_PARAMS",
          type: "VALIDATION" as const,
          message:
            "--base is required when using --amount. Specify MintA or MintB.",
          retryable: false,
        };
        if (format === "json") {
          outputErrorJson(err);
        } else {
          outputErrorTable(err);
        }
        process.exit(1);
      }

      try {
        // Lazy-load SDK
        const { getChain } = await import("../../sdk/init.js");
        const { calculateTickAlignedPriceRange, calculateTokenAmountsFromUsd } =
          await import("../../sdk/calculate.js");
        const {
          getAmountBFromAmountA,
          getAmountAFromAmountB,
        } = await import("@byreal-io/byreal-clmm-sdk");

        const chain = getChain();

        // Get pool info from chain
        const poolInfo = await chain.getRawPoolInfoByPoolId(options.pool);

        // Align prices to ticks
        const { priceInTickLower, priceInTickUpper } =
          calculateTickAlignedPriceRange({
            tickSpacing: poolInfo.tickSpacing,
            mintDecimalsA: poolInfo.mintDecimalsA,
            mintDecimalsB: poolInfo.mintDecimalsB,
            startPrice: options.priceLower,
            endPrice: options.priceUpper,
          });

        const tickLower = priceInTickLower.tick;
        const tickUpper = priceInTickUpper.tick;

        // Fetch pool API info (symbols + prices) — needed by both paths
        let symbolA = "MintA";
        let symbolB = "MintB";
        let tokenAPriceUsd = 0;
        let tokenBPriceUsd = 0;
        const poolApiResult = await api.getPoolInfo(options.pool);
        if (poolApiResult.ok) {
          symbolA = poolApiResult.value.token_a.symbol || symbolA;
          symbolB = poolApiResult.value.token_b.symbol || symbolB;
          tokenAPriceUsd = poolApiResult.value.token_a.price_usd ?? 0;
          tokenBPriceUsd = poolApiResult.value.token_b.price_usd ?? 0;
        }

        // Compute token amounts
        let base: "MintA" | "MintB";
        let baseAmount: BN;
        let otherAmount: BN;
        let investmentUsd: string | undefined;

        if (useAmountUsd) {
          // --amount-usd mode: auto-calculate token split from USD
          if (tokenAPriceUsd <= 0 || tokenBPriceUsd <= 0) {
            const err = {
              code: "PRICE_UNAVAILABLE",
              type: "BUSINESS" as const,
              message: `Cannot calculate token split: token price unavailable (${symbolA}: $${tokenAPriceUsd}, ${symbolB}: $${tokenBPriceUsd})`,
              retryable: true,
            };
            if (format === "json") {
              outputErrorJson(err);
            } else {
              outputErrorTable(err);
            }
            process.exit(1);
          }

          const amounts = calculateTokenAmountsFromUsd({
            capitalUsd: parseFloat(options.amountUsd),
            tokenAPriceUsd,
            tokenBPriceUsd,
            priceLower: priceInTickLower.price,
            priceUpper: priceInTickUpper.price,
            poolInfo,
          });

          base = "MintA";
          baseAmount = amounts.amountA;
          otherAmount = amounts.amountB;
          investmentUsd = parseFloat(options.amountUsd).toFixed(2);
        } else {
          // --amount mode: existing behavior
          base = options.base as "MintA" | "MintB";
          const baseDecimals =
            base === "MintA" ? poolInfo.mintDecimalsA : poolInfo.mintDecimalsB;
          baseAmount = options.raw
            ? new BN(options.amount)
            : new BN(uiToRaw(options.amount, baseDecimals));

          if (base === "MintA") {
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
        }

        // Apply slippage to otherAmountMax
        const slippageBps = options.slippage
          ? parseInt(options.slippage, 10)
          : getSlippageBps();
        const slippageMultiplier = 10000 + slippageBps;
        const otherAmountMax = otherAmount
          .mul(new BN(slippageMultiplier))
          .div(new BN(10000));

        const decimals =
          base === "MintA" ? poolInfo.mintDecimalsA : poolInfo.mintDecimalsB;
        const otherDecimals =
          base === "MintA" ? poolInfo.mintDecimalsB : poolInfo.mintDecimalsA;
        const baseSymbol = base === "MintA" ? symbolA : symbolB;
        const otherSymbol = base === "MintA" ? symbolB : symbolA;

        // Dry-run: show preview + balance check
        if (mode === "dry-run") {
          printDryRunBanner();

          const mintAStr = poolInfo.mintA.toBase58();
          const mintBStr = poolInfo.mintB.toBase58();
          const requiredA = base === "MintA" ? baseAmount : otherAmountMax;
          const requiredB = base === "MintA" ? otherAmountMax : baseAmount;

          const amountAUi = rawToUi(
            (base === "MintA" ? baseAmount : otherAmountMax).toString(),
            poolInfo.mintDecimalsA,
          );
          const amountBUi = rawToUi(
            (base === "MintA" ? otherAmountMax : baseAmount).toString(),
            poolInfo.mintDecimalsB,
          );
          const amountAUsd =
            tokenAPriceUsd > 0
              ? (parseFloat(amountAUi) * tokenAPriceUsd).toFixed(2)
              : undefined;
          const amountBUsd =
            tokenBPriceUsd > 0
              ? (parseFloat(amountBUi) * tokenBPriceUsd).toFixed(2)
              : undefined;
          const totalUsd =
            amountAUsd && amountBUsd
              ? (parseFloat(amountAUsd) + parseFloat(amountBUsd)).toFixed(2)
              : undefined;

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
            ...(investmentUsd ? { investmentUsd } : {}),
            tokenA: {
              symbol: symbolA,
              amount: amountAUi,
              usd: amountAUsd ?? formatUsd(parseFloat(amountAUi) * tokenAPriceUsd),
            },
            tokenB: {
              symbol: symbolB,
              amount: amountBUi,
              usd: amountBUsd ?? formatUsd(parseFloat(amountBUi) * tokenBPriceUsd),
            },
            totalUsd: totalUsd ?? formatUsd(
              parseFloat(amountAUi) * tokenAPriceUsd +
              parseFloat(amountBUi) * tokenBPriceUsd
            ),
          };

          // Check wallet balance
          const balanceWarnings = await checkBalanceSufficiency(
            publicKey,
            mintAStr,
            mintBStr,
            symbolA,
            symbolB,
            poolInfo.mintDecimalsA,
            poolInfo.mintDecimalsB,
            requiredA,
            requiredB,
          );

          // Fetch full wallet balances only when there are balance warnings
          let walletBalances: WalletBalanceSummary | undefined;
          if (balanceWarnings.length > 0) {
            walletBalances = await fetchWalletBalanceSummary(publicKey);
          }

          if (format === "json") {
            const jsonData: Record<string, unknown> = {
              mode: "dry-run",
              ...previewData,
            };
            if (balanceWarnings.length > 0) {
              jsonData.balanceWarnings = balanceWarnings.map((w) => ({
                symbol: w.symbol,
                mint: w.mint,
                required: w.required,
                available: w.available,
                deficit: w.deficit,
                suggestion: `Swap to get at least ${w.deficit} ${w.symbol} before opening position. Use: byreal-cli swap execute --output-mint ${w.mint} --input-mint <source-token-mint> --amount <amount>`,
              }));
              jsonData.walletBalances = walletBalances;
            }
            outputJson(jsonData, startTime);
          } else {
            outputPositionOpenPreview(previewData);
            if (balanceWarnings.length > 0) {
              console.log(chalk.red.bold("\n  Insufficient Balance"));
              for (const w of balanceWarnings) {
                console.log(
                  chalk.red(
                    `    ${w.symbol}: need ${w.required}, have ${w.available} (deficit: ${w.deficit})`,
                  ),
                );
                console.log(
                  chalk.yellow(
                    `    → Swap to get ${w.symbol}: byreal-cli swap execute --output-mint ${w.mint} --input-mint <source-token-mint> --amount <amount>`,
                  ),
                );
              }
              // Show available tokens for swap
              if (walletBalances) {
                console.log(chalk.cyan.bold("\n  Available Tokens for Swap"));
                for (const t of walletBalances.tokens) {
                  console.log(
                    chalk.white(`    ${t.symbol}: ${t.amount} (${t.mint})`),
                  );
                }
              }
            } else {
              console.log(chalk.green("\n  Balance check: sufficient"));
              console.log(
                chalk.yellow("\n  Remove --dry-run to emit an unsigned transaction; add --execute to sign + broadcast via Privy."),
              );
            }
          }
          return;
        }

        // Build the unsigned transaction (used by both unsigned-tx and execute modes).
        const result = await chain.createPositionInstructions({
          userAddress: publicKey,
          poolInfo,
          tickLower,
          tickUpper,
          base,
          baseAmount,
          otherAmountMax,
        });
        const base64 = serializeTransaction(result.transaction);

        if (mode === "unsigned-tx") {
          console.log(JSON.stringify({ unsignedTransactions: [base64] }));
          return;
        }

        // Default (execute): sign + broadcast via Privy.
        const ctx = requirePrivyContext(walletAddress);
        printPrivySignBanner();
        const broadcast = await privyBroadcastOne(ctx, base64);
        if (!broadcast.ok) {
          if (format === "json") outputErrorJson(broadcast.error.toJSON());
          else outputErrorTable(broadcast.error.toJSON());
          process.exit(1);
        }
        if (format === "json") {
          outputJson(
            {
              signature: broadcast.value.signature,
              explorer: `https://solscan.io/tx/${broadcast.value.signature}`,
            },
            startTime,
          );
        } else {
          outputTransactionResult(broadcast.value.signature);
        }
      } catch (e) {
        const message = (e as Error).message || "Unknown SDK error";
        if (format === "json") {
          outputErrorJson({
            code: "SDK_ERROR",
            type: "SYSTEM",
            message,
            retryable: false,
          });
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
// positions increase (SDK)
// ============================================

function createPositionsIncreaseCommand(): Command {
  return new Command("increase")
    .description("Add liquidity to an existing position")
    .requiredOption("--nft-mint <address>", "Position NFT mint address")
    .option(
      "--base <token>",
      "Base token: MintA or MintB (required unless --amount-usd)",
    )
    .option(
      "--amount <amount>",
      "Amount of base token to add (UI amount unless --raw)",
    )
    .option(
      "--amount-usd <usd>",
      "Investment amount in USD (auto-calculates token split, mutually exclusive with --amount)",
    )
    .option("--slippage <bps>", "Slippage tolerance in basis points")
    .option("--raw", "Amount is already in raw (smallest unit) format")
    .option("--dry-run", "Preview without executing")
    .option("--execute", "Sign + broadcast on-chain via Privy (default emits unsigned tx for back-compat)")
    .action(async (options, cmdObj: Command) => {
      const globalOptions = cmdObj.optsWithGlobals() as GlobalOptions;
      const format = globalOptions.output;
      const startTime = Date.now();

      // Check execution mode
      const mode = safeResolveExecutionMode(options, format);

      // Resolve wallet address from global option
      const walletAddress = globalOptions.walletAddress;
      if (!walletAddress) {
        const err = missingWalletAddressError();
        if (format === "json") {
          outputErrorJson(err.toJSON());
        } else {
          outputErrorTable(err.toJSON());
        }
        process.exit(1);
      }
      const publicKey = new PublicKey(walletAddress);

      // Validate mutually exclusive options
      const useAmountUsd = !!options.amountUsd;
      const useTokenAmount = !!options.amount;
      if (useAmountUsd && useTokenAmount) {
        const err = {
          code: "INVALID_PARAMS",
          type: "VALIDATION" as const,
          message:
            "--amount and --amount-usd are mutually exclusive. Use one or the other.",
          retryable: false,
        };
        if (format === "json") {
          outputErrorJson(err);
        } else {
          outputErrorTable(err);
        }
        process.exit(1);
      }
      if (!useAmountUsd && !useTokenAmount) {
        const err = {
          code: "MISSING_PARAMS",
          type: "VALIDATION" as const,
          message: "Either --amount (with --base) or --amount-usd is required.",
          retryable: false,
        };
        if (format === "json") {
          outputErrorJson(err);
        } else {
          outputErrorTable(err);
        }
        process.exit(1);
      }
      if (useTokenAmount && !options.base) {
        const err = {
          code: "MISSING_PARAMS",
          type: "VALIDATION" as const,
          message:
            "--base is required when using --amount. Specify MintA or MintB.",
          retryable: false,
        };
        if (format === "json") {
          outputErrorJson(err);
        } else {
          outputErrorTable(err);
        }
        process.exit(1);
      }

      try {
        // Lazy-load SDK
        const { getChain } = await import("../../sdk/init.js");
        const { calculateTokenAmountsFromUsd } =
          await import("../../sdk/calculate.js");
        const {
          getAmountBFromAmountA,
          getAmountAFromAmountB,
        } = await import("@byreal-io/byreal-clmm-sdk");

        const chain = getChain();
        const nftMint = new PublicKey(options.nftMint);

        // Get position info
        const positionInfo = await chain.getPositionInfoByNftMint(nftMint);
        if (!positionInfo) {
          const errMsg = `Position not found for NFT mint: ${options.nftMint}`;
          if (format === "json") {
            outputErrorJson({
              code: "POSITION_NOT_FOUND",
              type: "BUSINESS",
              message: errMsg,
              retryable: false,
            });
          } else {
            console.error(chalk.red(`\nError: ${errMsg}`));
          }
          process.exit(1);
        }

        const poolInfo = positionInfo.rawPoolInfo;
        const poolAddress = poolInfo.poolId.toBase58();

        // Fetch pool API info (symbols + prices)
        let symbolA = "MintA";
        let symbolB = "MintB";
        let tokenAPriceUsd = 0;
        let tokenBPriceUsd = 0;
        const poolApiResult = await api.getPoolInfo(poolAddress);
        if (poolApiResult.ok) {
          symbolA = poolApiResult.value.token_a.symbol || symbolA;
          symbolB = poolApiResult.value.token_b.symbol || symbolB;
          tokenAPriceUsd = poolApiResult.value.token_a.price_usd ?? 0;
          tokenBPriceUsd = poolApiResult.value.token_b.price_usd ?? 0;
        }

        // Compute token amounts
        let base: "MintA" | "MintB";
        let baseAmount: BN;
        let otherAmount: BN;
        let investmentUsd: string | undefined;

        if (useAmountUsd) {
          if (tokenAPriceUsd <= 0 || tokenBPriceUsd <= 0) {
            const err = {
              code: "PRICE_UNAVAILABLE",
              type: "BUSINESS" as const,
              message: `Cannot calculate token split: token price unavailable (${symbolA}: $${tokenAPriceUsd}, ${symbolB}: $${tokenBPriceUsd})`,
              retryable: true,
            };
            if (format === "json") {
              outputErrorJson(err);
            } else {
              outputErrorTable(err);
            }
            process.exit(1);
          }

          const amounts = calculateTokenAmountsFromUsd({
            capitalUsd: parseFloat(options.amountUsd),
            tokenAPriceUsd,
            tokenBPriceUsd,
            priceLower: positionInfo.priceLower,
            priceUpper: positionInfo.priceUpper,
            poolInfo,
          });

          base = "MintA";
          baseAmount = amounts.amountA;
          otherAmount = amounts.amountB;
          investmentUsd = parseFloat(options.amountUsd).toFixed(2);
        } else {
          base = options.base as "MintA" | "MintB";
          const baseDecimals =
            base === "MintA" ? poolInfo.mintDecimalsA : poolInfo.mintDecimalsB;
          baseAmount = options.raw
            ? new BN(options.amount)
            : new BN(uiToRaw(options.amount, baseDecimals));

          if (base === "MintA") {
            otherAmount = getAmountBFromAmountA({
              priceLower: positionInfo.priceLower,
              priceUpper: positionInfo.priceUpper,
              amountA: baseAmount,
              poolInfo,
            });
          } else {
            otherAmount = getAmountAFromAmountB({
              priceLower: positionInfo.priceLower,
              priceUpper: positionInfo.priceUpper,
              amountB: baseAmount,
              poolInfo,
            });
          }
        }

        // Apply slippage to otherAmountMax
        const slippageBps = options.slippage
          ? parseInt(options.slippage, 10)
          : getSlippageBps();
        const slippageMultiplier = 10000 + slippageBps;
        const otherAmountMax = otherAmount
          .mul(new BN(slippageMultiplier))
          .div(new BN(10000));

        const decimals =
          base === "MintA" ? poolInfo.mintDecimalsA : poolInfo.mintDecimalsB;
        const otherDecimals =
          base === "MintA" ? poolInfo.mintDecimalsB : poolInfo.mintDecimalsA;
        const baseSymbol = base === "MintA" ? symbolA : symbolB;
        const otherSymbol = base === "MintA" ? symbolB : symbolA;

        // Dry-run: show preview + balance check
        if (mode === "dry-run") {
          printDryRunBanner();

          const mintAStr = poolInfo.mintA.toBase58();
          const mintBStr = poolInfo.mintB.toBase58();
          const requiredA = base === "MintA" ? baseAmount : otherAmountMax;
          const requiredB = base === "MintA" ? otherAmountMax : baseAmount;

          const previewData = {
            nftMint: options.nftMint,
            poolAddress,
            priceLower: positionInfo.uiPriceLower,
            priceUpper: positionInfo.uiPriceUpper,
            baseAmount: rawToUi(baseAmount.toString(), decimals),
            baseToken: baseSymbol,
            otherAmount: rawToUi(otherAmountMax.toString(), otherDecimals),
            otherToken: otherSymbol,
            currentTokenA: positionInfo.tokenA.uiAmount,
            currentTokenB: positionInfo.tokenB.uiAmount,
            symbolA,
            symbolB,
            ...(investmentUsd ? { investmentUsd } : {}),
            tokenA: {
              symbol: symbolA,
              amount: rawToUi((base === "MintA" ? baseAmount : otherAmountMax).toString(), poolInfo.mintDecimalsA),
              usd: formatUsd(parseFloat(rawToUi((base === "MintA" ? baseAmount : otherAmountMax).toString(), poolInfo.mintDecimalsA)) * tokenAPriceUsd),
            },
            tokenB: {
              symbol: symbolB,
              amount: rawToUi((base === "MintA" ? otherAmountMax : baseAmount).toString(), poolInfo.mintDecimalsB),
              usd: formatUsd(parseFloat(rawToUi((base === "MintA" ? otherAmountMax : baseAmount).toString(), poolInfo.mintDecimalsB)) * tokenBPriceUsd),
            },
            currentTokenAUsd: formatUsd(parseFloat(positionInfo.tokenA.uiAmount) * tokenAPriceUsd),
            currentTokenBUsd: formatUsd(parseFloat(positionInfo.tokenB.uiAmount) * tokenBPriceUsd),
            totalUsd: formatUsd(
              parseFloat(rawToUi((base === "MintA" ? baseAmount : otherAmountMax).toString(), poolInfo.mintDecimalsA)) * tokenAPriceUsd +
              parseFloat(rawToUi((base === "MintA" ? otherAmountMax : baseAmount).toString(), poolInfo.mintDecimalsB)) * tokenBPriceUsd
            ),
          };

          // Check wallet balance
          const balanceWarnings = await checkBalanceSufficiency(
            publicKey,
            mintAStr,
            mintBStr,
            symbolA,
            symbolB,
            poolInfo.mintDecimalsA,
            poolInfo.mintDecimalsB,
            requiredA,
            requiredB,
          );

          let walletBalances: WalletBalanceSummary | undefined;
          if (balanceWarnings.length > 0) {
            walletBalances = await fetchWalletBalanceSummary(publicKey);
          }

          if (format === "json") {
            const jsonData: Record<string, unknown> = {
              mode: "dry-run",
              ...previewData,
            };
            if (balanceWarnings.length > 0) {
              jsonData.balanceWarnings = balanceWarnings.map((w) => ({
                symbol: w.symbol,
                mint: w.mint,
                required: w.required,
                available: w.available,
                deficit: w.deficit,
                suggestion: `Swap to get at least ${w.deficit} ${w.symbol}. Use: byreal-cli swap execute --output-mint ${w.mint} --input-mint <source-token-mint> --amount <amount>`,
              }));
              jsonData.walletBalances = walletBalances;
            }
            outputJson(jsonData, startTime);
          } else {
            outputPositionIncreasePreview(previewData);
            if (balanceWarnings.length > 0) {
              console.log(chalk.red.bold("\n  Insufficient Balance"));
              for (const w of balanceWarnings) {
                console.log(
                  chalk.red(
                    `    ${w.symbol}: need ${w.required}, have ${w.available} (deficit: ${w.deficit})`,
                  ),
                );
                console.log(
                  chalk.yellow(
                    `    → Swap to get ${w.symbol}: byreal-cli swap execute --output-mint ${w.mint} --input-mint <source-token-mint> --amount <amount>`,
                  ),
                );
              }
              if (walletBalances) {
                console.log(chalk.cyan.bold("\n  Available Tokens for Swap"));
                for (const t of walletBalances.tokens) {
                  console.log(
                    chalk.white(`    ${t.symbol}: ${t.amount} (${t.mint})`),
                  );
                }
              }
            } else {
              console.log(chalk.green("\n  Balance check: sufficient"));
              console.log(
                chalk.yellow("\n  Remove --dry-run to emit an unsigned transaction; add --execute to sign + broadcast via Privy."),
              );
            }
          }
          return;
        }

        // Build the unsigned transaction (used by both unsigned-tx and execute modes).
        const result = await chain.addLiquidityInstructions({
          userAddress: publicKey,
          nftMint,
          base,
          baseAmount,
          otherAmountMax,
        });
        const base64 = serializeTransaction(result.transaction);

        if (mode === "unsigned-tx") {
          console.log(JSON.stringify({ unsignedTransactions: [base64] }));
          return;
        }

        // Default (execute): sign + broadcast via Privy.
        const ctx = requirePrivyContext(walletAddress);
        printPrivySignBanner();
        const broadcast = await privyBroadcastOne(ctx, base64);
        if (!broadcast.ok) {
          if (format === "json") outputErrorJson(broadcast.error.toJSON());
          else outputErrorTable(broadcast.error.toJSON());
          process.exit(1);
        }
        if (format === "json") {
          outputJson(
            {
              signature: broadcast.value.signature,
              explorer: `https://solscan.io/tx/${broadcast.value.signature}`,
            },
            startTime,
          );
        } else {
          outputTransactionResult(broadcast.value.signature);
        }
      } catch (e) {
        const message = (e as Error).message || "Unknown SDK error";
        if (format === "json") {
          outputErrorJson({
            code: "SDK_ERROR",
            type: "SYSTEM",
            message,
            retryable: false,
          });
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
// positions decrease (SDK)
// ============================================

function createPositionsDecreaseCommand(): Command {
  return new Command("decrease")
    .description("Remove part of the liquidity from a position (keeps position open)")
    .requiredOption("--nft-mint <address>", "Position NFT mint address")
    .option("--percentage <1-100>", "Percentage of liquidity to remove")
    .option(
      "--amount-usd <usd>",
      "USD amount of liquidity to remove (mutually exclusive with --percentage)",
    )
    .option("--slippage <bps>", "Slippage tolerance in basis points")
    .option("--dry-run", "Preview without executing")
    .option("--execute", "Sign + broadcast on-chain via Privy (default emits unsigned tx for back-compat)")
    .action(async (options, cmdObj: Command) => {
      const globalOptions = cmdObj.optsWithGlobals() as GlobalOptions;
      const format = globalOptions.output;
      const startTime = Date.now();

      // Check execution mode
      const mode = safeResolveExecutionMode(options, format);

      // Validate: must provide one of --percentage or --amount-usd
      const hasPercentage = options.percentage !== undefined;
      const hasAmountUsd = options.amountUsd !== undefined;
      if (hasPercentage && hasAmountUsd) {
        const err = {
          code: "INVALID_PARAMS",
          type: "VALIDATION" as const,
          message: "--percentage and --amount-usd are mutually exclusive. Use one or the other.",
          retryable: false,
        };
        if (format === "json") {
          outputErrorJson(err);
        } else {
          outputErrorTable(err);
        }
        process.exit(1);
      }
      if (!hasPercentage && !hasAmountUsd) {
        const err = {
          code: "MISSING_PARAMS",
          type: "VALIDATION" as const,
          message: "Either --percentage or --amount-usd is required.",
          retryable: false,
        };
        if (format === "json") {
          outputErrorJson(err);
        } else {
          outputErrorTable(err);
        }
        process.exit(1);
      }

      if (hasPercentage) {
        const pct = parseFloat(options.percentage);
        if (isNaN(pct) || pct < 1 || pct > 100) {
          const err = {
            code: "INVALID_PARAMS",
            type: "VALIDATION" as const,
            message: "--percentage must be a number between 1 and 100.",
            retryable: false,
          };
          if (format === "json") {
            outputErrorJson(err);
          } else {
            outputErrorTable(err);
          }
          process.exit(1);
        }
      }

      // Resolve wallet address from global option
      const walletAddress = globalOptions.walletAddress;
      if (!walletAddress) {
        const err = missingWalletAddressError();
        if (format === "json") {
          outputErrorJson(err.toJSON());
        } else {
          outputErrorTable(err.toJSON());
        }
        process.exit(1);
      }
      const publicKey = new PublicKey(walletAddress);

      try {
        // Lazy-load SDK
        const { getChain } = await import("../../sdk/init.js");
        const chain = getChain();

        const nftMint = new PublicKey(options.nftMint);

        // Get position info
        const positionInfo = await chain.getPositionInfoByNftMint(nftMint);
        if (!positionInfo) {
          const errMsg = `Position not found for NFT mint: ${options.nftMint}`;
          if (format === "json") {
            outputErrorJson({
              code: "POSITION_NOT_FOUND",
              type: "BUSINESS",
              message: errMsg,
              retryable: false,
            });
          } else {
            console.error(chalk.red(`\nError: ${errMsg}`));
          }
          process.exit(1);
        }

        const poolAddress = positionInfo.rawPoolInfo.poolId.toBase58();

        // Try to resolve token symbols and USD prices from API pool info
        let symbolA = positionInfo.tokenA.address.toBase58();
        let symbolB = positionInfo.tokenB.address.toBase58();
        let tokenAPriceUsd = 0;
        let tokenBPriceUsd = 0;
        const poolResult = await api.getPoolInfo(poolAddress);
        if (poolResult.ok) {
          symbolA = poolResult.value.token_a.symbol || symbolA;
          symbolB = poolResult.value.token_b.symbol || symbolB;
          tokenAPriceUsd = poolResult.value.token_a.price_usd ?? 0;
          tokenBPriceUsd = poolResult.value.token_b.price_usd ?? 0;
        }

        // Calculate total position USD value
        const tokenAUiAmount = parseFloat(positionInfo.tokenA.uiAmount);
        const tokenBUiAmount = parseFloat(positionInfo.tokenB.uiAmount);
        const totalUsdA = tokenAPriceUsd > 0 ? tokenAUiAmount * tokenAPriceUsd : 0;
        const totalUsdB = tokenBPriceUsd > 0 ? tokenBUiAmount * tokenBPriceUsd : 0;
        const totalPositionUsd = totalUsdA + totalUsdB;

        // Determine percentage
        let percentage: number;
        let requestedUsd: string | undefined;

        if (hasAmountUsd) {
          const amountUsd = parseFloat(options.amountUsd);

          if (tokenAPriceUsd <= 0 || tokenBPriceUsd <= 0) {
            const err = {
              code: "PRICE_UNAVAILABLE",
              type: "BUSINESS" as const,
              message: `Cannot calculate removal amount: token price unavailable (${symbolA}: $${tokenAPriceUsd}, ${symbolB}: $${tokenBPriceUsd})`,
              retryable: true,
            };
            if (format === "json") {
              outputErrorJson(err);
            } else {
              outputErrorTable(err);
            }
            process.exit(1);
          }

          if (totalPositionUsd <= 0) {
            const err = {
              code: "ZERO_POSITION",
              type: "BUSINESS" as const,
              message: "Position has no USD value to remove.",
              retryable: false,
            };
            if (format === "json") {
              outputErrorJson(err);
            } else {
              outputErrorTable(err);
            }
            process.exit(1);
          }

          if (amountUsd > totalPositionUsd) {
            const err = {
              code: "AMOUNT_EXCEEDS_POSITION",
              type: "VALIDATION" as const,
              message: `Requested $${amountUsd.toFixed(2)} exceeds total position value of $${totalPositionUsd.toFixed(2)}.`,
              retryable: false,
              details: {
                requestedUsd: amountUsd.toFixed(2),
                totalPositionUsd: totalPositionUsd.toFixed(2),
              },
            };
            if (format === "json") {
              outputErrorJson(err);
            } else {
              outputErrorTable(err);
            }
            process.exit(1);
          }

          percentage = (amountUsd / totalPositionUsd) * 100;
          // Cap at 100
          if (percentage > 100) percentage = 100;
          requestedUsd = amountUsd.toFixed(2);
        } else {
          percentage = parseFloat(options.percentage);
        }

        // Calculate liquidity to remove
        const currentLiquidity = positionInfo.rawPositionInfo.liquidity;
        const liquidityToDecrease = currentLiquidity
          .mul(new BN(Math.floor(percentage * 100)))
          .div(new BN(10000));

        // Estimate token amounts to receive (proportional to percentage)
        const receiveAmountAUi = (tokenAUiAmount * percentage / 100).toString();
        const receiveAmountBUi = (tokenBUiAmount * percentage / 100).toString();

        const slippage = options.slippage
          ? parseInt(options.slippage, 10) / 10000
          : getSlippageBps() / 10000;

        // Dry-run: show preview
        if (mode === "dry-run") {
          printDryRunBanner();
          const receiveAUsd = parseFloat(receiveAmountAUi) * tokenAPriceUsd;
          const receiveBUsd = parseFloat(receiveAmountBUi) * tokenBPriceUsd;
          const previewData = {
            nftMint: options.nftMint,
            poolAddress,
            priceLower: positionInfo.uiPriceLower,
            priceUpper: positionInfo.uiPriceUpper,
            percentage: Math.round(percentage * 100) / 100,
            tokenAmountA: positionInfo.tokenA.uiAmount,
            tokenAmountAUsd: formatUsd(tokenAUiAmount * tokenAPriceUsd),
            tokenAmountB: positionInfo.tokenB.uiAmount,
            tokenAmountBUsd: formatUsd(tokenBUiAmount * tokenBPriceUsd),
            receiveAmountA: receiveAmountAUi,
            receiveAmountAUsd: formatUsd(receiveAUsd),
            receiveAmountB: receiveAmountBUi,
            receiveAmountBUsd: formatUsd(receiveBUsd),
            receiveUsdTotal: formatUsd(receiveAUsd + receiveBUsd),
            symbolA,
            symbolB,
            ...(totalPositionUsd > 0 ? { totalPositionUsd: formatUsd(totalPositionUsd) } : {}),
            ...(requestedUsd ? { requestedUsd } : {}),
          };

          if (format === "json") {
            outputJson({ mode: "dry-run", ...previewData }, startTime);
          } else {
            outputPositionDecreasePreview(previewData);
            console.log(
              chalk.yellow("\n  Remove --dry-run to emit an unsigned transaction; add --execute to sign + broadcast via Privy."),
            );
          }
          return;
        }

        // Build the unsigned transaction (used by both unsigned-tx and execute modes).
        let result;
        if (percentage >= 100) {
          // 100%: remove all liquidity but keep position NFT open
          result = await chain.decreaseFullLiquidityInstructions({
            userAddress: publicKey,
            nftMint,
            closePosition: false,
            slippage,
          });
        } else {
          result = await chain.decreaseLiquidityInstructions({
            userAddress: publicKey,
            nftMint,
            liquidity: liquidityToDecrease,
            slippage,
          });
        }

        const base64 = serializeTransaction(result.transaction);

        if (mode === "unsigned-tx") {
          console.log(JSON.stringify({ unsignedTransactions: [base64] }));
          return;
        }

        // Default (execute): sign + broadcast via Privy.
        const ctx = requirePrivyContext(walletAddress);
        printPrivySignBanner();
        const broadcast = await privyBroadcastOne(ctx, base64);
        if (!broadcast.ok) {
          if (format === "json") outputErrorJson(broadcast.error.toJSON());
          else outputErrorTable(broadcast.error.toJSON());
          process.exit(1);
        }
        if (format === "json") {
          outputJson(
            {
              signature: broadcast.value.signature,
              explorer: `https://solscan.io/tx/${broadcast.value.signature}`,
            },
            startTime,
          );
        } else {
          outputTransactionResult(broadcast.value.signature);
        }
      } catch (e) {
        const message = (e as Error).message || "Unknown SDK error";
        if (format === "json") {
          outputErrorJson({
            code: "SDK_ERROR",
            type: "SYSTEM",
            message,
            retryable: false,
          });
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
  return new Command("close")
    .description("Close a position (remove all liquidity)")
    .requiredOption("--nft-mint <address>", "Position NFT mint address")
    .option("--slippage <bps>", "Slippage tolerance in basis points")
    .option("--dry-run", "Preview the close without executing")
    .option("--execute", "Sign + broadcast on-chain via Privy (default emits unsigned tx for back-compat)")
    .action(async (options, cmdObj: Command) => {
      const globalOptions = cmdObj.optsWithGlobals() as GlobalOptions;
      const format = globalOptions.output;
      const startTime = Date.now();

      // Check execution mode
      const mode = safeResolveExecutionMode(options, format);

      // Resolve wallet address from global option
      const walletAddress = globalOptions.walletAddress;
      if (!walletAddress) {
        const err = missingWalletAddressError();
        if (format === "json") {
          outputErrorJson(err.toJSON());
        } else {
          outputErrorTable(err.toJSON());
        }
        process.exit(1);
      }
      const publicKey = new PublicKey(walletAddress);

      try {
        // Lazy-load SDK
        const { getChain } = await import("../../sdk/init.js");
        const chain = getChain();

        const nftMint = new PublicKey(options.nftMint);

        // Get position info
        const positionInfo = await chain.getPositionInfoByNftMint(nftMint);
        if (!positionInfo) {
          const errMsg = `Position not found for NFT mint: ${options.nftMint}`;
          if (format === "json") {
            outputErrorJson({
              code: "POSITION_NOT_FOUND",
              type: "BUSINESS",
              message: errMsg,
              retryable: false,
            });
          } else {
            console.error(chalk.red(`\nError: ${errMsg}`));
          }
          process.exit(1);
        }

        // Try to resolve token symbols and prices from API pool info
        const poolAddress = positionInfo.rawPoolInfo.poolId.toBase58();
        let symbolA = positionInfo.tokenA.address.toBase58();
        let symbolB = positionInfo.tokenB.address.toBase58();
        let tokenAPriceUsd = 0;
        let tokenBPriceUsd = 0;
        const poolResult = await api.getPoolInfo(poolAddress);
        if (poolResult.ok) {
          symbolA = poolResult.value.token_a.symbol || symbolA;
          symbolB = poolResult.value.token_b.symbol || symbolB;
          tokenAPriceUsd = poolResult.value.token_a.price_usd ?? 0;
          tokenBPriceUsd = poolResult.value.token_b.price_usd ?? 0;
        }

        // Dry-run: show preview
        if (mode === "dry-run") {
          printDryRunBanner();
          const tokenAmountAVal = parseFloat(positionInfo.tokenA.uiAmount || "0");
          const tokenAmountBVal = parseFloat(positionInfo.tokenB.uiAmount || "0");
          const feeAmountAVal = parseFloat(positionInfo.tokenA.uiFeeAmount || "0");
          const feeAmountBVal = parseFloat(positionInfo.tokenB.uiFeeAmount || "0");
          const previewData = {
            nftMint: options.nftMint,
            poolAddress,
            priceLower: positionInfo.uiPriceLower,
            priceUpper: positionInfo.uiPriceUpper,
            tokenAmountA: positionInfo.tokenA.uiAmount,
            tokenAmountAUsd: formatUsd(tokenAmountAVal * tokenAPriceUsd),
            tokenAmountB: positionInfo.tokenB.uiAmount,
            tokenAmountBUsd: formatUsd(tokenAmountBVal * tokenBPriceUsd),
            feeAmountA: positionInfo.tokenA.uiFeeAmount,
            feeAmountAUsd: formatUsd(feeAmountAVal * tokenAPriceUsd),
            feeAmountB: positionInfo.tokenB.uiFeeAmount,
            feeAmountBUsd: formatUsd(feeAmountBVal * tokenBPriceUsd),
            symbolA,
            symbolB,
            totalUsd: formatUsd(
              (tokenAmountAVal + feeAmountAVal) * tokenAPriceUsd +
              (tokenAmountBVal + feeAmountBVal) * tokenBPriceUsd
            ),
          };

          if (format === "json") {
            outputJson({ mode: "dry-run", ...previewData }, startTime);
          } else {
            outputPositionClosePreview(previewData);
            console.log(
              chalk.yellow("\n  Remove --dry-run to emit an unsigned transaction; add --execute to sign + broadcast via Privy."),
            );
          }
          return;
        }

        // Build the unsigned transaction (used by both unsigned-tx and execute modes).
        const slippage = options.slippage
          ? parseInt(options.slippage, 10) / 10000
          : getSlippageBps() / 10000;

        const result = await chain.decreaseFullLiquidityInstructions({
          userAddress: publicKey,
          nftMint,
          closePosition: true,
          slippage,
        });
        const base64 = serializeTransaction(result.transaction);

        if (mode === "unsigned-tx") {
          console.log(JSON.stringify({ unsignedTransactions: [base64] }));
          return;
        }

        // Default (execute): sign + broadcast via Privy.
        const ctx = requirePrivyContext(walletAddress);
        printPrivySignBanner();
        const broadcast = await privyBroadcastOne(ctx, base64);
        if (!broadcast.ok) {
          if (format === "json") outputErrorJson(broadcast.error.toJSON());
          else outputErrorTable(broadcast.error.toJSON());
          process.exit(1);
        }
        if (format === "json") {
          outputJson(
            {
              signature: broadcast.value.signature,
              explorer: `https://solscan.io/tx/${broadcast.value.signature}`,
            },
            startTime,
          );
        } else {
          outputTransactionResult(broadcast.value.signature);
        }
      } catch (e) {
        const message = (e as Error).message || "Unknown SDK error";
        if (format === "json") {
          outputErrorJson({
            code: "SDK_ERROR",
            type: "SYSTEM",
            message,
            retryable: false,
          });
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
  return new Command("claim")
    .description("Claim accumulated fees from positions")
    .requiredOption(
      "--nft-mints <addresses>",
      "Comma-separated NFT mint addresses (from positions list)",
    )
    .option("--dry-run", "Preview the claim without executing")
    .option("--execute", "Sign + broadcast on-chain via Privy (default emits unsigned tx for back-compat)")
    .action(async (options, cmdObj: Command) => {
      const globalOptions = cmdObj.optsWithGlobals() as GlobalOptions;
      const format = globalOptions.output;
      const startTime = Date.now();

      // Check execution mode
      const mode = safeResolveExecutionMode(options, format);

      // Resolve wallet address from global option
      const walletAddress = globalOptions.walletAddress;
      if (!walletAddress) {
        const err = missingWalletAddressError();
        if (format === "json") {
          outputErrorJson(err.toJSON());
        } else {
          outputErrorTable(err.toJSON());
        }
        process.exit(1);
      }

      const nftMints = options.nftMints.split(",").map((s: string) => s.trim());

      // Resolve NFT mints -> position addresses via positions list API
      const listResult = await api.listPositions({
        userAddress: walletAddress,
        page: 1,
        pageSize: 100,
      });

      if (!listResult.ok) {
        if (format === "json") {
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
        const errMsg = `Position not found for NFT mint(s): ${notFound.join(", ")}`;
        if (format === "json") {
          outputErrorJson({
            code: "POSITION_NOT_FOUND",
            type: "BUSINESS",
            message: errMsg,
            retryable: false,
          });
        } else {
          console.error(chalk.red(`\nError: ${errMsg}`));
          console.log(
            chalk.gray(
              '  Use "byreal-cli positions list" to see your NFT mint addresses',
            ),
          );
        }
        process.exit(1);
      }

      // Encode fee transactions
      const encodeResult = await api.encodeFee({
        walletAddress,
        positionAddresses,
      });

      if (!encodeResult.ok) {
        if (format === "json") {
          outputErrorJson(encodeResult.error);
        } else {
          outputErrorTable(encodeResult.error);
        }
        process.exit(1);
      }

      const entries = encodeResult.value;

      if (entries.length === 0) {
        if (format === "json") {
          outputJson({ message: "No fees to claim", entries: [] }, startTime);
        } else {
          console.log(
            chalk.yellow("\nNo fees to claim for the specified positions"),
          );
        }
        return;
      }

      // Dry-run: show preview
      if (mode === "dry-run") {
        printDryRunBanner();
        // Enrich entries with USD values
        const allMints = [...new Set(entries.flatMap((e: { tokens: { tokenAddress: string }[] }) => e.tokens.map((t: { tokenAddress: string }) => t.tokenAddress)))];
        const pricesResult = await api.getTokenPrices(allMints as string[]);
        const prices: Record<string, number> = pricesResult.ok ? pricesResult.value : {};
        const enrichedEntries = entries.map((entry: { positionAddress: string; txPayload: string; tokens: { tokenAddress: string; tokenAmount: string; tokenDecimals: number; tokenSymbol: string }[] }) => {
          const enrichedTokens = entry.tokens.map((t) => {
            const uiAmount = parseFloat(t.tokenAmount) / Math.pow(10, t.tokenDecimals);
            const price = prices[t.tokenAddress] ?? 0;
            return { ...t, amountUsd: formatUsd(uiAmount * price) };
          });
          const totalUsd = enrichedTokens.reduce((sum, t) => {
            const uiAmount = parseFloat(t.tokenAmount) / Math.pow(10, t.tokenDecimals);
            const price = prices[t.tokenAddress] ?? 0;
            return sum + uiAmount * price;
          }, 0);
          return { ...entry, tokens: enrichedTokens, totalUsd: formatUsd(totalUsd) };
        });
        if (format === "json") {
          outputJson({ mode: "dry-run", entries: enrichedEntries }, startTime);
        } else {
          outputPositionClaimPreview(enrichedEntries);
          console.log(chalk.yellow("\n  Remove --dry-run to emit an unsigned transaction; add --execute to sign + broadcast via Privy."));
        }
        return;
      }

      // Collect all unsigned transactions; reused by both unsigned-tx and execute modes.
      const unsignedTransactions = entries.map((entry: { txPayload: string }) => entry.txPayload);

      if (mode === "unsigned-tx") {
        console.log(JSON.stringify({ unsignedTransactions }));
        return;
      }

      // Default (execute): sign + broadcast each via Privy (sequential).
      try {
        const ctx = requirePrivyContext(walletAddress);
        printPrivySignBanner();
        const broadcast = await privyBroadcastMany(ctx, unsignedTransactions);
        if (!broadcast.ok) {
          if (format === "json") outputErrorJson(broadcast.error.toJSON());
          else outputErrorTable(broadcast.error.toJSON());
          process.exit(1);
        }
        if (format === "json") {
          outputJson(broadcast.value, startTime);
        } else {
          outputMultiBroadcastResult(broadcast.value);
        }
        if (broadcast.value.failCount > 0) process.exit(1);
      } catch (e) {
        if (e instanceof ByrealError) {
          if (format === "json") outputErrorJson(e.toJSON());
          else outputErrorTable(e.toJSON());
        } else {
          const message = (e as Error).message || "Unknown error";
          if (format === "json") {
            outputErrorJson({ code: "UNKNOWN_ERROR", type: "SYSTEM", message, retryable: false });
          } else {
            console.error(chalk.red(`\nError: ${message}`));
          }
        }
        process.exit(1);
      }
    });
}

// ============================================
// positions claim-rewards (API)
// ============================================

function createPositionsClaimRewardsCommand(): Command {
  return new Command("claim-rewards")
    .description("Claim incentive rewards from positions")
    .option("--dry-run", "Preview unclaimed rewards without claiming")
    .option("--execute", "Sign via Privy and submit to backend (default emits unsigned tx for external signers)")
    .action(async (options, cmdObj: Command) => {
      const globalOptions = cmdObj.optsWithGlobals() as GlobalOptions;
      const format = globalOptions.output;
      const startTime = Date.now();

      const mode = safeResolveExecutionMode(options, format);

      // Resolve wallet address from global option
      const walletAddress = globalOptions.walletAddress;
      if (!walletAddress) {
        const err = missingWalletAddressError();
        if (format === "json") {
          outputErrorJson(err.toJSON());
        } else {
          outputErrorTable(err.toJSON());
        }
        process.exit(1);
      }

      try {
        // Query unclaimed rewards
        const unclaimedResult = await api.getUnclaimedData(walletAddress);
        if (!unclaimedResult.ok) {
          if (format === "json") {
            outputErrorJson(unclaimedResult.error);
          } else {
            outputErrorTable(unclaimedResult.error);
          }
          process.exit(1);
        }

        const { unclaimedOpenIncentives, unclaimedClosedIncentives } = unclaimedResult.value;

        // Filter items with unclaimed > 0
        const filterUnclaimed = (items: typeof unclaimedOpenIncentives) =>
          items.filter((item) => {
            const unclaimed = parseFloat(item.syncedTokenAmount) - parseFloat(item.lockedTokenAmount) - parseFloat(item.claimedTokenAmount);
            return unclaimed > 0;
          });

        const openRewards = filterUnclaimed(unclaimedOpenIncentives);
        const closedRewards = filterUnclaimed(unclaimedClosedIncentives);
        const allRewards = [...openRewards, ...closedRewards];

        // Enrich reward items with USD values
        const enrichRewardItem = (item: typeof allRewards[number]) => {
          const unclaimed = parseFloat(item.syncedTokenAmount) - parseFloat(item.lockedTokenAmount) - parseFloat(item.claimedTokenAmount);
          const price = parseFloat(item.price || "0");
          return {
            ...item,
            unclaimedAmount: unclaimed.toString(),
            unclaimedAmountUsd: formatUsd(unclaimed * price),
          };
        };

        // Dry-run: show preview
        if (mode === "dry-run") {
          printDryRunBanner();

          if (format === "json") {
            const enrichedOpen = openRewards.map(enrichRewardItem);
            const enrichedClosed = closedRewards.map(enrichRewardItem);
            outputJson({
              mode: "dry-run",
              openPositionRewards: enrichedOpen,
              closedPositionRewards: enrichedClosed,
              totalPositions: new Set(allRewards.map((r) => r.positionAddress)).size,
            }, startTime);
          } else {
            if (openRewards.length > 0) {
              outputRewardsPreview(openRewards, "Open Position Rewards");
            }
            if (closedRewards.length > 0) {
              outputRewardsPreview(closedRewards, "Closed Position Rewards");
            }
            if (allRewards.length === 0) {
              console.log(chalk.gray("\n  No unclaimed incentive rewards.\n"));
            } else {
              console.log(
                chalk.yellow("\n  Remove --dry-run to emit an unsigned transaction; add --execute to sign + broadcast via Privy."),
              );
            }
          }
          return;
        }

        // Check if there's anything to claim
        if (allRewards.length === 0) {
          const errMsg = "No unclaimed incentive rewards to claim.";
          if (format === "json") {
            outputErrorJson({ code: "NO_REWARDS", type: "BUSINESS", message: errMsg, retryable: false });
          } else {
            console.log(chalk.yellow(`\n  ${errMsg}\n`));
          }
          return;
        }

        // Get unique position addresses
        const positionAddresses = [...new Set(allRewards.map((r) => r.positionAddress))];

        // Fail fast: in execute mode, verify Privy is available BEFORE asking
        // the backend to encode. Otherwise we waste an encode call and leave
        // an orphan orderCode in the backend on misconfigured clients.
        if (mode === "execute") requirePrivyContext(walletAddress);

        // Encode reward claim transactions
        const encodeResult = await api.encodeReward({
          walletAddress,
          positionAddresses,
          type: 1,
        });

        if (!encodeResult.ok) {
          if (format === "json") {
            outputErrorJson(encodeResult.error);
          } else {
            outputErrorTable(encodeResult.error);
          }
          process.exit(1);
        }

        const { orderCode, rewardEncodeItems } = encodeResult.value;

        if (rewardEncodeItems.length === 0) {
          const errMsg = "No reward transactions to process.";
          if (format === "json") {
            outputErrorJson({ code: "NO_TRANSACTIONS", type: "BUSINESS", message: errMsg, retryable: false });
          } else {
            console.log(chalk.yellow(`\n  ${errMsg}\n`));
          }
          return;
        }

        if (mode === "unsigned-tx") {
          // Legacy shape: emit per-pool { poolAddress, txPayload, txCode, tokens } so
          // an external signer / submit-rewards command can complete the flow.
          const txPayloads = rewardEncodeItems.map((item) => ({
            poolAddress: item.poolAddress,
            txPayload: item.txPayload,
            txCode: item.txCode,
            tokens: item.rewardClaimInfo,
          }));
          console.log(JSON.stringify({ orderCode, unsignedTransactions: txPayloads }));
          return;
        }

        // Default (execute): atomic flow — encode → privySignMany → submitRewardOrder.
        const ctx = requirePrivyContext(walletAddress);
        printPrivySignBanner();
        const signResult = await privySignMany(
          ctx,
          rewardEncodeItems.map((item) => item.txPayload),
        );
        if (!signResult.ok) {
          if (format === "json") outputErrorJson(signResult.error.toJSON());
          else outputErrorTable(signResult.error.toJSON());
          process.exit(1);
        }
        const submitResult = await api.submitRewardOrder({
          orderCode,
          walletAddress,
          signedTxPayload: rewardEncodeItems.map((item, i) => ({
            txCode: item.txCode,
            poolAddress: item.poolAddress,
            signedTx: signResult.value.signedTxs[i].signedTx,
          })),
        });
        if (!submitResult.ok) {
          if (format === "json") outputErrorJson(submitResult.error);
          else outputErrorTable(submitResult.error);
          process.exit(1);
        }
        if (format === "json") {
          outputJson(submitResult.value, startTime);
        } else {
          outputRewardOrderResult(submitResult.value);
        }
      } catch (e) {
        if (e instanceof ByrealError) {
          if (format === "json") outputErrorJson(e.toJSON());
          else outputErrorTable(e.toJSON());
          process.exit(1);
        }
        const message = (e as Error).message || "Unknown error";
        if (format === "json") {
          outputErrorJson({ code: "SDK_ERROR", type: "SYSTEM", message, retryable: false });
        } else {
          console.error(chalk.red(`\nError: ${message}`));
          if (process.env.DEBUG) {
            console.error((e as Error).stack);
          }
        }
        process.exit(1);
      }
    });
}

// ============================================
// positions claim-bonus (API)
// ============================================

function createPositionsClaimBonusCommand(): Command {
  return new Command("claim-bonus")
    .description("Claim CopyFarmer bonus rewards")
    .option("--dry-run", "Preview claimable bonus without claiming")
    .option("--execute", "Sign via Privy and submit to backend (default emits unsigned tx for external signers)")
    .action(async (options, cmdObj: Command) => {
      const globalOptions = cmdObj.optsWithGlobals() as GlobalOptions;
      const format = globalOptions.output;
      const startTime = Date.now();

      const mode = safeResolveExecutionMode(options, format);

      // Resolve wallet address from global option
      const walletAddress = globalOptions.walletAddress;
      if (!walletAddress) {
        const err = missingWalletAddressError();
        if (format === "json") {
          outputErrorJson(err.toJSON());
        } else {
          outputErrorTable(err.toJSON());
        }
        process.exit(1);
      }

      try {
        // Query epoch bonus and provider overview in parallel
        const [epochResult, overviewResult] = await Promise.all([
          api.getEpochBonus(walletAddress, -1),
          api.getProviderOverview(walletAddress),
        ]);

        if (!epochResult.ok) {
          if (format === "json") {
            outputErrorJson(epochResult.error);
          } else {
            outputErrorTable(epochResult.error);
          }
          process.exit(1);
        }

        if (!overviewResult.ok) {
          if (format === "json") {
            outputErrorJson(overviewResult.error);
          } else {
            outputErrorTable(overviewResult.error);
          }
          process.exit(1);
        }

        const epochs = epochResult.value;
        const overview = overviewResult.value;

        // Check if type=3 (CLAIMABLE) epoch is available
        const claimableEpoch = epochs['3'];
        const now = Date.now();
        const canClaim = claimableEpoch
          && parseFloat(claimableEpoch.totalBonusUsd) > 0
          && now >= claimableEpoch.claimTime
          && now < claimableEpoch.endTime;

        // Dry-run: show preview
        if (mode === "dry-run") {
          printDryRunBanner();

          if (format === "json") {
            outputJson({
              mode: "dry-run",
              overview,
              epochs,
              canClaim: !!canClaim,
              claimableAmount: canClaim ? claimableEpoch!.totalBonusUsd : '0',
            }, startTime);
          } else {
            outputBonusPreview(overview, epochs);
            if (canClaim) {
              console.log(
                chalk.yellow(`  Remove --dry-run to emit an unsigned tx; add --execute to claim $${claimableEpoch!.totalBonusUsd} bonus via Privy.\n`),
              );
            } else {
              console.log(chalk.gray("  No bonus currently claimable.\n"));
            }
          }
          return;
        }

        // Check claimability
        if (!canClaim) {
          const errMsg = claimableEpoch && parseFloat(claimableEpoch.totalBonusUsd) > 0
            ? `Bonus not yet claimable. Claim window: ${new Date(claimableEpoch.claimTime).toLocaleString()} → ${new Date(claimableEpoch.endTime).toLocaleString()}`
            : "No CopyFarmer bonus available to claim.";
          if (format === "json") {
            outputErrorJson({ code: "NO_BONUS", type: "BUSINESS", message: errMsg, retryable: false });
          } else {
            console.log(chalk.yellow(`\n  ${errMsg}\n`));
          }
          return;
        }

        // Fail fast: in execute mode, verify Privy is available BEFORE asking
        // the backend to encode (avoids wasting an encode call + orphan orderCode).
        if (mode === "execute") requirePrivyContext(walletAddress);

        // Encode bonus claim transactions (type=2, empty positionAddresses)
        const encodeResult = await api.encodeReward({
          walletAddress,
          positionAddresses: [],
          type: 2,
        });

        if (!encodeResult.ok) {
          if (format === "json") {
            outputErrorJson(encodeResult.error);
          } else {
            outputErrorTable(encodeResult.error);
          }
          process.exit(1);
        }

        const { orderCode, rewardEncodeItems } = encodeResult.value;

        if (rewardEncodeItems.length === 0) {
          const errMsg = "No bonus transactions to process.";
          if (format === "json") {
            outputErrorJson({ code: "NO_TRANSACTIONS", type: "BUSINESS", message: errMsg, retryable: false });
          } else {
            console.log(chalk.yellow(`\n  ${errMsg}\n`));
          }
          return;
        }

        if (mode === "unsigned-tx") {
          const txPayloads = rewardEncodeItems.map((item) => ({
            poolAddress: item.poolAddress,
            txPayload: item.txPayload,
            txCode: item.txCode,
            tokens: item.rewardClaimInfo,
          }));
          console.log(JSON.stringify({ orderCode, unsignedTransactions: txPayloads }));
          return;
        }

        // Default (execute): atomic flow — encode → privySignMany → submitRewardOrder.
        const ctx = requirePrivyContext(walletAddress);
        printPrivySignBanner();
        const signResult = await privySignMany(
          ctx,
          rewardEncodeItems.map((item) => item.txPayload),
        );
        if (!signResult.ok) {
          if (format === "json") outputErrorJson(signResult.error.toJSON());
          else outputErrorTable(signResult.error.toJSON());
          process.exit(1);
        }
        const submitResult = await api.submitRewardOrder({
          orderCode,
          walletAddress,
          signedTxPayload: rewardEncodeItems.map((item, i) => ({
            txCode: item.txCode,
            poolAddress: item.poolAddress,
            signedTx: signResult.value.signedTxs[i].signedTx,
          })),
        });
        if (!submitResult.ok) {
          if (format === "json") outputErrorJson(submitResult.error);
          else outputErrorTable(submitResult.error);
          process.exit(1);
        }
        if (format === "json") {
          outputJson(submitResult.value, startTime);
        } else {
          outputRewardOrderResult(submitResult.value);
        }
      } catch (e) {
        if (e instanceof ByrealError) {
          if (format === "json") outputErrorJson(e.toJSON());
          else outputErrorTable(e.toJSON());
          process.exit(1);
        }
        const message = (e as Error).message || "Unknown error";
        if (format === "json") {
          outputErrorJson({ code: "SDK_ERROR", type: "SYSTEM", message, retryable: false });
        } else {
          console.error(chalk.red(`\nError: ${message}`));
          if (process.env.DEBUG) {
            console.error((e as Error).stack);
          }
        }
        process.exit(1);
      }
    });
}

// ============================================
// positions analyze
// ============================================

function createPositionsAnalyzeCommand(): Command {
  return new Command("analyze")
    .description(
      "Analyze an existing position (performance, range health, unclaimed fees)",
    )
    .argument("<nft-mint>", "Position NFT mint address")
    .action(async (nftMintStr: string, _options: unknown, cmdObj: Command) => {
      const globalOptions = cmdObj.optsWithGlobals() as GlobalOptions;
      const format = globalOptions.output;
      const startTime = Date.now();

      // Resolve wallet address from global option
      const walletAddress = globalOptions.walletAddress;
      if (!walletAddress) {
        const err = missingWalletAddressError();
        if (format === "json") {
          outputErrorJson(err.toJSON());
        } else {
          outputErrorTable(err.toJSON());
        }
        process.exit(1);
      }

      try {
        // 1. Find position from positions list API
        const listResult = await api.listPositions({
          userAddress: walletAddress,
          page: 1,
          pageSize: 100,
        });

        if (!listResult.ok) {
          if (format === "json") {
            outputErrorJson(listResult.error);
          } else {
            outputErrorTable(listResult.error);
          }
          process.exit(1);
        }

        const posItem = listResult.value.positions.find(
          (p) => p.nftMintAddress === nftMintStr,
        );

        if (!posItem) {
          const errMsg = `Position not found for NFT mint: ${nftMintStr}`;
          if (format === "json") {
            outputErrorJson({
              code: "POSITION_NOT_FOUND",
              type: "BUSINESS",
              message: errMsg,
              retryable: false,
            });
          } else {
            console.error(chalk.red(`\nError: ${errMsg}`));
            console.log(
              chalk.gray(
                '  Use "byreal-cli positions list" to see your NFT mint addresses',
              ),
            );
          }
          process.exit(1);
        }

        // 2. Get pool info from API
        const poolResult = await api.getPoolInfo(posItem.poolAddress);
        if (!poolResult.ok) {
          if (format === "json") {
            outputErrorJson(poolResult.error);
          } else {
            outputErrorTable(poolResult.error);
          }
          process.exit(1);
        }
        const pool = poolResult.value;

        // 3. Get on-chain position info via SDK for price range and fee amounts
        const { getChain } = await import("../../sdk/init.js");
        const chain = getChain();
        const nftMint = new PublicKey(nftMintStr);
        const positionInfo = await chain.getPositionInfoByNftMint(nftMint);

        if (!positionInfo) {
          const errMsg = `Position not found on-chain for NFT mint: ${nftMintStr}`;
          if (format === "json") {
            outputErrorJson({
              code: "POSITION_NOT_FOUND",
              type: "BUSINESS",
              message: errMsg,
              retryable: false,
            });
          } else {
            console.error(chalk.red(`\nError: ${errMsg}`));
          }
          process.exit(1);
        }

        // 4. Calculate range health
        const currentPrice = pool.current_price;
        const priceLower = parseFloat(positionInfo.uiPriceLower);
        const priceUpper = parseFloat(positionInfo.uiPriceUpper);
        const rangeWidth = priceUpper - priceLower;
        const rangeWidthPercent =
          currentPrice > 0 ? (rangeWidth / currentPrice) * 100 : 0;
        const distanceToLower =
          currentPrice > 0
            ? ((currentPrice - priceLower) / currentPrice) * 100
            : 0;
        const distanceToUpper =
          currentPrice > 0
            ? ((priceUpper - currentPrice) / currentPrice) * 100
            : 0;
        const inRange =
          currentPrice >= priceLower && currentPrice <= priceUpper;

        // Out of range risk based on distance to nearest boundary
        const nearestBoundaryDist = Math.min(
          Math.abs(distanceToLower),
          Math.abs(distanceToUpper),
        );
        let outOfRangeRisk: "low" | "medium" | "high";
        if (!inRange) {
          outOfRangeRisk = "high";
        } else if (nearestBoundaryDist < 2) {
          outOfRangeRisk = "high";
        } else if (nearestBoundaryDist < 5) {
          outOfRangeRisk = "medium";
        } else {
          outOfRangeRisk = "low";
        }

        // 5. Performance from API data
        // API returns percent as decimal: 0.0129 = 1.29%
        const liquidityUsd = parseFloat(posItem.liquidityUsd || "0");
        const earnedUsd = parseFloat(posItem.earnedUsd || "0");
        const earnedPercent = posItem.earnedUsdPercent
          ? (parseFloat(posItem.earnedUsdPercent) * 100).toFixed(2)
          : liquidityUsd > 0
            ? ((earnedUsd / liquidityUsd) * 100).toFixed(2)
            : "0";
        const pnlUsd = parseFloat(posItem.pnlUsd || "0");
        const pnlPercent = posItem.pnlUsdPercent
          ? (parseFloat(posItem.pnlUsdPercent) * 100).toFixed(2)
          : liquidityUsd > 0
            ? ((pnlUsd / liquidityUsd) * 100).toFixed(2)
            : "0";
        const netReturnUsd = earnedUsd + pnlUsd;
        const netReturnPercent =
          liquidityUsd > 0
            ? ((netReturnUsd / liquidityUsd) * 100).toFixed(2)
            : "0";

        // 6. Resolve symbols
        const symbolA = posItem.tokenSymbolA || pool.token_a.symbol || "TokenA";
        const symbolB = posItem.tokenSymbolB || pool.token_b.symbol || "TokenB";

        // 7. Build output
        const analysisData = {
          position: {
            nftMint: nftMintStr,
            pool: posItem.poolAddress,
            pair: posItem.pair || pool.pair,
            priceLower: positionInfo.uiPriceLower,
            priceUpper: positionInfo.uiPriceUpper,
            status: posItem.status === 0 ? "active" : "closed",
            inRange,
          },
          performance: {
            liquidityUsd: formatUsd(liquidityUsd),
            earnedUsd: formatUsd(earnedUsd),
            earnedPercent: `${parseFloat(String(earnedPercent)).toFixed(2)}%`,
            pnlUsd: pnlUsd < 0 ? `-${formatUsd(Math.abs(pnlUsd))}` : formatUsd(pnlUsd),
            pnlPercent: `${parseFloat(String(pnlPercent)).toFixed(2)}%`,
            netReturnUsd: netReturnUsd < 0 ? `-${formatUsd(Math.abs(netReturnUsd))}` : formatUsd(netReturnUsd),
            netReturnPercent: `${parseFloat(netReturnPercent).toFixed(2)}%`,
          },
          rangeHealth: {
            currentPrice: currentPrice
              .toFixed(8)
              .replace(/0+$/, "")
              .replace(/\.$/, ""),
            distanceToLower: `${distanceToLower.toFixed(2)}%`,
            distanceToUpper: `${distanceToUpper.toFixed(2)}%`,
            rangeWidth: `${rangeWidthPercent.toFixed(2)}%`,
            outOfRangeRisk,
          },
          poolContext: {
            feeApr24h: `${pool.apr.toFixed(2)}%`,
            volume24h: formatUsd(pool.volume_24h_usd),
            tvl: formatUsd(pool.tvl_usd),
            priceChange24h: `${(pool.price_change_24h || 0).toFixed(2)}%`,
          },
          unclaimedFees: (() => {
            const feeAmountA = parseFloat(positionInfo.tokenA.uiFeeAmount || "0");
            const feeAmountB = parseFloat(positionInfo.tokenB.uiFeeAmount || "0");
            const feeAUsd = feeAmountA * (pool.token_a.price_usd ?? 0);
            const feeBUsd = feeAmountB * (pool.token_b.price_usd ?? 0);
            return {
              tokenA: {
                symbol: symbolA,
                amount: positionInfo.tokenA.uiFeeAmount,
                amountUsd: formatUsd(feeAUsd),
              },
              tokenB: {
                symbol: symbolB,
                amount: positionInfo.tokenB.uiFeeAmount,
                amountUsd: formatUsd(feeBUsd),
              },
              totalUsd: formatUsd(feeAUsd + feeBUsd),
            };
          })(),
        };

        if (format === "json") {
          outputJson(analysisData, startTime);
        } else {
          outputPositionAnalysisTable(analysisData);
        }
      } catch (e) {
        const message = (e as Error).message || "Unknown SDK error";
        if (format === "json") {
          outputErrorJson({
            code: "SDK_ERROR",
            type: "SYSTEM",
            message,
            retryable: false,
          });
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
// positions top-positions
// ============================================

function createTopPositionsCommand(): Command {
  return new Command("top-positions")
    .description("Query top positions in a pool for copy trading")
    .requiredOption("--pool <address>", "Pool address")
    .option("--page <n>", "Page number", "1")
    .option("--page-size <n>", "Page size", "20")
    .option(
      "--sort-field <field>",
      "Sort: liquidity, earned, pnl, copies, bonus",
      "liquidity",
    )
    .option("--sort-type <type>", "Sort order: asc, desc", "desc")
    .option("--status <n>", "Position status: 0=open, 1=closed", "0")
    .action(async (options, cmdObj: Command) => {
      const globalOptions = cmdObj.optsWithGlobals() as GlobalOptions;
      const format = globalOptions.output;
      const startTime = Date.now();

      const result = await api.listTopPositions({
        poolAddress: options.pool,
        page: parseInt(options.page, 10),
        pageSize: parseInt(options.pageSize, 10),
        sortField: options.sortField,
        sortType: options.sortType,
        status: parseInt(options.status, 10),
      });

      if (!result.ok) {
        if (format === "json") {
          outputErrorJson(result.error);
        } else {
          outputErrorTable(result.error);
        }
        process.exit(1);
      }

      // Enrich positions with in-range status and price range from on-chain pool data
      try {
        const { getChain } = await import("../../sdk/init.js");
        const chain = getChain();
        const poolInfo = await chain.getRawPoolInfoByPoolId(options.pool);
        const { TickMath } = await import("@byreal-io/byreal-clmm-sdk");
        for (const pos of result.value.positions) {
          pos.inRange =
            poolInfo.tickCurrent >= pos.tickLower &&
            poolInfo.tickCurrent < pos.tickUpper;
          pos.priceLower = TickMath.getPriceFromTick({
            tick: pos.tickLower,
            decimalsA: poolInfo.mintDecimalsA,
            decimalsB: poolInfo.mintDecimalsB,
          }).toString();
          pos.priceUpper = TickMath.getPriceFromTick({
            tick: pos.tickUpper,
            decimalsA: poolInfo.mintDecimalsA,
            decimalsB: poolInfo.mintDecimalsB,
          }).toString();
        }
      } catch {
        // If SDK fails, leave inRange/prices undefined — non-critical enrichment
      }

      if (format === "json") {
        outputJson(result.value, startTime);
      } else {
        outputTopPositionsTable(
          result.value.positions,
          result.value.total,
        );
      }
    });
}

// ============================================
// positions copy
// ============================================

function createCopyPositionCommand(): Command {
  return new Command("copy")
    .description(
      "Copy an existing position with referral bonus",
    )
    .requiredOption("--position <address>", "Position PDA address to copy")
    .requiredOption("--amount-usd <usd>", "Investment amount in USD")
    .option("--slippage <bps>", "Slippage tolerance in basis points")
    .option("--dry-run", "Preview the copy without executing")
    .option("--execute", "Sign + broadcast on-chain via Privy (default emits unsigned tx for back-compat)")
    .action(async (options, cmdObj: Command) => {
      const globalOptions = cmdObj.optsWithGlobals() as GlobalOptions;
      const format = globalOptions.output;
      const startTime = Date.now();

      // Check execution mode
      const mode = safeResolveExecutionMode(options, format);

      // Resolve wallet address from global option
      const walletAddress = globalOptions.walletAddress;
      if (!walletAddress) {
        const err = missingWalletAddressError();
        if (format === "json") {
          outputErrorJson(err.toJSON());
        } else {
          outputErrorTable(err.toJSON());
        }
        process.exit(1);
      }
      const publicKey = new PublicKey(walletAddress);

      try {
        const positionAddress = new PublicKey(options.position);

        // Check: cannot copy own position
        // (Backend also validates, but early check gives better UX)

        // Lazy-load SDK
        const { getChain } = await import("../../sdk/init.js");
        const { calculateTokenAmountsFromUsd, getRawPositionInfoByAddress } = await import(
          "../../sdk/calculate.js"
        );

        const chain = getChain();

        // Read parent position on-chain
        const parentPosition =
          await getRawPositionInfoByAddress(positionAddress);
        if (!parentPosition) {
          const errMsg = `Position not found on-chain: ${options.position}`;
          if (format === "json") {
            outputErrorJson({
              code: "POSITION_NOT_FOUND",
              type: "BUSINESS",
              message: errMsg,
              retryable: false,
            });
          } else {
            console.error(chalk.red(`\nError: ${errMsg}`));
          }
          process.exit(1);
        }

        const poolId = parentPosition.poolId;
        const tickLower = parentPosition.tickLower;
        const tickUpper = parentPosition.tickUpper;

        // Get on-chain pool info
        const poolInfo = await chain.getRawPoolInfoByPoolId(poolId);

        // Get pool API info (symbols + prices)
        const poolAddress = poolId.toBase58();
        let symbolA = "MintA";
        let symbolB = "MintB";
        let tokenAPriceUsd = 0;
        let tokenBPriceUsd = 0;
        const poolApiResult = await api.getPoolInfo(poolAddress);
        if (poolApiResult.ok) {
          symbolA = poolApiResult.value.token_a.symbol || symbolA;
          symbolB = poolApiResult.value.token_b.symbol || symbolB;
          tokenAPriceUsd = poolApiResult.value.token_a.price_usd ?? 0;
          tokenBPriceUsd = poolApiResult.value.token_b.price_usd ?? 0;
        }

        if (tokenAPriceUsd <= 0 || tokenBPriceUsd <= 0) {
          const err = {
            code: "PRICE_UNAVAILABLE",
            type: "BUSINESS" as const,
            message: `Cannot calculate token split: token price unavailable (${symbolA}: $${tokenAPriceUsd}, ${symbolB}: $${tokenBPriceUsd})`,
            retryable: true,
          };
          if (format === "json") {
            outputErrorJson(err);
          } else {
            outputErrorTable(err);
          }
          process.exit(1);
        }

        // Convert ticks to prices for display
        const { TickMath } = await import("@byreal-io/byreal-clmm-sdk");
        const priceLower = TickMath.getPriceFromTick({
          tick: tickLower,
          decimalsA: poolInfo.mintDecimalsA,
          decimalsB: poolInfo.mintDecimalsB,
        });
        const priceUpper = TickMath.getPriceFromTick({
          tick: tickUpper,
          decimalsA: poolInfo.mintDecimalsA,
          decimalsB: poolInfo.mintDecimalsB,
        });

        // Calculate token amounts from USD
        const capitalUsd = parseFloat(options.amountUsd);
        const amounts = calculateTokenAmountsFromUsd({
          capitalUsd,
          tokenAPriceUsd,
          tokenBPriceUsd,
          priceLower,
          priceUpper,
          poolInfo,
        });

        const amountA = amounts.amountA;
        const amountB = amounts.amountB;

        // Apply slippage
        const slippageBps = options.slippage
          ? parseInt(options.slippage, 10)
          : getSlippageBps();
        const slippageMultiplier = 10000 + slippageBps;
        const amountBMax = amountB
          .mul(new BN(slippageMultiplier))
          .div(new BN(10000));

        const amountAUi = rawToUi(amountA.toString(), poolInfo.mintDecimalsA);
        const amountBUi = rawToUi(amountBMax.toString(), poolInfo.mintDecimalsB);
        const amountAUsd =
          tokenAPriceUsd > 0
            ? (parseFloat(amountAUi) * tokenAPriceUsd).toFixed(2)
            : undefined;
        const amountBUsd =
          tokenBPriceUsd > 0
            ? (parseFloat(amountBUi) * tokenBPriceUsd).toFixed(2)
            : undefined;
        const totalUsd =
          amountAUsd && amountBUsd
            ? (parseFloat(amountAUsd) + parseFloat(amountBUsd)).toFixed(2)
            : undefined;

        const pair =
          poolApiResult.ok
            ? poolApiResult.value.pair
            : `${symbolA}/${symbolB}`;

        // Dry-run: show preview + balance check
        if (mode === "dry-run") {
          printDryRunBanner();

          const mintAStr = poolInfo.mintA.toBase58();
          const mintBStr = poolInfo.mintB.toBase58();

          const previewData = {
            parentPositionAddress: options.position,
            poolAddress,
            pair,
            tickLower,
            tickUpper,
            priceLower: priceLower.toString(),
            priceUpper: priceUpper.toString(),
            investmentUsd: capitalUsd.toFixed(2),
            tokenA: {
              symbol: symbolA,
              amount: amountAUi,
              usd: amountAUsd,
            },
            tokenB: {
              symbol: symbolB,
              amount: amountBUi,
              usd: amountBUsd,
            },
            totalUsd,
          };

          // Check wallet balance
          const balanceWarnings = await checkBalanceSufficiency(
            publicKey,
            mintAStr,
            mintBStr,
            symbolA,
            symbolB,
            poolInfo.mintDecimalsA,
            poolInfo.mintDecimalsB,
            amountA,
            amountBMax,
          );

          let walletBalances: WalletBalanceSummary | undefined;
          if (balanceWarnings.length > 0) {
            walletBalances = await fetchWalletBalanceSummary(publicKey);
          }

          if (format === "json") {
            const jsonData: Record<string, unknown> = {
              mode: "dry-run",
              ...previewData,
            };
            if (balanceWarnings.length > 0) {
              jsonData.balanceWarnings = balanceWarnings.map((w) => ({
                symbol: w.symbol,
                mint: w.mint,
                required: w.required,
                available: w.available,
                deficit: w.deficit,
                suggestion: `Swap to get at least ${w.deficit} ${w.symbol} before copying position. Use: byreal-cli swap execute --output-mint ${w.mint} --input-mint <source-token-mint> --amount <amount>`,
              }));
              jsonData.walletBalances = walletBalances;
            }
            outputJson(jsonData, startTime);
          } else {
            outputCopyPositionPreview(previewData);
            if (balanceWarnings.length > 0) {
              console.log(chalk.red.bold("\n  Insufficient Balance"));
              for (const w of balanceWarnings) {
                console.log(
                  chalk.red(
                    `    ${w.symbol}: need ${w.required}, have ${w.available} (deficit: ${w.deficit})`,
                  ),
                );
                console.log(
                  chalk.yellow(
                    `    → Swap to get ${w.symbol}: byreal-cli swap execute --output-mint ${w.mint} --input-mint <source-token-mint> --amount <amount>`,
                  ),
                );
              }
              if (walletBalances) {
                console.log(
                  chalk.cyan.bold("\n  Available Tokens for Swap"),
                );
                for (const t of walletBalances.tokens) {
                  console.log(
                    chalk.white(
                      `    ${t.symbol}: ${t.amount} (${t.mint})`,
                    ),
                  );
                }
              }
            } else {
              console.log(chalk.green("\n  Balance check: sufficient"));
              console.log(
                chalk.yellow(
                  "\n  Remove --dry-run to emit an unsigned transaction; add --execute to sign + broadcast via Privy.",
                ),
              );
            }
          }
          return;
        }

        // Build the unsigned transaction (used by both unsigned-tx and execute modes).
        const result = await chain.createPositionInstructions({
          userAddress: publicKey,
          poolInfo,
          tickLower,
          tickUpper,
          base: "MintA",
          baseAmount: amountA,
          otherAmountMax: amountBMax,
          refererPosition: options.position,
        });
        const base64 = serializeTransaction(result.transaction);

        if (mode === "unsigned-tx") {
          console.log(JSON.stringify({ unsignedTransactions: [base64] }));
          return;
        }

        // Default (execute): sign + broadcast via Privy.
        const ctx = requirePrivyContext(walletAddress);
        printPrivySignBanner();
        const broadcast = await privyBroadcastOne(ctx, base64);
        if (!broadcast.ok) {
          if (format === "json") outputErrorJson(broadcast.error.toJSON());
          else outputErrorTable(broadcast.error.toJSON());
          process.exit(1);
        }
        if (format === "json") {
          outputJson(
            {
              signature: broadcast.value.signature,
              explorer: `https://solscan.io/tx/${broadcast.value.signature}`,
            },
            startTime,
          );
        } else {
          outputTransactionResult(broadcast.value.signature);
        }
      } catch (e) {
        const message = (e as Error).message || "Unknown SDK error";
        if (format === "json") {
          outputErrorJson({
            code: "SDK_ERROR",
            type: "SYSTEM",
            message,
            retryable: false,
          });
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
// positions submit-rewards
// ============================================

function createSubmitRewardsCommand(): Command {
  return new Command("submit-rewards")
    .description(
      "Submit signed reward/bonus transactions to backend for broadcasting",
    )
    .requiredOption(
      "--order-code <code>",
      "Order code from claim-rewards or claim-bonus output",
    )
    .requiredOption(
      "--signed-payloads <json>",
      'JSON array: [{"txCode":"...","poolAddress":"...","signedTx":"<base64>"}]',
    )
    .action(async (options, cmdObj: Command) => {
      const globalOptions = cmdObj.optsWithGlobals() as GlobalOptions;
      const format = globalOptions.output;
      const startTime = Date.now();

      // Resolve wallet address
      const walletAddress = globalOptions.walletAddress;
      if (!walletAddress) {
        const err = missingWalletAddressError();
        if (format === "json") {
          outputErrorJson(err.toJSON());
        } else {
          outputErrorTable(err.toJSON());
        }
        process.exit(1);
      }

      // Parse signed payloads
      let signedPayloads: {
        txCode: string;
        poolAddress: string;
        signedTx: string;
      }[];
      try {
        signedPayloads = JSON.parse(options.signedPayloads);
        if (!Array.isArray(signedPayloads) || signedPayloads.length === 0) {
          throw new Error("must be a non-empty array");
        }
        for (const p of signedPayloads) {
          if (!p.txCode || !p.poolAddress || !p.signedTx) {
            throw new Error(
              "each entry must have txCode, poolAddress, signedTx",
            );
          }
        }
      } catch (e) {
        const errMsg = `Invalid --signed-payloads: ${(e as Error).message}`;
        if (format === "json") {
          outputErrorJson({
            code: "INVALID_PARAMETER",
            type: "VALIDATION",
            message: errMsg,
            retryable: false,
          });
        } else {
          console.error(chalk.red(`\nError: ${errMsg}`));
        }
        process.exit(1);
      }

      // Submit to backend
      const orderResult = await api.submitRewardOrder({
        orderCode: options.orderCode,
        walletAddress,
        signedTxPayload: signedPayloads,
      });

      if (!orderResult.ok) {
        if (format === "json") {
          outputErrorJson(orderResult.error);
        } else {
          outputErrorTable(orderResult.error);
        }
        process.exit(1);
      }

      if (format === "json") {
        outputJson(orderResult.value, startTime);
      } else {
        outputRewardOrderResult(orderResult.value);
      }
    });
}

// ============================================
// positions (parent command)
// ============================================

export function createPositionsCommand(): Command {
  const cmd = new Command("positions").description("Manage CLMM positions");

  cmd.addCommand(createPositionsListCommand());
  cmd.addCommand(createPositionsOpenCommand());
  cmd.addCommand(createPositionsIncreaseCommand());
  cmd.addCommand(createPositionsDecreaseCommand());
  cmd.addCommand(createPositionsCloseCommand());
  cmd.addCommand(createPositionsClaimCommand());
  cmd.addCommand(createPositionsClaimRewardsCommand());
  cmd.addCommand(createPositionsClaimBonusCommand());
  cmd.addCommand(createSubmitRewardsCommand());
  cmd.addCommand(createPositionsAnalyzeCommand());
  cmd.addCommand(createTopPositionsCommand());
  cmd.addCommand(createCopyPositionCommand());

  return cmd;
}
