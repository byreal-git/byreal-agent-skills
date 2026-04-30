# Byreal CLI - Project Rules

## Display Rules

- **Never abbreviate on-chain addresses**: In both table and JSON output, always display Solana mint / pool / position addresses in full. Never truncate with `...`.

## Commit Convention

- All commit messages must be in English
- Use conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`

## Adding New Commands

When adding a new CLI command, **all** of the following must be updated in the same PR:

1. `src/cli/commands/*.ts` — Command implementation and registration
2. `src/cli/output/formatters.ts` — Output formatter functions (if the command has preview/table output)
3. `src/cli/commands/catalog.ts` — Add capability entry to `CAPABILITIES` array
4. `src/cli/commands/skill.ts` — Add to capability table, quick reference, detailed docs, and relevant workflow sections
5. `README.md` — Add to the Commands table

## Architecture

- `src/cli/` — Command definitions and output formatting
- `src/core/` — Types, constants, API client
- `src/sdk/` — On-chain interaction (Solana RPC, transaction building)
- `src/libs/` — Vendored libraries (CLMM SDK)
- `skills/` — AI skill definition for LLM integration
- `playground/` — Local-only signing scripts (gitignored)

## Execution Modes

Every write command (`swap execute`, `positions open/close/increase/decrease/claim/claim-rewards/claim-bonus/copy`, plugin write commands) supports three modes:

| Mode          | Flag             | Behavior                                                                |
| ------------- | ---------------- | ----------------------------------------------------------------------- |
| unsigned-tx (default) | (none)   | Back-compat: emit `{ unsignedTransactions: [base64] }` for an external signer. |
| execute       | `--execute`      | Sign + broadcast via Privy proxy → `{ signature, explorer }` (or `{ results, successCount, failCount }` for multi-tx). |
| dry-run       | `--dry-run`      | Preview only, no transaction generated.                                 |

`--dry-run` and `--execute` are mutually exclusive (error on both). The default (no flag) is `unsigned-tx` — this matches the pre-Privy CLI so existing LLM prompts and external signing flows keep working without changes.

When adding a new write command, the action handler must:
1. Add `.option('--execute', '...')` (alongside `--dry-run`).
2. **Use `safeResolveExecutionMode(options, format)`** from `src/cli/output/formatters.ts` — NOT the raw `resolveExecutionMode(options)` from `src/core/confirm.ts`. The raw function throws `ByrealError` when `--dry-run` and `--execute` are combined, and most action handlers call it before their `try/catch`, so the error escapes as an unhandled rejection (stderr noise, exit code 0). The `safe*` wrapper catches the throw and emits a structured `INVALID_PARAMETER` JSON / table.
3. Branch on `mode === 'dry-run' | 'unsigned-tx' | 'execute'` (the mode-string values are stable; only the trigger flag changed).
4. In `execute` mode call `requirePrivyContext(walletAddress)` + `printPrivySignBanner()` + the appropriate Privy helper (`privyBroadcastOne`, `privyBroadcastMany`, or `privySignMany`).
5. **For multi-step flows that hit the backend before signing** (e.g. the atomic reward claim: `api.encodeReward` → sign → `api.submitRewardOrder`), call `requirePrivyContext(walletAddress)` *before* the first backend call when `mode === 'execute'`. Otherwise a misconfigured client will burn an `encode` call and leave an orphan `orderCode` server-side.
6. Banner helpers (`printPrivySignBanner`, `printDryRunBanner`) write to stderr — never log to stdout from any code path that runs in `--output json` mode, since stdout is reserved for the JSON payload.

Reference implementation: `src/cli/commands/swap.ts` for single-tx broadcast, `src/cli/commands/positions.ts` claim-rewards for the atomic 3-step flow.

## End-to-End Testing (Sign & Send)

There are two ways to test on-chain:

### Path 1: `--execute` (Privy proxy)

Configure `~/.openclaw/realclaw-config.json` (or env vars `AGENT_TOKEN` + `PRIVY_PROXY_URL`) and add `--execute` to any write command. CLI signs + broadcasts via Privy proxy directly; output includes `signature` + `explorer`.

### Path 2: default unsigned-tx + `playground/sign-and-send.ts` (back-compat)

The default — no flag — still emits `{ unsignedTransactions: [base64] }`. Pipe it to the signing script in `playground/` for external-signer flows. This matches the pre-Privy CLI behavior, so any LLM prompt or script written before the Privy integration keeps working unchanged.

### Prerequisites

Copy the env template and fill in your base58 secret key:

```bash
cp playground/.env.bak playground/.env
# Edit playground/.env:
#   SOL_SECRET_KEY=<your-base58-private-key>
#   SOL_ENDPOINT=<rpc-url>        # optional, defaults to Helius
```

**Always `npm run build` before on-chain E2E.** `npx byreal-cli` resolves to `dist/index.cjs` (see `package.json#bin`), not `src/`. A plugin change that is not rebuilt will sign & broadcast the **old** behavior silently.

### Usage

**Pipe the default unsigned-tx output directly to the signing script:**

```bash
# Swap
npx byreal-cli swap execute --input-mint <mintA> --output-mint <mintB> --amount 0.01 \
  --wallet-address <address> \
  | npx tsx playground/sign-and-send.ts

# Open position
npx byreal-cli positions open --pool <poolAddr> --wallet-address <address> ... \
  | npx tsx playground/sign-and-send.ts

# Claim fees
npx byreal-cli positions claim --nft-mints <addrs> --wallet-address <address> \
  | npx tsx playground/sign-and-send.ts
```

> **Note:** `claim-rewards` and `claim-bonus` are atomic only when `--execute` is passed — the CLI internally signs + submits to the backend in one shot. Without `--execute` (the default), they emit the multi-step `{ orderCode, unsignedTransactions: [...] }` payload that you sign externally and submit via `positions submit-rewards`.

**Or pass a base64 transaction directly:**

```bash
npx tsx playground/sign-and-send.ts <base64-encoded-transaction>
```

### How it works

1. The CLI outputs JSON with `{ unsignedTransactions: [...] }` (base64-encoded `VersionedTransaction`).
2. `sign-and-send.ts` deserializes each transaction, signs with the local keypair, sends via RPC, and waits for confirmation.
3. It handles both simple string arrays and `{ txPayload, txCode }` object arrays (used by reward claims).

### Notes

- `playground/` is gitignored — `.env`, scripts, and keys there will never be committed.
- The script reads `SOL_SECRET_KEY` (base58) and `SOL_ENDPOINT` (RPC URL) from `playground/.env`.
- Always use a **test wallet with small amounts** for end-to-end testing.
