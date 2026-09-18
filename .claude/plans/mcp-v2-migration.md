# Migrate abs-mcp-server to MCP SDK v2 (legacy protocol era)

## Context

`abs-mcp-server` pins `@modelcontextprotocol/sdk` **0.6.0** (Nov 2024, protocol `2024-11-05`).
That is four spec revisions and two SDK restructures behind. The research note at
`agent_docs/mcp-protocol-changes.md` (already on `main`) documents the gap.

This plan acts on that research: upgrade to the **v2 SDK packages** and fix the
spec-conformance defects the research surfaced, while staying on the **legacy protocol
era**. Verified from the SDK's own migration docs:

> "Nothing in v2 puts a 2026-07-28 byte on the wire by default: a hand-constructed
> `Client` / `Server` / `McpServer` keeps speaking the 2025-era protocol it was written for."

A default v2 server negotiates via the ordinary `initialize` handshake and settles on
**2025-11-25**. The modern era (no handshake, `server/discover`) is a separate opt-in via
`serveStdio()` / `createMcpHandler()`. Staying legacy is therefore the *default* path and
keeps the server working with every client that exists today — while moving the repo
forward by four spec revisions.

Outcome: same single `query_dataset` tool, same stdio transport, on a supported SDK and
spec-conformant.

### This is a breaking change to the error contract — state it in the PR
The migration is **not** behaviour-preserving, and that is the point of it. Today every
failure arrives at the client as a rejected JSON-RPC call. Afterwards, only an unknown tool
name does; invalid arguments and ABS API failures **resolve** with `isError: true` instead.

Any client with code like `try { await callTool(…) } catch { … }` will stop seeing those two
failure classes as exceptions and must read `result.isError`. That is the spec-conformant
shape and the reason a model can self-correct from these errors — but it is a real contract
change for existing callers, so it belongs in the PR description and the commit message, not
buried in a diff. The repo's own integration tests encode the old contract, which is why
Step 2 changes three of them deliberately.

### Corrections to the research note (fold into this PR)
The note contains three claims this planning pass disproved against primary sources:
1. `StdioServerTransport` **still exists** in v2 (the note implied `serveStdio()` was required).
2. v2's default negotiated revision is **2025-11-25**, not 2026-07-28.
3. Finding (c) — "thrown errors should become `isError`" — stated the right conclusion without
   the distinction that makes it actionable: the spec defines *two* error mechanisms, and only
   one of this server's three throw sites should stay a protocol error. See below.

## Scope decision: which errors become `isError`

The 2025-11-25 tools spec ("Error Handling") defines two mechanisms:
- **Protocol errors** (JSON-RPC): "Unknown tools", "Malformed requests", "Server errors"
- **Tool execution errors** (`isError: true`): "API failures", "Input validation errors", "Business logic errors"

Mapped onto `src/index.ts`:

| Site | Condition | Target |
|---|---|---|
| `src/index.ts:55` | unknown tool name | **stays** a protocol error (`ProtocolErrorCode.InvalidParams`) — the spec's own example is literally `Unknown tool: …` → `-32602` |
| `src/index.ts:59` | missing / non-string `datasetId` | **becomes** `isError: true` — see below |
| `src/index.ts:72-77` | ABS API call failed | **becomes** `isError: true` — an "API failure" the model can act on |

`:59` deserves its rationale spelled out, because the tempting reading is wrong. "Malformed
requests" in the spec means requests that fail the **`CallToolRequest`** schema — the wire
envelope `{name, arguments?}` — which `{name: 'query_dataset', arguments: {}}` satisfies
perfectly well. A missing `datasetId` fails the *tool's own* `inputSchema`, which is a
different thing, and the spec lists "Input validation errors" explicitly under **tool
execution errors** (its `isError` example is itself an input-validation case).

The v2 SDK confirms this is the convention, not just a permissible reading — on an input
schema failure it returns:

> "The rejection is an ordinary tool result with `isError: true`, so the model reads the
> message and retries with arguments that fit the schema."

