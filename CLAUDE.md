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

## End-to-End Testing (Sign & Send)

The CLI generates unsigned transactions. To complete the full on-chain flow, use the signing script in `playground/`.

### Prerequisites

Copy the env template and fill in your base58 secret key:

```bash
cp playground/.env.bak playground/.env
# Edit playground/.env:
#   SOL_SECRET_KEY=<your-base58-private-key>
#   SOL_ENDPOINT=<rpc-url>        # optional, defaults to Helius
```

### Usage

**Pipe CLI output directly to the signing script:**

```bash
# Swap
npx byreal-cli swap execute --from <mintA> --to <mintB> --amount 0.01 --wallet <address> --json \
  | npx tsx playground/sign-and-send.ts

# Open position
npx byreal-cli positions open --pool <poolAddr> --wallet <address> ... --json \
  | npx tsx playground/sign-and-send.ts

# Claim fees
npx byreal-cli positions claim-fees --position <posAddr> --wallet <address> --json \
  | npx tsx playground/sign-and-send.ts

# Claim rewards
npx byreal-cli positions claim-rewards --position <posAddr> --wallet <address> --json \
  | npx tsx playground/sign-and-send.ts
```

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
