import { ProtocolError, ProtocolErrorCode, Server } from '@modelcontextprotocol/server';
import axios, { AxiosError } from 'axios';

/**
 * Base URL of the ABS Data API.
 *
 * Note the host order: `data.api.abs.gov.au`, not `api.data.abs.gov.au`. The
 * transposed form does not resolve, and was what this tool requested until it
 * was corrected — see `ABSApiClient.ts`, which has always used the right one.
 *
 * Overridable through the environment so tests can point the server at a local
 * stub and exercise the upstream success and failure paths without network access.
 */
const ABS_API_BASE = process.env.ABS_API_BASE ?? 'https://data.api.abs.gov.au';

/** A tool execution error: the model can read the message and retry. */
function toolError(message: string) {
    return {
        content: [{ type: 'text' as const, text: message }],
        isError: true,
    };
}

/**
 * Builds the MCP server with its tool handlers registered.
 *
 * Kept separate from the process entry point so tests and any future transport
 * (for example `serveStdio(() => buildServer())`) can construct a server without
 * running `main()` as an import side effect.
 */
export function buildServer(): Server {
    const server = new Server(
        {
            name: 'abs-mcp-server',
            title: 'Australian Bureau of Statistics',
            version: '0.1.0',
            description: 'Access Australian Bureau of Statistics (ABS) data',
        },
        {
            capabilities: {
                tools: {},
            },
        }
    );

    server.setRequestHandler('tools/list', async () => {
        return {
            tools: [
                {
                    name: 'query_dataset',
                    title: 'Query ABS Dataset',
                    description: 'Query a specific ABS dataset with optional filters',
                    inputSchema: {
                        type: 'object',
                        required: ['datasetId'],
                        properties: {
                            datasetId: {
                                type: 'string',
                                description: 'ID of the dataset to query (e.g., C21_G01_LGA)',
                            },
                        },
                    },
                    // A read-only fetch against a third-party API: safe to retry, and
                    // its result depends on data outside this server's control.
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
                },
            ],
        };
    });

    server.setRequestHandler('tools/call', async (request) => {
        const { name, arguments: args } = request.params;

        // An unknown tool is a protocol error: no retry with different arguments
        // can fix it, so it belongs on the JSON-RPC error channel rather than in
        // an `isError` result the model would try to act on.
        if (name !== 'query_dataset') {
            throw new ProtocolError(ProtocolErrorCode.InvalidParams, `Unknown tool: ${name}`);
        }

        // Input validation is a tool execution error: the message tells the model
        // what to send instead, so it is returned rather than thrown.
        if (!args?.datasetId || typeof args.datasetId !== 'string') {
            return toolError('datasetId is required and must be a string');
        }

        // SDMX REST: `/rest/data/{flow}/{key}`. The `/data/...` form this used to
        // build returns 403 — the `/rest` prefix is not optional. The id is
        // encoded so a value containing `,` `?` or `#` stays one path segment
        // instead of injecting a query string.
        const datasetId = args.datasetId;
        const url = `${ABS_API_BASE}/rest/data/${encodeURIComponent(datasetId)}/all?format=json&dimensionAtObservation=AllDimensions`;

        try {
            const response = await axios.get(url);

            // The declared `outputSchema` promises `data` is an object, so a body
            // that parses to null, an array, or a scalar cannot be returned as a
            // success — it would violate the contract clients validate against.
            const data: unknown = response.data;
            if (data === null || typeof data !== 'object' || Array.isArray(data)) {
                return toolError(
                    `ABS API did not return a JSON object for ${datasetId}: received ${Array.isArray(data) ? 'an array' : typeof data}`
                );
            }

            const structuredContent = { datasetId, data, sourceUrl: url };
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify(structuredContent, null, 2),
                    },
                    {
                        type: 'resource_link',
                        uri: url,
                        name: datasetId,
                        mimeType: 'application/vnd.sdmx.data+json',
                    },
                ],
                structuredContent,
            };
        } catch (error) {
            // Upstream failures are tool execution errors too. Both axios branches
            // matter: an HTTP error status carries a `response`, while a transport
            // failure (ECONNREFUSED, ENOTFOUND, timeout) does not.
            if (error instanceof AxiosError) {
                if (error.response) {
                    return toolError(
                        `ABS API Error: ${error.response.status} - ${JSON.stringify(error.response.data)}`
                    );
                }
                return toolError(`ABS API request failed: ${error.code ?? error.message}`);
            }
            throw error;
        }
    });

    return server;
}
