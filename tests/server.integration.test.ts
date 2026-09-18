import fs from 'node:fs/promises';
import path from 'node:path';
import type { CallToolResult } from '@modelcontextprotocol/client';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { repoRoot, type StubAbsApi, startStubAbsApi, UNREACHABLE_API_BASE } from './helpers.js';

/**
 * Black-box MCP protocol tests.
 *
 * `src/index.ts` runs `main()` at import time, so it cannot be imported into a
 * test. Instead we spawn the built server exactly as a host would and speak MCP
 * to it over stdio. This also guards the stdio contract itself: if anything ever
 * logs to stdout, the JSON-RPC channel breaks and these tests fail.
 *
 * The server reads `ABS_API_BASE` from its environment, so the suites below
 * point it at a local stub rather than the real ABS API — that keeps the
 * upstream success and failure paths deterministic and offline.
 */

const serverEntry = path.join(repoRoot, 'build', 'index.js');

/** Spawns the built server with `env` applied and returns a connected client. */
async function connectServer(env: Record<string, string> = {}): Promise<{
    client: Client;
    close: () => Promise<void>;
}> {
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [serverEntry],
        env: { ...process.env, ...env } as Record<string, string>,
    });
    const client = new Client(
        { name: 'abs-mcp-test-client', version: '0.0.0' },
        { capabilities: {} }
    );
    await client.connect(transport);

    return { client, close: () => client.close() };
}

/** `callTool` types its result loosely; the suites below assert on tool results. */
async function callTool(
    client: Client,
    name: string,
    args: Record<string, unknown>
): Promise<CallToolResult> {
    return (await client.callTool({ name, arguments: args })) as CallToolResult;
}

/** Concatenates the text blocks of a tool result for message assertions. */
function resultText(result: CallToolResult): string {
    return result.content
        .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
        .map((block) => block.text)
        .join('\n');
}

/** The shape `query_dataset` declares in its `outputSchema`. */
interface QueryDatasetOutput {
    datasetId: string;
    data: unknown;
    sourceUrl: string;
}

/** `structuredContent` is typed as an open record; narrow it to the contract. */
function structured(result: CallToolResult): QueryDatasetOutput | undefined {
    return result.structuredContent as QueryDatasetOutput | undefined;
}

describe('MCP server (stdio)', () => {
    let client: Client;
    let close: () => Promise<void>;

    beforeAll(async () => {
        await expect(
            fs.access(serverEntry),
            'build/index.js is missing — run `npm run build` first (the test script does this for you)'
        ).resolves.toBeUndefined();

        ({ client, close } = await connectServer());
    });

    afterAll(async () => {
        await close?.();
    });

    it('completes the initialize handshake over stdio', () => {
        // `connect()` resolving means initialize succeeded and stdout carried
        // clean JSON-RPC with no log-line contamination.
        expect(client.getServerVersion()).toMatchObject({ name: 'abs-mcp-server' });
    });

    it('serves the legacy protocol era, not 2026-07-28', () => {
        // The v2 SDK speaks the 2025-era protocol unless a server explicitly
        // opts in via `serveStdio()` / `createMcpHandler()`. This pins that
        // choice: it fails loudly if anyone later flips on the modern era,
        // which would drop the `initialize` handshake these tests rely on.
        expect(client.getProtocolEra()).toBe('legacy');
        expect(client.getNegotiatedProtocolVersion()).toBe('2025-11-25');
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

    it('advertises a title, read-only annotations, and a structured output contract', async () => {
        const { tools } = await client.listTools();
        expect(client.getServerVersion()?.title).toBe('Australian Bureau of Statistics');
        expect(tools[0]).toMatchObject({
            title: 'Query ABS Dataset',
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: true,
            },
            outputSchema: {
                type: 'object',
                required: ['datasetId', 'data', 'sourceUrl'],
                additionalProperties: false,
                properties: {
                    datasetId: { type: 'string' },
                    data: { type: 'object' },
                    sourceUrl: { type: 'string', format: 'uri' },
                },
            },
        });
    });

    it('rejects an unknown tool name as a protocol error', async () => {
        // Per the tools spec, an unknown tool is a *protocol* error: the model
        // cannot fix it by retrying with different arguments, so it surfaces as
        // a rejected JSON-RPC call rather than an `isError` result.
        await expect(client.callTool({ name: 'no_such_tool', arguments: {} })).rejects.toThrow(
            /Unknown tool/
        );
    });

    it('reports a missing datasetId as a tool execution error', async () => {
        // Input validation is a *tool execution* error: it resolves with
        // `isError: true` so the model can read the message and self-correct.
        const result = await callTool(client, 'query_dataset', {});

        expect(result.isError).toBe(true);
        expect(resultText(result)).toMatch(/datasetId is required/);
    });

    it('reports a datasetId of the wrong type as a tool execution error', async () => {
        const result = await callTool(client, 'query_dataset', { datasetId: 42 });

        expect(result.isError).toBe(true);
        expect(resultText(result)).toMatch(/datasetId is required and must be a string/);
    });

    it('survives a failed call and keeps serving requests', async () => {
        const result = await callTool(client, 'query_dataset', {});
        expect(result.isError).toBe(true);

        const { tools } = await client.listTools();
        expect(tools).toHaveLength(1);
    });
});

describe('MCP server (upstream ABS API unreachable)', () => {
    let client: Client;
    let close: () => Promise<void>;

    beforeAll(async () => {
        ({ client, close } = await connectServer({
            ABS_API_BASE: UNREACHABLE_API_BASE,
        }));
    });

    afterAll(async () => {
        await close?.();
    });

    it('reports a connection failure as a tool execution error', async () => {
        // ECONNREFUSED produces an AxiosError with no `response`, a different
        // branch from an HTTP error status. Both must surface as `isError`.
        const result = await callTool(client, 'query_dataset', {
            datasetId: 'C21_G01_LGA',
        });

        expect(result.isError).toBe(true);
        expect(resultText(result)).toMatch(/ECONNREFUSED|ABS API/i);
    });
});

describe('MCP server (upstream ABS API returns 500)', () => {
    let stub: StubAbsApi;
    let client: Client;
    let close: () => Promise<void>;

    beforeAll(async () => {
        stub = await startStubAbsApi((_req, res) => {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ message: 'upstream exploded' }));
        });
        ({ client, close } = await connectServer({ ABS_API_BASE: stub.baseUrl }));
    });

    afterAll(async () => {
        await close?.();
        await stub?.close();
    });

    it('reports an HTTP error status as a tool execution error', async () => {
        // An AxiosError *with* a `response` — the other upstream branch.
        const result = await callTool(client, 'query_dataset', {
            datasetId: 'C21_G01_LGA',
        });

        expect(result.isError).toBe(true);
        expect(resultText(result)).toMatch(/500/);
    });
});

