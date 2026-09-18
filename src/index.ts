#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { buildServer } from "./server.js";

async function main() {
  try {
    const transport = new StdioServerTransport();
    await buildServer().connect(transport);
    console.error("Server started successfully");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Server failed to start:", errorMessage);
    process.exit(1);
  }
}

main();