**Consequence for the tests:** `tests/server.integration.test.ts:74` (unknown tool) stays
`.rejects.toThrow`. But `:80` and `:86` (missing / wrong-type `datasetId`) must **flip** from
`.rejects.toThrow(...)` to resolving with `isError: true` and a message matching
`/datasetId is required/`. This is intentional: those two tests currently encode
non-conformant behaviour as the contract.

## Step 0 — Repair the worktree (blocking, do first)

**The target repository is `/home/sean/projects/mcp-server-abs`** — an absolute path, stated
here because the shell cwd drifts in this session (to `$CLAUDE_JOB_DIR/tmp` and `/home/sean`)
and `/home/sean` is itself inside the unrelated `claude-config` git repo. A review pass that
assumed cwd was the target concluded the plan pointed at the wrong codebase. Every command
below must name the path explicitly; never rely on the ambient cwd, and confirm
`git rev-parse --show-toplevel` resolves under `projects/mcp-server-abs` before any write.

The previous session's worktree was deleted mid-session; this session is still pinned to
that dead path, which makes the bash guard reject **any command containing the substring
"git"** (including `raw.githubusercontent.com` URLs).

1. `ExitWorktree` with `action: "keep"` (nothing on disk to remove).
2. `EnterWorktree` with `name: "mcp-v2-migration"`.
3. **Verify** the new worktree is under `/home/sean/projects/mcp-server-abs/.claude/worktrees/`
   and that `package.json` names `abs-mcp-server` — if not, stop.
4. Copy this plan to `.claude/plans/` in the repo (per CLAUDE.md).

Default `baseRef: fresh` branches from `origin/main`. **Verified safe**: `tests/`,
`src/services/`, and `agent_docs/mcp-protocol-changes.md` are all present on `origin/main`,
so the worktree gets the full codebase and `npm test` has something to run. The old
`worktree-mcp-protocol-research` branch is gone — the doc landed on `main`.

## Step 1 — Dependencies

`package.json`:
- **Remove** `@modelcontextprotocol/sdk` (`0.6.0`).
- **Add** to `dependencies`: `@modelcontextprotocol/server@2.0.0`.
- **Add** to `devDependencies`: `@modelcontextprotocol/client@2.0.0` (integration test only).
- `@modelcontextprotocol/core` is likely **not** needed directly — method strings replace the
  Zod schema constants. Confirm after install; add only if an import demands it.

Verified live on the registry: `server`/`client`/`core` are all `2.0.0` (`latest`),
`engines.node >= 20`. Local Node is **v22.22.3** — satisfied.

Run the official codemod as a **cross-check, not the primary mechanism**:
```bash
npx @modelcontextprotocol/codemod@latest v1-to-v2 .
```
It targets v1, but 0.6.0's `Server` / `setRequestHandler(Schema, …)` / import paths are
v1-shaped, so it should apply. With only 5 SDK imports total, review every hunk by hand.
**Commit codemod output separately** so the diff stays reviewable. It flags anything it
can't handle with `@mcp-codemod-error` comments — grep for those afterward.

## Step 2 — Tests first (per CLAUDE.md: verifiable goals)

Update `tests/server.integration.test.ts` **before** touching `src/`, watch it fail, then
make it pass.

- `:4-5` imports → `@modelcontextprotocol/client` and `@modelcontextprotocol/client/stdio`.
- `:50` uses `client.getServerVersion()` — **verify this still exists in v2** by grepping the
  installed `.d.ts` after install. If renamed, adjust; this is the one test line at real risk.
- **Add one assertion pinning the negotiated protocol version to `2025-11-25`.** This turns
  "we stayed on the legacy era" from a claim into a verifiable goal, and will fail loudly if
  someone later flips on the modern era by accident. Find the accessor on `Client` in the v2
  `.d.ts` rather than guessing. **Fallback:** if v2 exposes no protocol-version getter, omit
  the assertion rather than bolting on a raw JSON-RPC probe — it is not worth hand-rolling
  transport code for. In that case say so explicitly in the PR description, so its absence is
  a recorded finding rather than a requirement that quietly evaporated.
