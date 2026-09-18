# MCP protocol changes since this server was written

**Researched:** 2026-09-18 · **Scope:** what changed between what `abs-mcp-server` implements today and the current MCP specification and TypeScript SDK.

This is a research note, not a change request. Nothing in the repo has been modified. Sources are listed at the bottom; every claim below was checked against the specification changelogs or the SDK source rather than recalled.

---

## 1. Baseline — what this repo implements today

| Aspect | Current state |
| --- | --- |
| SDK | `@modelcontextprotocol/sdk` pinned to `0.6.0` (published 2024-11-11) — `package.json:21` |
| Protocol revision | `2024-11-05` era (the revision current when 0.6.0 shipped) |
| API style | Low-level `Server` + `setRequestHandler(Schema, …)` — `src/index.ts:13`, `src/index.ts:29`, `src/index.ts:49` |
| Transport | stdio only, `server.connect(new StdioServerTransport())` — `src/index.ts:86-87` |
| Surface | One tool, `query_dataset`; no resources, prompts, sampling, or auth — `src/index.ts:32-47` |

The gap being described is roughly 22 months and **four** protocol revisions.

**Version landscape as of 2026-09-18:**

- `@modelcontextprotocol/sdk` (v1 line) — latest `1.30.0`
- `@modelcontextprotocol/server`, `/client`, `/core` (v2 line) — `2.0.0`, tagged `latest`
- Latest protocol revision — `2026-07-28`
- SDK `LATEST_PROTOCOL_VERSION` constant — `2025-11-25`; `SUPPORTED_PROTOCOL_VERSIONS` = `2025-11-25`, `2025-06-18`, `2025-03-26`, `2024-11-05`, `2024-10-07`

Note the deliberate asymmetry: `2026-07-28` is **not** in `SUPPORTED_PROTOCOL_VERSIONS`. That list is the *legacy* `initialize` list only. Modern revisions live in a separate internal list because, per the SDK source comment, "adding a revision here can never leak a modern version string into a 2025-era handshake."

---

## 2. The headline change: MCP now has two eras

This is the single most important thing to understand, and it postdates most written material about MCP.

The SDK now models the wire protocol as two **eras** (`packages/core-internal/src/shared/protocolEras.ts`):

- **legacy** — `2024-11-05` … `2025-11-25`. Version negotiated by the `initialize` handshake. This is what our server speaks.
- **modern** — `2026-07-28` and later. **There is no `initialize`.** Servers advertise versions via a `server/discover` RPC, and every request carries its own `_meta` envelope.

Era is determined by lexicographic date comparison against `FIRST_MODERN_PROTOCOL_VERSION = '2026-07-28'`.

The practical consequence for us: **`2026-07-28` is a stateless protocol.** The 2025-era mental model — connect, handshake once, hold session state, push notifications whenever you like — no longer applies in the modern era.

### What 2026-07-28 removed or replaced

| Removed / changed | Replacement | SEP |
| --- | --- | --- |
| `initialize` + `notifications/initialized` | Per-request `_meta` envelope carrying protocol version + client capabilities | SEP-2575 |
| Protocol-level sessions, `Mcp-Session-Id` header | Server-minted handles passed as ordinary tool arguments | SEP-2567 |
| `resources/subscribe` / `unsubscribe`, HTTP GET endpoint | `subscriptions/listen` — one long-lived POST-response stream, opt-in by type | SEP-2575 |
| `ping`, `logging/setLevel`, `notifications/roots/list_changed` | Log level set per-request via `_meta`; **servers MUST NOT emit `notifications/message` for requests that omit it** | SEP-2575 |
| Server-initiated requests (`roots/list`, `sampling/createMessage`, `elicitation/create`) | Multi Round-Trip Requests (MRTR): return `InputRequiredResult`, client retries with `inputResponses` | SEP-2322 |
| SSE stream resumability (`Last-Event-ID`, event IDs) | Gone — a broken stream loses the request; client re-issues with a new ID | SEP-2575 |
| Experimental tasks in core | Moved to an official extension `io.modelcontextprotocol/tasks` | SEP-2663 |

