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

All logging goes to **stderr**, never stdout — stdout carries the MCP JSON-RPC channel.

## Installation

```bash
npm install
```

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

1. Close Claude Desktop if it's running
2. Start the ABS MCP server: `npm start`
3. Start Claude Desktop
4. The ABS tools should appear in the "Available MCP Tools" window

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