- **Flip `:80` and `:86`** from `.rejects.toThrow(/datasetId is required/)` to resolving with
  `isError: true` and content matching the same message (see scope decision). Leave `:74`
  (unknown tool) as `.rejects.toThrow`; optionally tighten it to assert the JSON-RPC code.
- **Add tests for the ABS-API-failure `isError` path — both branches.** These need a
  deterministic hook: `ABS_API_BASE` is a hardcoded const at `src/index.ts:11`, so the test
  cannot currently influence it, and relying on the real hostname failing to resolve would be
  environment-dependent. Change `:11` to
  `process.env.ABS_API_BASE ?? "https://api.data.abs.gov.au"` and pass `env` through
  `StdioClientTransport`. Then cover **both** failure branches the code has:
  1. **Transport failure** (`AxiosError` with no `response`): point the base URL at
     `http://127.0.0.1:1` — connection refused, instant, no network needed.
  2. **HTTP error response** (`AxiosError` *with* a `response`, e.g. 500): start a throwaway
     `node:http` server in `beforeAll` on an ephemeral port (`listen(0)`) that always replies
     `500`, point the base URL at it, and close it in `afterAll`. This is the branch at
     `src/index.ts:73-75`; without it the HTTP path is changed but never exercised.

  Both assert the call *resolves* with `isError: true` and a message naming the failure.
  These are separate `describe` blocks from the main suite, since each needs its own server
  process with different `env`. Follow the existing `helpers.ts` patterns for temp resources.
- **Add a success-path regression test.** The file's note at `:16-17` says the happy path is
  untested because the real hostname doesn't resolve — but the `ABS_API_BASE` hook removes
  that obstacle. Point it at the same local `node:http` server returning a small canned JSON
  body, and assert the call resolves with `isError` absent/false and the body echoed in
  `content[0].text`. Without this, nothing proves the migration kept the *working* path
  working — every other new test only covers failures.
- `:92-99` ("survives a rejected call") calls `query_dataset` with `{}`, which is now an
  `isError` result rather than a rejection — update its `.rejects.toThrow()` accordingly while
  keeping the follow-up `listTools()` assertion that the server is still serving.

## Step 3 — Migrate the server (`src/index.ts` → `src/index.ts` + `src/server.ts`)

The entire SDK surface is ~30 lines, all currently in `src/index.ts`. Line references below
are to the file as it stands today; the split into `src/server.ts` happens at the end of this
step. `src/services/`, `src/types/` and `src/utils/` import **no** SDK symbols and are untouched.

- `:3-4` imports → `@modelcontextprotocol/server` (`Server`) and
  `@modelcontextprotocol/server/stdio` (`StdioServerTransport`).
- `:5-8` — **delete**; the `ListToolsRequestSchema` / `CallToolRequestSchema` imports are
  replaced by method strings.
- `:20-26` — `capabilities: { tools: { list: true, call: true } }` → **`tools: {}`**.
  Per spec, `ServerCapabilities.tools` defines only `listChanged`; `list`/`call` are
  silently ignored today. (Research finding (a).)
- `:17` — **keep** `description`. It is a real `Implementation` field as of 2025-11-25, which
  is what v2 negotiates by default, so research finding (b) resolves itself with the upgrade.