**New required fields.** Every result now carries `resultType` (`"complete"` or `"input_required"`). Clients MUST treat results from earlier-protocol servers that omit it as `"complete"` — which is why our server keeps working against newer clients. List and read results (`tools/list`, `resources/list`, `prompts/list`, `resources/read`, `resources/templates/list`) now require `ttlMs` and `cacheScope` via a `CacheableResult` interface (SEP-2549).

**Deprecated but still present (12-month minimum window, SEP-2577):** Roots, Sampling, and Logging. Suggested migrations: pass files via tool parameters or resource URIs instead of Roots; call LLM provider APIs directly instead of Sampling; log to `stderr` or use OpenTelemetry instead of Logging. Also deprecated: HTTP+SSE transport, and OAuth Dynamic Client Registration in favour of Client ID Metadata Documents.

**Good news for this repo:** we already log to `stderr` (`src/index.ts:88`, `src/utils/logger.ts`), which is the recommended post-deprecation pattern, and we use none of Roots, Sampling, or Logging capability.

---

## 3. Revision-by-revision, from our baseline

### 2025-03-26 (from 2024-11-05 — our baseline)

- **OAuth 2.1 authorization framework** added.
- **Streamable HTTP transport** replaced HTTP+SSE.
- **JSON-RPC batching** added.
- **Tool annotations** — describe whether a tool is read-only, destructive, idempotent.
- Schema: `message` on `ProgressNotification`; audio content type; `completions` capability.

### 2025-06-18

- **JSON-RPC batching removed** — added the previous revision, removed this one. Never rely on it.
- **Structured tool output** (`outputSchema` + `structuredContent`).
- **Elicitation** — servers can request additional information from the user mid-interaction.
- **Resource links** in tool results.
- MCP servers classified as **OAuth Resource Servers**; Resource Indicators (RFC 8707) required of clients.
- `MCP-Protocol-Version` header required on subsequent HTTP requests.
- `title` field added for human-friendly display names, so `name` stays a programmatic identifier.
- `_meta` extended to more interface types.

### 2025-11-25

- **Icons** for tools, resources, resource templates, and prompts (SEP-973).
- **Tool naming guidance** (SEP-986).
- URL-mode elicitation (SEP-1036); enum/elicitation schema overhaul (SEP-1330); default values for primitives (SEP-1034).
- Tool calling in sampling via `tools` / `toolChoice` (SEP-1577).
- Experimental **tasks** for durable requests (SEP-1686) — *note: redesigned and moved to an extension in the very next revision.*
- OAuth: OpenID Connect Discovery, incremental scope consent, Client ID Metadata Documents.
- **JSON Schema 2020-12 established as the default dialect** (SEP-1613).
- **Clarified** that input validation errors should be returned as Tool Execution Errors rather than Protocol Errors, so the model can self-correct (SEP-1303) — a clarification of existing behaviour, not a new mechanism. ← directly relevant to us, see §5.
- Optional `description` field added to the `Implementation` interface.
- Clarified that stdio servers may use stderr for all logging, not just errors.

### 2026-07-28

Covered in §2 above.

---

## 4. SDK changes: 0.6.0 → 1.30.0 → 2.0.0

The SDK has restructured twice since 0.6.0.

**v1 line (`@modelcontextprotocol/sdk`, currently 1.30.0).** Introduced the high-level `McpServer` class alongside the low-level `Server`, Streamable HTTP transports (stateful, stateless, and JSON-response modes), and OAuth support — confirmed against the published 1.30.0 README.

**v2 line (`@modelcontextprotocol/server` / `/client` / `/core`, 2.0.0, tagged `latest`).** The monolithic package is split into scoped packages. Per the package README: *"v2 is the stable release line, implementing the 2026-07-28 MCP spec."* Requires Node.js 20+. ESM-first but ships CommonJS too.

There is an official **codemod** for the v1→v2 move:

