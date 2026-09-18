import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataFlow, DataFlowCache } from '../src/types/abs.js';
import { createMockLogger, makeTempDir } from './helpers.js';

const mockLogger = createMockLogger();
vi.mock('../src/utils/logger.js', () => ({ default: mockLogger }));

const getDataFlows = vi.fn();
const getData = vi.fn();

vi.mock('../src/services/abs/ABSApiClient.js', () => ({
    ABSApiClient: class {
        getDataFlows = getDataFlows;
        getData = getData;
    },
}));

const { DataFlowService } = await import('../src/services/abs/DataFlowService.js');

const SAMPLE_FLOWS: DataFlow[] = [
    {
        id: 'CPI',
        agencyID: 'ABS',
        version: '1.0.0',
        name: 'Consumer Price Index',
        description: 'Quarterly CPI',
    },
];

/**
 * Builds a minimal parsed-SDMX envelope around `flows`.
 *
 * The envelope is deliberately placed at BOTH the path the code reads today
 * (`Structure.Dataflows.Dataflow`) and the path the real payload uses once the
 * namespace bug is fixed (`Structure.Structures.Dataflows.Dataflow`). These
 * tests are about the per-flow mapping, not the lookup path, so they must stay
 * green either way — the lookup path is covered end-to-end against the real
 * fixture in `dataflow-extraction.test.ts`.
 */
function parsedResponse(flows: unknown): Record<string, unknown> {
    return {
        Structure: {
            Dataflows: { Dataflow: flows },
            Structures: { Dataflows: { Dataflow: flows } },
        },
    };
}

