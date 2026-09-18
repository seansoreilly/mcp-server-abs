# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build      # tsc -> build/, then chmod 755 build/index.js
npm start          # node build/index.js (requires a prior build)
npm run watch      # tsc --watch
npm run inspector  # npx @modelcontextprotocol/inspector build/index.js
npx tsc --noEmit   # typecheck only; currently passes
npm test           # vitest run (pretest builds first — the MCP test needs build/)
npm run test:watch # vitest in watch mode
npm run typecheck  # both tsconfigs: src and tests
```

`build/` is gitignored, so build before `start`/`inspector`. There is **no linter** in this repo — don't reference `npm run lint`.

## Tests

Vitest, in `tests/` (not `src/`, which would ship them in the published `build/`). 61 tests across four files:

- `tests/parser.test.ts` — characterises the real SDMX-ML payload shape against `dataflows.xml`.
- `tests/ABSApiClient.test.ts` — URL/param/Accept-header shaping and error mapping, with axios mocked.
- `tests/DataFlowService.test.ts` — cache lifecycle (fresh/stale/forced/ENOENT/corrupt) and flow extraction.
- `tests/server.integration.test.ts` — spawns `build/index.js` and drives it with the SDK's own MCP client over stdio. Doubles as a guard on the stdio contract: anything logged to stdout breaks the handshake and fails these tests.

`tsconfig.test.json` typechecks `tests/` (the base config's `include`/`rootDir` cover `src` only).

**Known bugs are marked `it.fails`**, each with a comment naming the defect and the fix. They pass while the bug exists and flip to red — forcing the marker's removal — once it's fixed. The suite is green both before and after the parser fix; verified by applying it and re-running. Don't "fix" a failing `it.fails` test by deleting it: it means the bug is gone, so drop the `.fails` instead.

## What this is

An MCP server (stdio transport) exposing the Australian Bureau of Statistics SDMX-ML Data API to AI assistants. Entry point `src/index.ts`; published as the `abs-mcp-server` bin.

## Architecture: the service layer is currently unreachable

This is the single most important thing to know before editing.

- `src/index.ts` imports only the MCP SDK and axios. It registers one tool, `query_dataset` (`src/index.ts:31`), and inlines a raw axios call (`src/index.ts:62`).
- `ABSApiClient`, `DataFlowService`, `utils/logger.ts`, and most of `types/abs.ts` are imported by no reachable path — they are dead code as the server runs today.
- The commit trail (`basic commands working` → `trying to fix dataflow retrieval` → `remove hardcoded dataflows`) shows the service layer is the intended direction and `index.ts` is a debugging fallback that stuck. **Wire `index.ts` to `DataFlowService`; don't delete the services.**
- `README.md` documents the intended design (dynamic discovery, caching, multi-format), not the running code. Treat it as aspirational.

## ABS API facts (verified)

- Working base URL is `https://data.api.abs.gov.au` **with a `/rest/` path prefix** — as used at `src/services/abs/ABSApiClient.ts:12` and `:88`.
- `src/index.ts:11` uses `https://api.data.abs.gov.au` — the segments are transposed and the host does not resolve (DNS failure). Host swap alone still returns 403; the `/rest/` prefix is also required. Define the base URL in exactly one module so the two can never drift again.
- SDMX-ML responses are **namespaced**: `message:Structure > message:Structures > structure:Dataflows > structure:Dataflow`, with `common:Name` / `common:Description`. The `XMLParser` at `ABSApiClient.ts:19` does not set `removeNSPrefix`, so `DataFlowService.ts:76` matches nothing and `|| []` reports success with zero flows.
- **`removeNSPrefix: true` is necessary but NOT sufficient** (corrected 2026-09-18; verified in `tests/parser.test.ts`). `DataFlowService.ts:76` reads `Structure.Dataflows.Dataflow` — three levels — but the message wraps the dataflows in `message:Structures`, so the correct path is `Structure.Structures.Dataflows.Dataflow`, four levels. Stripping prefixes without adding the missing `Structures` level still yields zero flows. Both changes are needed; applying both yields 1208 flows with names and descriptions populated.
- `dataflows.xml` (3.5 MB, tracked, read by no source file) is a real captured response containing 1208 dataflows — a genuine parser fixture, and the reason the parsing bugs are cheaply testable.

## stdio transport constraint

stdout is the JSON-RPC channel. **Only stderr is safe for logging.** `src/index.ts` correctly uses `console.error`, but the winston Console transport at `src/utils/logger.ts:31` sets no `stderrLevels` — in winston 3 that means *every* level, including `error`, goes to stdout. This is latent only because the logger is unreachable; it becomes an immediate protocol outage the moment the service layer is wired in. Set `stderrLevels: Object.keys(winston.config.npm.levels)` or drop the console transport under stdio.

Also note the logger creates an absolute `logs/` dir (`logger.ts:6`) but writes to relative paths (`:20`, `:26`). Those agree only while cwd matches the repo — for a server launched by Claude Desktop, it generally won't.

## Caching

`DataFlowService` persists dataflows as JSON to a constructor-supplied path with a 24h default refresh (`DataFlowService.ts:13`), loading on first access and falling through to a fetch when stale. The on-disk cache is `JSON.parse`d and cast without validation (`:109`).

## MCP SDK version

Pinned to exactly `@modelcontextprotocol/sdk@0.6.0` — the pre-1.0 low-level API (`server.setRequestHandler(Schema, handler)`). The `capabilities.tools.{list, call}` keys at `src/index.ts:21` are not part of the SDK's tools capability (which declares only `listChanged`); they survive as meaningless passthrough. Upgrade context, including the 2026-07-28 "modern era" protocol changes, is researched on the `worktree-mcp-protocol-research` branch under `agent_docs/mcp-protocol-changes.md`.

## Conventions

Style is split and nothing enforces it: `src/index.ts` is 2-space indent with double quotes; every other file is 4-space with single quotes. Match the file you're editing. ESM with `"type": "module"` and `Node16` resolution — **relative imports need the `.js` extension** even in `.ts` sources.

A verified, `file:line`-referenced list of the known bugs and cleanups (including the `any` usages, missing return types, and double-logging) lives at `.claude/plans/clean-code-improvements.md`. Read it before a cleanup pass rather than re-deriving it.