```bash
npx @modelcontextprotocol/codemod@latest v1-to-v2 .
```

Run it at the package root, not `./src` — it rewrites `package.json` too. It marks anything it cannot safely rewrite with `@mcp-codemod-error` comments.

Renames and reshapes relevant to code of our shape:

| v1 | v2 |
| --- | --- |
| `setRequestHandler(ListToolsRequestSchema, …)` | `setRequestHandler('tools/list', …)` — method string, not Zod schema |
| `extra` (second handler param, `RequestHandlerExtra`) | `ctx` (`ServerContext`) — `extra.signal` → `ctx.mcpReq.signal`, `extra.requestId` → `ctx.mcpReq.id`, `extra.authInfo` → `ctx.http?.authInfo` |
| `.tool()` / `.prompt()` / `.resource()` variadic | `registerTool` / `registerPrompt` / `registerResource` with a config object |
| raw Zod shapes for `inputSchema` | wrapped in `z.object(...)` — Standard Schema |
| `McpError` | `ProtocolError` |
| `ErrorCode` | `ProtocolErrorCode` (+ `SdkErrorCode` for local-only members) |
| `StreamableHTTPError` | `SdkHttpError` |
| `IsomorphicHeaders` | Web-standard `Headers` — note `.get()`/`.set()`, not bracket access |

**Crucial subtlety for a stdio server like ours.** Upgrading the SDK does **not** by itself change a byte on the wire:

> "Nothing in v2 puts a 2026-07-28 byte on the wire by default: a hand-constructed `Client` / `Server` / `McpServer` keeps speaking the 2025-era protocol it was written for."

And specifically:

> "A hand-constructed `Server`/`McpServer` connected directly to a `StdioServerTransport` serves only the 2025-era protocol — upgrading the SDK changes nothing about what it puts on the wire."

Serving 2026-07-28 over stdio is an explicit opt-in: replace `await server.connect(new StdioServerTransport())` with `serveStdio(() => buildServer())` from `@modelcontextprotocol/server/stdio`. One factory instance is pinned per connection, and the opening exchange selects the era. `{ legacy: 'reject' }` refuses 2025-era openings. Over HTTP the equivalent entry point is `createMcpHandler`.

On a 2026-pinned connection, `getClientCapabilities()` and `getClientVersion()` return `undefined` — no `initialize` ever runs — and handlers read per-request identity from `ctx.mcpReq.envelope`.

---

## 5. Impact on this repo

Two pre-existing issues surfaced while checking the baseline against the spec. **Both are noted, not fixed** — no code was changed.

**a) The declared capabilities shape is not a spec shape.** `src/index.ts:20-26` declares:

```
capabilities: { tools: { list: true, call: true } }
```

The specification's `ServerCapabilities.tools` defines only `listChanged?: boolean` — verified against the official `schema/2025-11-25/schema.ts`, and this has been true in every revision including our `2024-11-05` baseline. `list` and `call` are not spec fields; they are silently ignored. The correct declaration for a server with a static tool list is `tools: {}`. This is currently harmless — tool listing and calling work because the handlers are registered, not because of these flags — but it would mislead anyone reading it as the source of truth.

**b) `description` on the server info object.** `src/index.ts:17` passes `description` in the `Implementation` object. That field was only added to the spec in **2025-11-25** (minor change #2), so under our `2024-11-05` baseline it is not a spec field. What a 2024-era client does with it is client-dependent — this was not verified against a live client, and no behaviour should be assumed either way. It becomes legitimate once the SDK is upgraded; no change needed now.

**c) Error handling is the wrong shape for modern clients.** `src/index.ts:50-95` throws on bad input (`"datasetId is required and must be a string"`) and on ABS API failures, which surfaces as a **protocol error**. Input validation failures should instead be returned as **tool execution errors** — `{ content: [...], isError: true }` — precisely so the model can read the message and self-correct. Note the mechanism is not new: `isError` on `CallToolResult` predates our baseline. 2025-11-25 merely *clarified* that validation errors belong there rather than in protocol errors (SEP-1303), so this was always available to us. As written, a model that calls `query_dataset` with a bad `datasetId` gets a protocol-level failure it cannot recover from gracefully. This is the highest-value behavioural fix available, and it is independent of any SDK upgrade.

