# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build      # tsc -> build/, then chmod 755 build/index.js
npm start          # node build/index.js (requires a prior build)
npm run watch      # tsc --watch
npm run inspector  # npx @modelcontextprotocol/inspector build/index.js
npx tsc --noEmit   # typecheck only; currently passes
```

`build/` is gitignored, so build before `start`/`inspector`. There is **no test runner and no linter** in this repo — don't reference `npm test` or `npm run lint`, and add the tooling before claiming a check passed.

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
- SDMX-ML responses are **namespaced**: `message:Structure > message:Structures > structure:Dataflows > structure:Dataflow`, with `common:Name` / `common:Description`. The `XMLParser` at `ABSApiClient.ts:19` does not set `removeNSPrefix`, so `DataFlowService.ts:76` matches nothing and `|| []` reports success with zero flows. `removeNSPrefix: true` fixes the path and the name/description extraction together.
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
