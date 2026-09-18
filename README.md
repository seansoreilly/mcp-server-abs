# ABS MCP Server

An MCP (Model Context Protocol) server that provides access to the Australian Bureau of Statistics (ABS) Data API. This server allows AI assistants to query and analyze ABS statistical data through the SDMX-ML API.

## Features

The server currently exposes **one tool**:

- **`query_dataset`** — fetches an ABS dataset by id (e.g. `C21_G01_LGA`) and returns
  the SDMX-JSON payload as both text and `structuredContent`, with a `resource_link`
  to the upstream URL. Declares a `title`, read-only annotations, and an `outputSchema`.

Built on MCP protocol revision `2025-11-25` (SDK v2, legacy era) over stdio.

### Not yet exposed

`ABSApiClient` and `DataFlowService` implement dataset discovery, multi-format
support (JSON/CSV/XML), and on-disk caching with a configurable refresh interval.
They are fully tested but **not currently wired into the server**, so no tool
surfaces them yet — a `list_dataflows` tool is the natural next step. Treat the
section below as a description of the service layer, not of the tool surface.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `ABS_API_BASE` | `https://data.api.abs.gov.au` | ABS API origin; override to point at a stub |
| `ABS_LOG_LEVEL` | `debug` | Winston log level |
| `ABS_LOG_DIR` | `<cwd>/logs` | Directory for log files |
| `ABS_CACHE_FILE` | `<build>/../cache/dataflows.json` | Where the dataflow cache is written |
| `ABS_CACHE_REFRESH_HOURS` | `24` | How long a cached dataflow list stays fresh |
| `ABS_REQUEST_TIMEOUT_MS` | `30000` | Request timeout for ABS API calls |

The ABS Data API is open — the server needs **no API key or credentials**.

All logging goes to **stderr**, never stdout — stdout carries the MCP JSON-RPC channel.

## Installation

```bash
npm install
```

## Docker

A container image is published to GitHub Container Registry on every push to
`main`, tagged `latest`, `main`, `sha-<commit>`, and — for `v*` tags — the
semver version.

```bash
docker pull ghcr.io/seansoreilly/mcp-server-abs:latest
docker run -i --rm ghcr.io/seansoreilly/mcp-server-abs:latest
```

`-i` is required: the server speaks MCP over stdio, so stdin and stdout are the
transport. There is no port to publish and no HTTP endpoint to health-check.

The image runs as the unprivileged `node` user and writes its logs and dataflow
cache to `/data`. Mount a volume there to keep the cache across restarts:

```bash
docker run -i --rm -v abs-mcp-data:/data ghcr.io/seansoreilly/mcp-server-abs:latest
```

Every variable in [Configuration](#configuration) can be passed with `-e`; the
image presets `ABS_CACHE_FILE=/data/dataflows.json` and `ABS_LOG_DIR=/data/logs`.

```bash
docker run -i --rm -e ABS_LOG_LEVEL=info -e ABS_CACHE_REFRESH_HOURS=6 \
  ghcr.io/seansoreilly/mcp-server-abs:latest
```

To build locally instead of pulling:

```bash
docker build -t abs-mcp-server .
./scripts/smoke-test.sh abs-mcp-server   # drives an MCP initialize over stdio
```

### As a sidecar

Because the transport is stdio rather than a socket, an agent framework runs
the container as a child process and speaks to it over the pipe — it is not a
network service. In Kubernetes or Compose, a true sidecar needs a supervising
process that owns the pipes; the common case is a host process spawning
`docker run -i --rm ...` per session.

## Development

### Prerequisites

- Node.js 20 or higher (required by the MCP SDK v2 packages)
- npm 8 or higher

### Building

```bash
npm run build
```

### Running

```bash
npm start
```

### Development Tools

- `npm run build`: Build the TypeScript code
- `npm start`: Run the server
- `npm test`: Build, then run the test suite (Vitest)
- `npm run typecheck`: Typecheck both `src/` and `tests/`
- `npm run lint` / `npm run lint:fix`: Biome lint + format check
- `npm run inspector`: Run the MCP inspector for testing

## Project Structure

```
src/
├── index.ts                   # Process entry point: transport + main()
├── server.ts                  # buildServer(): tool registration and handlers
├── services/
│   └── abs/
│       ├── ABSApiClient.ts    # ABS API communication (not yet wired in)
│       └── DataFlowService.ts # Dataflow caching (not yet wired in)
├── types/
│   └── abs.ts                 # Type definitions, incl. the ABSError class
└── utils/
    └── logger.ts              # Winston config; all output to stderr
tests/                         # Vitest suite, incl. stdio integration tests
agent_docs/                    # Protocol research notes
```

## Implementation Details

### ABS API Client

The `ABSApiClient` class handles communication with the ABS Data API:
- Uses SDMX-ML format for data exchange
- Supports multiple response formats (JSON, CSV, XML)
- Implements proper error handling and logging
- Configurable timeouts and retries

### Data Flow Service

The `DataFlowService` class manages ABS data flows:
- Dynamically fetches available datasets from ABS API
- Implements caching with configurable refresh intervals
- Provides methods for querying specific datasets
- Handles data transformation and formatting

### Logging

Winston, configured for an stdio MCP server:
- **Every level writes to stderr.** stdout is the JSON-RPC channel, so a single
  log line there would corrupt the protocol.
- Structured JSON to rotating files under `ABS_LOG_DIR`; human-readable to the console
- Level and directory set via `ABS_LOG_LEVEL` / `ABS_LOG_DIR`

## Integration with Claude Desktop

Claude Desktop spawns the server itself, so point it at either the built entry
point or the container. Add one of these to `claude_desktop_config.json`, then
restart Claude Desktop — the ABS tools appear in the "Available MCP Tools"
window.

Local build (run `npm run build` first):

```json
{
  "mcpServers": {
    "abs": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-server-abs/build/index.js"]
    }
  }
}
```

Container:

```json
{
  "mcpServers": {
    "abs": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-v", "abs-mcp-data:/data",
        "ghcr.io/seansoreilly/mcp-server-abs:latest"
      ]
    }
  }
}
```

## API Documentation

For more information about the ABS Data API:
- [SDMX-ML Documentation](https://data.gov.au/dataset/ds-dga-b1bc6077-dadd-4f61-9f8c-002ab2cdff10/details)
- [ABS API Documentation](https://api.gov.au/service/f8880c48-2927-4e48-9945-46d36c8c4e11)

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

MIT License
