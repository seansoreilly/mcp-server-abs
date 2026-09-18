import type { ListToolsResult } from '@modelcontextprotocol/server';
import { ProtocolError, ProtocolErrorCode, Server } from '@modelcontextprotocol/server';
import axios, { AxiosError } from 'axios';
import { ABS_API_BASE, ABS_CACHE_FILE, ABS_CACHE_REFRESH_HOURS } from './config.js';
import { DataFlowService } from './services/abs/DataFlowService.js';

/** A tool execution error: the model can read the message and retry. */
function toolError(message: string) {
    return {
        content: [{ type: 'text' as const, text: message }],
        isError: true,
    };
}

/**
 * Built on first use, then shared: `DataFlowService` holds an in-memory cache
 * on top of its on-disk one, so a per-call instance would refetch every time.
 */
let dataFlowService: DataFlowService | undefined;

function getDataFlowService(): DataFlowService {
    dataFlowService ??= new DataFlowService(ABS_CACHE_FILE, ABS_CACHE_REFRESH_HOURS);
    return dataFlowService;
}

/** Handler for `list_dataflows`. */
async function listDataflows(limit: unknown) {
    if (
        limit !== undefined &&
        (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1)
    ) {
        return toolError('limit must be a positive integer when provided');
    }

    try {
        const flows = await getDataFlowService().getDataFlows();
        const structuredContent = {
            // The full total, so a caller can tell a truncated list from a short one.
            count: flows.length,
            dataflows: limit === undefined ? flows : flows.slice(0, limit),
        };
        return {
            content: [{ type: 'text' as const, text: JSON.stringify(structuredContent, null, 2) }],
            structuredContent,
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return toolError(`Could not list ABS dataflows: ${message}`);
    }
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
        // Annotated so TypeScript checks each entry against the spec's Tool
        // type individually. Without it the two literals are unified and each
        // picks up the other's schema keys as `undefined`, which the index
        // signature rejects.
        const tools: ListToolsResult['tools'] = [
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
            {
                name: 'list_dataflows',
                title: 'List ABS Dataflows',
                description:
                    'List the available ABS dataflows. Use this to discover a valid datasetId to pass to query_dataset.',
                inputSchema: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        limit: {
                            type: 'integer',
                            minimum: 1,
                            description:
                                'Maximum number of dataflows to return. The reported count is always the full total.',
                        },
                    },
                },
                annotations: {
                    readOnlyHint: true,
                    destructiveHint: false,
                    idempotentHint: true,
                    openWorldHint: true,
                },
                outputSchema: {
                    type: 'object',
                    required: ['count', 'dataflows'],
                    additionalProperties: false,
                    properties: {
                        count: {
                            type: 'integer',
                            description: 'Total dataflows available, before any limit.',
                        },
                        dataflows: {
                            type: 'array',
                            items: {
                                type: 'object',
                                required: ['id', 'agencyID', 'version', 'name'],
                                properties: {
                                    id: { type: 'string' },
                                    agencyID: { type: 'string' },
                                    version: { type: 'string' },
                                    name: { type: 'string' },
                                    description: { type: 'string' },
                                },
                            },
                        },
                    },
                },
            },
        ];
        return { tools };
    });

    server.setRequestHandler('tools/call', async (request) => {
        const { name, arguments: args } = request.params;

        // An unknown tool is a protocol error: no retry with different arguments
        // can fix it, so it belongs on the JSON-RPC error channel rather than in
        // an `isError` result the model would try to act on.
        if (name !== 'query_dataset' && name !== 'list_dataflows') {
            throw new ProtocolError(ProtocolErrorCode.InvalidParams, `Unknown tool: ${name}`);
        }

        if (name === 'list_dataflows') {
            return listDataflows(args?.limit);
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