- `:29` → `server.setRequestHandler('tools/list', async () => { … })`.
- `:50` → `server.setRequestHandler('tools/call', async (request, ctx) => { … })`.
  (`extra` → `ctx`; this handler doesn't currently use the second param.)
- `:11` — `ABS_API_BASE` becomes `process.env.ABS_API_BASE ?? "https://api.data.abs.gov.au"`
  so the API-failure path is testable (see Step 2).
- Errors per the scope decision:
  - `:55` unknown tool → throw `new ProtocolError(ProtocolErrorCode.InvalidParams, …)`
    (imported from `@modelcontextprotocol/server`).
  - `:59` invalid `datasetId` → return `{ content: [...], isError: true }`.
  - `:72-77` ABS failure → return `isError: true`, covering **both** branches: `AxiosError`
    *with* a `response` (HTTP 4xx/5xx) and *without* one (`ECONNREFUSED` / `ENOTFOUND`, which
    currently falls through `:76` into the catch-all). The connection-refused test exercises
    the second branch, so it must not be left throwing.
  - Drop the `:78-81` catch-all rethrow that flattens every error into one shape — but keep a
    narrow guard so a genuinely unexpected exception still surfaces rather than vanishing.

### Structural change: extract `buildServer()`
`tests/server.integration.test.ts:11-13` documents the problem: *"`src/index.ts` calls
`main()` at import time, so it cannot be unit tested."* Split into **`src/server.ts`**
(exporting `buildServer(): Server`) and **`src/index.ts`** (imports it, runs `main()`).
A separate file is cleaner than an ESM `import.meta.url` main-guard and keeps the
`package.json` `bin` entry pointing at the same path. Small, in scope, and it makes a future
modern-era switch a three-line change (`serveStdio(() => buildServer())`) instead of a rewrite.

## Step 4 — Config and docs

- `tsconfig.json`: `module`/`moduleResolution` are `Node16`, which resolves v2's exports map.
  The v2 README notes TS ≥6 needs `"types": ["node"]`; this repo is on TS 5.3, so likely a
  no-op — add it only if the build complains.
- `agent_docs/mcp-protocol-changes.md`: apply the three corrections listed in Context, and
  rewrite finding (c) as the two-mechanism split, quoting the spec's "Error Handling" section
  and the per-site table above. Note the SDK-convention evidence (v2 returns `isError` on
  input-schema failure), since that is what settles the ambiguous case.
- `README.md`: update if it names the SDK or protocol version.

## Verification

1. `npm run typecheck` — covers `src/` **and** `tests/` via `tsconfig.test.json`. Primary gate.
2. `npm test` — `pretest` builds first; the integration test spawns the real built server over
   stdio and speaks MCP to it. This is the real check: it exercises the actual handshake and
   would catch a broken transport or stdout contamination.
3. `grep -rn "@mcp-codemod-error" src tests` — must return nothing.
4. `grep -rn "@modelcontextprotocol/sdk" src tests package.json` — must return nothing.
5. `npm run inspector` — manual smoke test against MCP Inspector; confirm the tool lists and
   an error call renders sensibly.

Success = typecheck clean, all tests pass, no stale SDK references, and all three new tests
present and passing: connection-refused `isError`, HTTP-500 `isError`, and the success-path
regression (the only one proving the working path still works). The protocol-version pin is
**conditional** — required only if v2 exposes an accessor for it (see Step 2); if it does not,
record that in the PR description instead, so its absence is a deliberate documented outcome
rather than a silently dropped requirement.

## Out of scope

- The modern 2026-07-28 era (`serveStdio` / `createMcpHandler`) — `buildServer()` makes it cheap later.
- Wiring up `ABSApiClient` / `DataFlowService`, which exist but are unused by `index.ts`
  (pre-existing dead code — mention, don't delete).
- The two known parser bugs marked `it.fails()` in `tests/dataflow-extraction.test.ts`.
- Adding tools, HTTP transport, or auth.

## Commit plan

Small, reviewable commits on `mcp-v2-migration`, pushed to `origin` (never to `main`):
1. codemod output (isolated, if it produces anything usable)
2. deps + `src/index.ts` migration + `buildServer()` extraction
3. test updates (imports, flipped error tests, new `isError` + success-path tests)
4. doc corrections

Open a draft PR at the end. Its description **must** lead with the error-contract change
described in Context — invalid arguments and API failures now resolve with `isError: true`
instead of rejecting — and note whether the protocol-version pin was achievable.
