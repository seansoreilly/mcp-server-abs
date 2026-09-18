import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import fs from 'fs/promises';
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { Client } from "@modelcontextprotocol/client";
import { repoRoot } from './helpers.js';

/**
 * Black-box MCP protocol tests.
 *
 * `src/index.ts` calls `main()` at import time, so it cannot be unit tested.
 * Instead we spawn the built server exactly as a host would and speak MCP to it
 * over stdio. This also guards the stdio contract itself: if anything ever logs
 * to stdout, the JSON-RPC channel breaks and these tests fail.
 *
 * The happy path of `query_dataset` is deliberately not tested — it calls a
 * hostname that does not resolve, so a passing network test would be a lie.
 */

const serverEntry = path.join(repoRoot, 'build', 'index.js');

let client: Client;
let transport: StdioClientTransport;

describe('MCP server (stdio)', () => {
    beforeAll(async () => {
        await expect(
            fs.access(serverEntry),
            'build/index.js is missing — run `npm run build` first (the test script does this for you)'
        ).resolves.toBeUndefined();

        transport = new StdioClientTransport({
            command: process.execPath,
            args: [serverEntry],
        });
        client = new Client(
            { name: 'abs-mcp-test-client', version: '0.0.0' },
            { capabilities: {} }
        );
        await client.connect(transport);
    });

    afterAll(async () => {
        await client?.close();
    });

    it('completes the initialize handshake over stdio', () => {
        // `connect()` resolving means initialize succeeded and stdout carried
        // clean JSON-RPC with no log-line contamination.
        expect(client.getServerVersion()).toMatchObject({ name: 'abs-mcp-server' });
    });

    it('advertises exactly one tool: query_dataset', async () => {
        const { tools } = await client.listTools();

        expect(tools.map((tool) => tool.name)).toEqual(['query_dataset']);
    });

    it('describes the query_dataset input schema', async () => {
        const { tools } = await client.listTools();
        const tool = tools[0];

        expect(tool.description).toContain('ABS dataset');
        expect(tool.inputSchema).toMatchObject({
            type: 'object',
            required: ['datasetId'],
        });
        const properties = tool.inputSchema.properties as {
            datasetId?: { type?: string };
        };
        expect(properties.datasetId?.type).toBe('string');
    });

    it('rejects an unknown tool name', async () => {
        await expect(
            client.callTool({ name: 'no_such_tool', arguments: {} })
        ).rejects.toThrow(/Unknown tool/);
    });

    it('rejects a call with no datasetId', async () => {
        await expect(
            client.callTool({ name: 'query_dataset', arguments: {} })
        ).rejects.toThrow(/datasetId is required/);
    });

    it('rejects a datasetId of the wrong type', async () => {
        await expect(
            client.callTool({ name: 'query_dataset', arguments: { datasetId: 42 } })
        ).rejects.toThrow(/datasetId is required and must be a string/);
    });

    it('survives a rejected call and keeps serving requests', async () => {
        await expect(
            client.callTool({ name: 'query_dataset', arguments: {} })
        ).rejects.toThrow();

        const { tools } = await client.listTools();
        expect(tools).toHaveLength(1);
    });
});
