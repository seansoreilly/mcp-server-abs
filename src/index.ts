#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { Server } from "@modelcontextprotocol/server";
import axios, { AxiosError } from "axios";

const ABS_API_BASE = "https://api.data.abs.gov.au";

const server = new Server(
  {
    name: "abs-mcp-server",
    version: "0.1.0",
    description: "Access Australian Bureau of Statistics (ABS) data"
  },
  {
    capabilities: {
      tools: {
        list: true,
        call: true
      }
    }
  }
);

server.setRequestHandler('tools/list', async () => {
  return {
    tools: [
      {
        name: "query_dataset",
        description: "Query a specific ABS dataset with optional filters",
        inputSchema: {
          type: "object",
          required: ["datasetId"],
          properties: {
            datasetId: {
              type: "string",
              description: "ID of the dataset to query (e.g., C21_G01_LGA)"
            }
          }
        }
      }
    ]
  };
});

server.setRequestHandler('tools/call', async (request) => {
  try {
    const { name, arguments: args } = request.params;

    if (name !== "query_dataset") {
      throw new Error(`Unknown tool: ${name}`);
    }

    if (!args?.datasetId || typeof args.datasetId !== "string") {
      throw new Error("datasetId is required and must be a string");
    }

    const url = `${ABS_API_BASE}/data/${args.datasetId}/all?format=json&dimensionAtObservation=AllDimensions`;
    
    try {
      const response = await axios.get(url);
      return {
        content: [{
          type: "text",
          text: JSON.stringify(response.data, null, 2)
        }]
      };
    } catch (error) {
      if (error instanceof AxiosError && error.response) {
        throw new Error(`ABS API Error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
      }
      throw error;
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Error querying dataset: ${errorMessage}`);
  }
});

async function main() {
  try {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Server started successfully");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Server failed to start:", errorMessage);
    process.exit(1);
  }
}

main();