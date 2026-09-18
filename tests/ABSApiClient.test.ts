import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AxiosRequestConfig } from 'axios';
import { createMockLogger } from './helpers.js';

const mockLogger = createMockLogger();
vi.mock('../src/utils/logger.js', () => ({ default: mockLogger }));

type SuccessHandler = (response: unknown) => unknown;
type ErrorHandler = (error: unknown) => unknown;

interface AxiosStub {
    get: ReturnType<typeof vi.fn>;
    interceptors: {
        response: { use: ReturnType<typeof vi.fn> };
    };
}

const createConfig = vi.fn();
const axiosStub: AxiosStub = {
    get: vi.fn(),
    interceptors: { response: { use: vi.fn() } },
};
let isAxiosErrorResult = true;

vi.mock('axios', () => {
    const create = (config: unknown): AxiosStub => {
        createConfig(config);
        return axiosStub;
    };
    return {
        default: {
            create,
            isAxiosError: (): boolean => isAxiosErrorResult,
        },
        isAxiosError: (): boolean => isAxiosErrorResult,
    };
});

const { ABSApiClient } = await import('../src/services/abs/ABSApiClient.js');

/** Reads the `config` argument of the most recent `api.get(url, config)` call. */
function lastRequestConfig(): AxiosRequestConfig {
    const call = axiosStub.get.mock.calls.at(-1);
    return (call?.[1] ?? {}) as AxiosRequestConfig;
}

function lastRequestUrl(): string {
    const call = axiosStub.get.mock.calls.at(-1);
    return String(call?.[0]);
}