describe('MCP server (upstream ABS API succeeds)', () => {
    const payload = { data: { dataSets: [{ series: {} }] } };
    let stub: StubAbsApi;
    let client: Client;
    let close: () => Promise<void>;
    let requestedPaths: string[];

    beforeAll(async () => {
        requestedPaths = [];
        stub = await startStubAbsApi((req, res) => {
            requestedPaths.push(req.url ?? '');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(payload));
        });
        ({ client, close } = await connectServer({ ABS_API_BASE: stub.baseUrl }));
    });

    afterAll(async () => {
        await close?.();
        await stub?.close();
    });

    it('returns the dataset payload as a successful tool result', async () => {
        // The only test that proves the *working* path still works — every
        // other case here exercises a failure mode.
        const result = await callTool(client, 'query_dataset', {
            datasetId: 'C21_G01_LGA',
        });

        expect(result.isError).toBeFalsy();
        expect(result.structuredContent).toEqual({
            datasetId: 'C21_G01_LGA',
            data: payload,
            sourceUrl: `${stub.baseUrl}/rest/data/C21_G01_LGA/all?format=json&dimensionAtObservation=AllDimensions`,
        });
        expect(JSON.parse(resultText(result))).toEqual(result.structuredContent);
    });

    it('links to the same upstream dataset as the structured result', async () => {
        const result = await callTool(client, 'query_dataset', { datasetId: 'C21_G01_LGA' });
        expect(result.content.find((block) => block.type === 'resource_link')).toMatchObject({
            type: 'resource_link',
            name: 'C21_G01_LGA',
            uri: structured(result)?.sourceUrl,
            mimeType: 'application/vnd.sdmx.data+json',
        });
    });

    it('encodes dataset IDs as a single path segment', async () => {
        await callTool(client, 'query_dataset', { datasetId: 'ABS,TEST,1.0?x=y#z' });
        expect(requestedPaths.at(-1)).toBe(
            '/rest/data/ABS%2CTEST%2C1.0%3Fx%3Dy%23z/all?format=json&dimensionAtObservation=AllDimensions'
        );
    });

    it('requests the dataset by id', async () => {
        await callTool(client, 'query_dataset', { datasetId: 'C21_G01_LGA' });

        expect(requestedPaths.some((url) => url.includes('C21_G01_LGA'))).toBe(true);
    });

    it('requests the SDMX data path the ABS API actually serves', async () => {
        // The ABS endpoint is `/rest/data/{flow}/{key}` — verified live:
        // `/rest/data/ABORIGINAL_POP_PROJ/all` returns 200, while the
        // `/data/...` form this tool used to build returns 403. Asserted here
        // because the stub answers any path, so nothing else would catch it.
        await callTool(client, 'query_dataset', { datasetId: 'C21_G01_LGA' });

        expect(requestedPaths.at(-1)).toMatch(/^\/rest\/data\/C21_G01_LGA\/all\?/);
    });
});

describe('MCP server (invalid upstream JSON shape)', () => {
    it.each(['null', '[]', '42', '"text"', '<html>upstream error</html>'])(
        'returns a tool error for %s without structured success data',
        async (body) => {
            const stub = await startStubAbsApi((_req, res) => {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(body);
            });
            const { client, close } = await connectServer({ ABS_API_BASE: stub.baseUrl });
            try {
                await client.listTools();
                const result = await callTool(client, 'query_dataset', { datasetId: 'TEST' });
                expect(result.isError).toBe(true);
                expect(result.structuredContent).toBeUndefined();
                expect(resultText(result)).toContain('JSON object');
            } finally {
                await close();
                await stub.close();
            }
        }
    );
});
