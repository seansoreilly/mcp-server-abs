import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import {
    createMockLogger,
    makeTempDir,
    loadDataflowsXml,
    FIXTURE_FLOW_COUNT,
    FIXTURE_FIRST_FLOW,
} from './helpers.js';

/**
 * End-to-end extraction against the real captured ABS response.
 *
 * Unlike `DataFlowService.test.ts`, this file does NOT mock `ABSApiClient` —
 * only axios is stubbed. That matters: the production `XMLParser` config and
 * the `DataFlowService` lookup path are both exercised for real. These
 * assertions previously carried `it.fails` guards for two extraction bugs
 * (missing `removeNSPrefix`, and a lookup path one level too shallow); both
 * are fixed, so the guards are gone and these now assert real behaviour.
 */

const mockLogger = createMockLogger();
vi.mock('../src/utils/logger.js', () => ({ default: mockLogger }));

interface AxiosStub {
    get: ReturnType<typeof vi.fn>;
    interceptors: { response: { use: ReturnType<typeof vi.fn> } };
}

const axiosStub: AxiosStub = {
    get: vi.fn(),
    interceptors: { response: { use: vi.fn() } },
};

vi.mock('axios', () => ({
    default: {
        create: (): AxiosStub => axiosStub,
        isAxiosError: (): boolean => true,
    },
    isAxiosError: (): boolean => true,
}));

const { DataFlowService } = await import('../src/services/abs/DataFlowService.js');

describe('dataflow extraction from the captured ABS response', () => {
    let dir: string;
    let cleanup: () => Promise<void>;
    let cacheFile: string;

    beforeEach(async () => {
        vi.clearAllMocks();
        ({ dir, cleanup } = await makeTempDir());
        cacheFile = path.join(dir, 'cache', 'dataflows.json');

        const xml = await loadDataflowsXml();
        axiosStub.get.mockResolvedValue({
            data: xml,
            status: 200,
            config: { url: '/rest/dataflow' },
            headers: { 'content-type': 'application/vnd.sdmx.structure+xml' },
        });
    });

    afterEach(async () => {
        await cleanup();
    });

    it('issues a real request through ABSApiClient', async () => {
        const service = new DataFlowService(cacheFile, 24);

        await service.getDataFlows();

        expect(axiosStub.get).toHaveBeenCalledWith('/rest/dataflow', expect.anything());
    });

    it('extracts all 1208 dataflows', async () => {
        // KNOWN BUGS (#2, #3). Two independent defects, both required:
        //   1. ABSApiClient.ts:19-23 omits `removeNSPrefix: true`, so every key
        //      keeps its `message:` / `structure:` / `common:` prefix.
        //   2. DataFlowService.ts:76 reads Structure.Dataflows.Dataflow, but the
        //      payload nests them one level deeper, under message:Structures —
        //      the real path is Structure.Structures.Dataflows.Dataflow.
        // Fixing only one still yields zero flows. Remove this `.fails` when
        // both land.
        const service = new DataFlowService(cacheFile, 24);

        const flows = await service.getDataFlows();

        expect(flows).toHaveLength(FIXTURE_FLOW_COUNT);
    });

    it('populates id, name and description on the first dataflow', async () => {
        // KNOWN BUGS (#2, #3): resolved by the same two changes as above.
        const service = new DataFlowService(cacheFile, 24);

        const flows = await service.getDataFlows();
        const first = flows[0];

        expect(first.id).toBe(FIXTURE_FIRST_FLOW.id);
        expect(first.agencyID).toBe(FIXTURE_FIRST_FLOW.agencyID);
        expect(first.version).toBe(FIXTURE_FIRST_FLOW.version);
        expect(first.name).toContain(FIXTURE_FIRST_FLOW.namePrefix);
        expect(first.description).not.toBe('');
    });

    it('attaches the datastructure reference from Structure > Ref', async () => {
        // KNOWN BUGS (#2, #3): resolved by the same two changes as above.
        const service = new DataFlowService(cacheFile, 24);

        const flows = await service.getDataFlows();

        expect(flows[0].structure).toEqual({
            id: FIXTURE_FIRST_FLOW.id,
            version: FIXTURE_FIRST_FLOW.version,
            agencyID: FIXTURE_FIRST_FLOW.agencyID,
        });
    });

    it('never reports success with an empty result set', async () => {
        // KNOWN BUG (#2): the `|| []` fallback at DataFlowService.ts:76 turns a
        // failed lookup into a successful empty response, so a caller cannot
        // tell "no dataflows" from "parsing broke". Fix: assert a non-empty
        // result rather than defaulting to `[]`.
        const service = new DataFlowService(cacheFile, 24);

        const flows = await service.getDataFlows();

        expect(flows.length).toBeGreaterThan(0);
    });

    it('writes whatever it extracted through to the cache file', async () => {
        const service = new DataFlowService(cacheFile, 24);

        const flows = await service.getDataFlows();
        const second = await service.getDataFlows();

        // Cache is served from memory on the second call, so the API is hit once.
        expect(axiosStub.get).toHaveBeenCalledTimes(1);
        expect(second).toEqual(flows);
    });
});