describe('ABSApiClient', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        isAxiosErrorResult = true;
        axiosStub.get.mockResolvedValue({ data: '<root />', status: 200, config: {} });
    });

    describe('construction', () => {
        it('targets the base URL that actually resolves', () => {
            new ABSApiClient();

            // `https://data.api.abs.gov.au` returns 200; the transposed
            // `https://api.data.abs.gov.au` used by index.ts fails DNS.
            expect(createConfig).toHaveBeenCalledWith(
                expect.objectContaining({ baseURL: 'https://data.api.abs.gov.au' })
            );
        });

        it('applies a request timeout and an XML Accept default', () => {
            new ABSApiClient();

            expect(createConfig).toHaveBeenCalledWith(
                expect.objectContaining({
                    timeout: 30000,
                    headers: { Accept: 'application/xml' },
                })
            );
        });

        it('registers a response interceptor', () => {
            new ABSApiClient();

            expect(axiosStub.interceptors.response.use).toHaveBeenCalledTimes(1);
        });
    });

    describe('getDataFlows', () => {
        it('requests the /rest/dataflow path', async () => {
            const client = new ABSApiClient();
            await client.getDataFlows();

            expect(lastRequestUrl()).toBe('/rest/dataflow');
        });

        it('negotiates the SDMX 2.1 structure media type', async () => {
            const client = new ABSApiClient();
            await client.getDataFlows();

            expect(lastRequestConfig().headers).toEqual({
                Accept: 'application/vnd.sdmx.structure+xml;version=2.1',
            });
        });

        it('returns parsed XML rather than the raw body', async () => {
            axiosStub.get.mockResolvedValue({ data: '<a><b>hello</b></a>', config: {} });
            const client = new ABSApiClient();

            const result = (await client.getDataFlows()) as { a: { b: string } };

            expect(result.a.b).toBe('hello');
        });
    });

    describe('getStructures', () => {
        it('defaults the agency to ABS', async () => {
            const client = new ABSApiClient();
            await client.getStructures('datastructure');

            expect(lastRequestUrl()).toBe('/rest/datastructure/ABS');
        });

        it('honours an explicit agency id', async () => {
            const client = new ABSApiClient();
            await client.getStructures('codelist', 'OECD');

            expect(lastRequestUrl()).toBe('/rest/codelist/OECD');
        });

        it('forwards detail and references as query params', async () => {
            const client = new ABSApiClient();
            await client.getStructures('dataflow', 'ABS', 'full', 'children');

            expect(lastRequestConfig().params).toEqual({
                detail: 'full',
                references: 'children',
            });
        });
    });

    describe('getData', () => {
        it('defaults the data key to "all"', async () => {
            const client = new ABSApiClient();
            await client.getData('CPI');

            expect(lastRequestUrl()).toBe('/rest/data/CPI/all');
        });

        it('uses an explicit data key when given', async () => {
            const client = new ABSApiClient();
            await client.getData('CPI', '1.2.3');

            expect(lastRequestUrl()).toBe('/rest/data/CPI/1.2.3');
        });

        it('defaults the format to jsondata', async () => {
            const client = new ABSApiClient();
            await client.getData('CPI');

            expect(lastRequestConfig().params).toMatchObject({ format: 'jsondata' });
        });

        it('passes through query options alongside the format', async () => {
            const client = new ABSApiClient();
            await client.getData('CPI', 'all', {
                startPeriod: '2020',
                endPeriod: '2021',
                detail: 'dataonly',
            });

            expect(lastRequestConfig().params).toMatchObject({
                startPeriod: '2020',
                endPeriod: '2021',
                detail: 'dataonly',
                format: 'jsondata',
            });
        });

        it.each([
            ['csvfile', 'text/csv'],
            ['csvfilewithlabels', 'text/csv'],
            ['jsondata', 'application/vnd.sdmx.data+json'],
            ['genericdata', 'application/xml'],
            ['structurespecificdata', 'application/vnd.sdmx.structurespecificdata+xml'],
        ] as const)('negotiates %s as %s', async (format, expected) => {
            const client = new ABSApiClient();
            await client.getData('CPI', 'all', { format });

            expect(lastRequestConfig().headers).toEqual({ Accept: expected });
        });

        it('returns CSV responses untouched', async () => {
            const body = 'DATAFLOW,FREQ,VALUE\nABS:CPI(1.0),A,123\n';
            axiosStub.get.mockResolvedValue({ data: body, config: {} });
            const client = new ABSApiClient();

            const result = await client.getData('CPI', 'all', { format: 'csvfile' });

            expect(result).toBe(body);
        });

        it.fails('returns JSON responses as objects, not XML-parsed junk', async () => {
            // KNOWN BUG (#4, ABSApiClient.ts:98-100): the format defaults to
            // `jsondata` and the Accept header asks for JSON, but the CSV
            // short-circuit only covers `csv*`, so a JSON body is handed to
            // `xmlParser.parse()`. Fix: branch on the response content type and
            // parse JSON as JSON. This test flips green when that lands.
            const payload = { data: { dataSets: [{ series: {} }] } };
            axiosStub.get.mockResolvedValue({
                data: JSON.stringify(payload),
                config: {},
                headers: { 'content-type': 'application/vnd.sdmx.data+json' },
            });
            const client = new ABSApiClient();

            const result = await client.getData('CPI', 'all', { format: 'jsondata' });

            expect(result).toEqual(payload);
        });
    });

    describe('error handling', () => {
        /** Invokes the rejection half of the registered response interceptor. */
        function triggerInterceptor(client: InstanceType<typeof ABSApiClient>, error: unknown): unknown {
            void client;
            const handlers = axiosStub.interceptors.response.use.mock.calls.at(-1);
            const onRejected = handlers?.[1] as ErrorHandler;
            return onRejected(error);
        }

        it('maps an axios error onto an ABSError carrying response context', () => {
            const client = new ABSApiClient();
            const axiosError = {
                message: 'Request failed with status code 404',
                response: { status: 404, statusText: 'Not Found' },
                config: { url: '/rest/data/NOPE/all' },
            };

            let thrown: unknown;
            try {
                triggerInterceptor(client, axiosError);
            } catch (error) {
                thrown = error;
            }

            const absError = thrown as Error & {
                status?: number;
                statusText?: string;
                url?: string;
            };
            expect(absError).toBeInstanceOf(Error);
            expect(absError.status).toBe(404);
            expect(absError.statusText).toBe('Not Found');
            expect(absError.url).toBe('/rest/data/NOPE/all');
            expect(absError.message).toBe('Request failed with status code 404');
        });

        it('logs the failure before rethrowing', () => {
            const client = new ABSApiClient();

            try {
                triggerInterceptor(client, {
                    message: 'boom',
                    response: { status: 500, statusText: 'Server Error' },
                    config: { url: '/rest/dataflow' },
                });
            } catch {
                // expected
            }

            expect(mockLogger.error).toHaveBeenCalledWith(
                'ABS API Error',
                expect.objectContaining({ status: 500, url: '/rest/dataflow' })
            );
        });

        it('falls back to a generic message for non-axios errors', () => {
            isAxiosErrorResult = false;
            const client = new ABSApiClient();

            let thrown: unknown;
            try {
                triggerInterceptor(client, new Error('socket hang up'));
            } catch (error) {
                thrown = error;
            }

            expect((thrown as Error).message).toBe('socket hang up');
            expect(mockLogger.error).toHaveBeenCalledWith(
                'Unknown API Error',
                expect.anything()
            );
        });

        it('rejects rather than resolving when the underlying request fails', async () => {
            axiosStub.get.mockRejectedValue(new Error('network down'));
            const client = new ABSApiClient();

            await expect(client.getDataFlows()).rejects.toThrow('network down');
        });
    });

    describe('response logging', () => {
        it('passes successful responses through the interceptor unchanged', () => {
            const client = new ABSApiClient();
            void client;
            const handlers = axiosStub.interceptors.response.use.mock.calls.at(-1);
            const onFulfilled = handlers?.[0] as SuccessHandler;
            const response = { config: { url: '/rest/dataflow' }, status: 200, data: 'xyz' };

            expect(onFulfilled(response)).toBe(response);
        });
    });
});