### Things we'd gain, roughly in value order

1. **Tool execution errors over thrown protocol errors** (above) — works on the current SDK, biggest practical win for model behaviour.
2. **`outputSchema` + `structuredContent`** (2025-06-18) — we currently return `JSON.stringify(response.data, null, 2)` as a text blob (`src/index.ts:66-70`). ABS SDMX-JSON responses are large and deeply nested; a declared output schema would let clients consume them structurally instead of re-parsing text.
3. **Tool annotations** (2025-03-26) — `query_dataset` is read-only and idempotent; annotating it says so to clients that gate on destructiveness.
4. **`title`** (2025-06-18) — a human-readable display name distinct from the programmatic `name`.
5. **Resource links** (2025-06-18) — ABS dataflows are a natural fit for resources; the repo already has a `DataFlowService` and a 3.5 MB `dataflows.xml`.
6. **Streamable HTTP** — only if this ever needs to be anything other than a local stdio server. No reason to take it on otherwise.

### Upgrade paths

- **Do nothing.** The server keeps working. The 2025 era is not removed, and `2024-11-05` remains in `SUPPORTED_PROTOCOL_VERSIONS`. `resultType` omission is explicitly handled by clients. Lowest risk, and nothing forces our hand yet.
- **Minimal (recommended first step).** Stay on the low-level `Server`, move to SDK v1 `1.30.0`, fix the capabilities shape, convert throws to `isError` tool results, add annotations, `title`, and `outputSchema`. Meaningful client-visible improvement, small blast radius, no era change.
- **Full v2.** Run the codemod, move to `@modelcontextprotocol/server` 2.0.0, and opt into 2026-07-28 via `serveStdio(() => buildServer())`. Requires Node 20+ and a deliberate switch from a module-scope singleton server (`src/index.ts:13`) to a per-connection factory. Worth doing when there's a reason to speak the modern era — not before.

A note on ordering: the minimal path is a strict subset of the work the full path needs anyway, so doing it first costs nothing in rework.

---

## 6. Sources

All fetched or queried 2026-09-18.

**Specification changelogs** (primary source for §3):

- 2026-07-28 — https://modelcontextprotocol.io/specification/2026-07-28/changelog
- 2025-11-25 — https://modelcontextprotocol.io/specification/2025-11-25/changelog
- 2025-06-18 — https://modelcontextprotocol.io/specification/2025-06-18/changelog
- 2025-03-26 — https://modelcontextprotocol.io/specification/2025-03-26/changelog

**Schema** (used to verify the `ServerCapabilities` shape in §5a):

- `schema/2025-11-25/schema.ts` — https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/schema/2025-11-25/schema.ts

**TypeScript SDK** (source of truth for §2 and §4):

- `packages/core/src/constants.ts` — protocol version constants and reserved `_meta` keys
- `packages/core-internal/src/shared/protocolEras.ts` — the legacy/modern era split
- `packages/server/README.md` — v2 stable-line statement
- `docs/migration/upgrade-to-v2.md` — v1→v2 migration guide and codemod
- `docs/migration/support-2026-07-28.md` — adopting the modern era, `serveStdio`, era behaviour matrix
- `docs/protocol-versions.md` — era comparison table

**Registry:**

- `npm view @modelcontextprotocol/sdk version` → `1.30.0`
- `npm view @modelcontextprotocol/server version` → `2.0.0`
- `npm view @modelcontextprotocol/sdk@1.30.0 readme` — used to verify the v1-line feature claims in §4

### A caveat on freshness

MCP has shipped four protocol revisions in 22 months, and one feature (JSON-RPC batching) was added and removed within two of them. Treat any dated summary — this one included — as a snapshot. Re-check `packages/core/src/constants.ts` and the changelog index before acting on it.
