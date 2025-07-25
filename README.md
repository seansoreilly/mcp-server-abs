# ABS MCP Server

An MCP (Model Context Protocol) server that provides access to the Australian Bureau of Statistics (ABS) Data API. This server allows AI assistants to query and analyze ABS statistical data.

<a href="https://glama.ai/mcp/servers/@seansoreilly/mcp-server-abs">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/@seansoreilly/mcp-server-abs/badge" alt="ABS Server MCP server" />
</a>

## Features

- Query ABS datasets with optional filters
- List available datasets and their metadata
- Support for JSON and CSV response formats
- Built on the MCP protocol for seamless integration with AI assistants

## Available Datasets

Currently supports the following datasets:

- `ABS_ANNUAL_ERP_LGA2023`: Regional Population by Local Government Area (2023)
- `ABS_C21_T01_LGA`: 2021 Census, Selected Person Characteristics by Local Government Area
- `ABS_REGIONAL_ASGS2016`: Regional Statistics by Statistical Area Level 2 (SA2)

## Installation

```bash
npm install
```

## Development

### Prerequisites

- Node.js 18 or higher
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
- `npm run inspector`: Run the MCP inspector for testing

### For Developers

#### Project Structure

- `src/index.ts`: Main server implementation
- `package.json`: Project configuration and dependencies
- `tsconfig.json`: TypeScript configuration

#### Available Tools

1. `query_dataset`
   - Purpose: Query a specific ABS dataset with optional filters
   - Parameters:
     - `datasetId` (required): ID of the dataset to query
     - `dimensions` (optional): Dimension filters as key-value pairs
     - `format` (optional): Response format ("json" or "csv")

2. `list_datasets`
   - Purpose: List available ABS datasets and their metadata
   - Parameters: None

#### Adding New Datasets

To add support for new datasets:

1. Add the dataset metadata to the `KNOWN_DATASETS` array in `src/index.ts`:
   ```typescript
   {
     id: "DATASET_ID",
     title: "Dataset Title",
     description: "Dataset Description"
   }
   ```

#### Error Handling

The server implements comprehensive error handling:
- API request errors are caught and formatted with descriptive messages
- Uncaught exceptions and unhandled rejections are logged and terminate the process
- Debug logging can be enabled/disabled via the `debug` flag

## Integration with Claude Desktop

1. Close Claude Desktop if it's running
2. Start the ABS MCP server: `npm start`
3. Start Claude Desktop
4. The ABS tools should appear in the "Available MCP Tools" window

## API Documentation

For more information about the ABS Data API:
- [ABS Data API Documentation](https://api.data.abs.gov.au/data/help)

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

MIT License