describe('DataFlowService', () => {
    let dir: string;
    let cleanup: () => Promise<void>;
    let cacheFile: string;

    beforeEach(async () => {
        vi.clearAllMocks();
        ({ dir, cleanup } = await makeTempDir());
        cacheFile = path.join(dir, 'cache', 'dataflows.json');
        getDataFlows.mockResolvedValue(parsedResponse([]));
    });

    afterEach(async () => {
        vi.useRealTimers();
        await cleanup();
    });

    async function writeCache(cache: DataFlowCache): Promise<void> {
        await fs.mkdir(path.dirname(cacheFile), { recursive: true });
        await fs.writeFile(cacheFile, JSON.stringify(cache, null, 2));
    }

    async function readCache(): Promise<DataFlowCache> {
        const raw = await fs.readFile(cacheFile, 'utf8');
        return JSON.parse(raw) as DataFlowCache;
    }

    describe('cache reads', () => {
        it('serves a fresh on-disk cache without calling the API', async () => {
            await writeCache({ lastUpdated: new Date(), flows: SAMPLE_FLOWS });
            const service = new DataFlowService(cacheFile, 24);

            const flows = await service.getDataFlows();

            expect(flows).toEqual(SAMPLE_FLOWS);
            expect(getDataFlows).not.toHaveBeenCalled();
        });

        it('revives lastUpdated as a Date when loading from disk', async () => {
            const when = new Date('2025-01-01T00:00:00.000Z');
            await writeCache({ lastUpdated: when, flows: SAMPLE_FLOWS });
            vi.useFakeTimers();
            vi.setSystemTime(new Date('2025-01-01T06:00:00.000Z'));
            const service = new DataFlowService(cacheFile, 24);

            await service.getDataFlows();

            // A fresh cache is served from memory on the second call.
            expect(await service.getDataFlows()).toEqual(SAMPLE_FLOWS);
            expect(getDataFlows).not.toHaveBeenCalled();
        });

        it('reads the cache file only once, then serves from memory', async () => {
            await writeCache({ lastUpdated: new Date(), flows: SAMPLE_FLOWS });
            const service = new DataFlowService(cacheFile, 24);
            const readSpy = vi.spyOn(fs, 'readFile');

            await service.getDataFlows();
            await service.getDataFlows();
            await service.getDataFlows();

            expect(readSpy).toHaveBeenCalledTimes(1);
            readSpy.mockRestore();
        });
    });

    describe('cache expiry', () => {
        it('refetches when the cache is older than the refresh interval', async () => {
            await writeCache({
                lastUpdated: new Date('2025-01-01T00:00:00.000Z'),
                flows: SAMPLE_FLOWS,
            });
            vi.useFakeTimers();
            vi.setSystemTime(new Date('2025-01-03T00:00:00.000Z')); // 48h later
            const service = new DataFlowService(cacheFile, 24);

            await service.getDataFlows();

            expect(getDataFlows).toHaveBeenCalledTimes(1);
        });

        it('keeps serving a cache that is inside the interval', async () => {
            await writeCache({
                lastUpdated: new Date('2025-01-01T00:00:00.000Z'),
                flows: SAMPLE_FLOWS,
            });
            vi.useFakeTimers();
            vi.setSystemTime(new Date('2025-01-01T23:00:00.000Z')); // 23h later
            const service = new DataFlowService(cacheFile, 24);

            await service.getDataFlows();

            expect(getDataFlows).not.toHaveBeenCalled();
        });

        it('honours a custom refresh interval', async () => {
            await writeCache({
                lastUpdated: new Date('2025-01-01T00:00:00.000Z'),
                flows: SAMPLE_FLOWS,
            });
            vi.useFakeTimers();
            vi.setSystemTime(new Date('2025-01-01T02:00:00.000Z')); // 2h later
            const service = new DataFlowService(cacheFile, 1); // 1h interval

            await service.getDataFlows();

            expect(getDataFlows).toHaveBeenCalledTimes(1);
        });

        it('refetches when forceRefresh is set, even with a fresh cache', async () => {
            await writeCache({ lastUpdated: new Date(), flows: SAMPLE_FLOWS });
            const service = new DataFlowService(cacheFile, 24);

            await service.getDataFlows(true);

            expect(getDataFlows).toHaveBeenCalledTimes(1);
        });
    });

    describe('cache writes', () => {
        it('creates the cache directory when it does not exist', async () => {
            const service = new DataFlowService(cacheFile, 24);

            await service.getDataFlows();

            await expect(fs.stat(path.dirname(cacheFile))).resolves.toBeDefined();
        });

        it('persists fetched flows with a lastUpdated stamp', async () => {
            getDataFlows.mockResolvedValue(
                parsedResponse([
                    {
                        id: 'CPI',
                        agencyID: 'ABS',
                        version: '1.0.0',
                        Name: { _text: 'Consumer Price Index' },
                        Description: { _text: 'Quarterly CPI' },
                    },
                ])
            );
            const service = new DataFlowService(cacheFile, 24);

            await service.getDataFlows();
            const written = await readCache();

            expect(written.lastUpdated).toBeTruthy();
            expect(written.flows[0]).toMatchObject({ id: 'CPI', agencyID: 'ABS' });
        });

        it('fetches when no cache file exists (ENOENT is not an error)', async () => {
            const service = new DataFlowService(cacheFile, 24);

            await expect(service.getDataFlows()).resolves.toBeDefined();
            expect(getDataFlows).toHaveBeenCalledTimes(1);
        });
    });

    describe('failure modes', () => {
        it('propagates a corrupt cache file rather than silently refetching', async () => {
            await fs.mkdir(path.dirname(cacheFile), { recursive: true });
            await fs.writeFile(cacheFile, '{ not valid json');
            const service = new DataFlowService(cacheFile, 24);

            await expect(service.getDataFlows()).rejects.toThrow();
        });

        it('propagates API failures', async () => {
            getDataFlows.mockRejectedValue(new Error('ABS API Error'));
            const service = new DataFlowService(cacheFile, 24);

            await expect(service.getDataFlows()).rejects.toThrow('ABS API Error');
        });

        it('logs the error when a fetch fails', async () => {
            getDataFlows.mockRejectedValue(new Error('boom'));
            const service = new DataFlowService(cacheFile, 24);

            await expect(service.getDataFlows()).rejects.toThrow('boom');
            expect(mockLogger.error).toHaveBeenCalled();
        });
    });

    describe('extraction', () => {
        it('normalises a single (non-array) dataflow into an array', async () => {
            getDataFlows.mockResolvedValue(
                parsedResponse({
                    id: 'SOLO',
                    agencyID: 'ABS',
                    version: '1.0.0',
                    Name: { _text: 'Only one' },
                })
            );
            const service = new DataFlowService(cacheFile, 24);

            const flows = await service.getDataFlows();

            expect(flows).toHaveLength(1);
            expect(flows[0].id).toBe('SOLO');
        });

        it('defaults name and description to empty strings when absent', async () => {
            getDataFlows.mockResolvedValue(
                parsedResponse([{ id: 'X', agencyID: 'ABS', version: '1.0.0' }])
            );
            const service = new DataFlowService(cacheFile, 24);

            const flows = await service.getDataFlows();

            expect(flows[0].name).toBe('');
            expect(flows[0].description).toBe('');
        });

        it('attaches the datastructure reference when present', async () => {
            getDataFlows.mockResolvedValue(
                parsedResponse([
                    {
                        id: 'X',
                        agencyID: 'ABS',
                        version: '1.0.0',
                        Structure: {
                            Ref: { id: 'X_DSD', version: '2.0.0', agencyID: 'ABS' },
                        },
                    },
                ])
            );
            const service = new DataFlowService(cacheFile, 24);

            const flows = await service.getDataFlows();

            expect(flows[0].structure).toEqual({
                id: 'X_DSD',
                version: '2.0.0',
                agencyID: 'ABS',
            });
        });

        it('omits the structure key when no reference is present', async () => {
            getDataFlows.mockResolvedValue(
                parsedResponse([{ id: 'X', agencyID: 'ABS', version: '1.0.0' }])
            );
            const service = new DataFlowService(cacheFile, 24);

            const flows = await service.getDataFlows();

            expect(flows[0].structure).toBeUndefined();
        });
    });

    describe('getFlowData', () => {
        it('delegates to the API client with the given key and options', async () => {
            getData.mockResolvedValue({ ok: true });
            const service = new DataFlowService(cacheFile, 24);

            await service.getFlowData('CPI', '1.2.3', { format: 'csvfile' });

            expect(getData).toHaveBeenCalledWith('CPI', '1.2.3', { format: 'csvfile' });
        });

        it('defaults the data key to "all"', async () => {
            getData.mockResolvedValue({ ok: true });
            const service = new DataFlowService(cacheFile, 24);

            await service.getFlowData('CPI');

            expect(getData).toHaveBeenCalledWith('CPI', 'all', undefined);
        });
    });

    describe('formatDataflowIdentifier', () => {
        it('joins agency, id and version in SDMX order', () => {
            expect(DataFlowService.formatDataflowIdentifier(SAMPLE_FLOWS[0])).toBe('ABS,CPI,1.0.0');
        });
    });
});
