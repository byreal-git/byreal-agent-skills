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
