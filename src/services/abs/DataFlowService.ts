import fs from 'node:fs/promises';
import path from 'node:path';
import type { DataFlow, DataFlowCache, DataQueryOptions } from '../../types/abs.js';
import logger from '../../utils/logger.js';
import { ABSApiClient } from './ABSApiClient.js';

export class DataFlowService {
    private cache: DataFlowCache | null = null;
    private readonly cacheFilePath: string;
    private readonly refreshIntervalMs: number;
    private readonly apiClient: ABSApiClient;

    constructor(cacheFilePath: string, refreshIntervalHours: number = 24) {
        this.cacheFilePath = cacheFilePath;
        this.refreshIntervalMs = refreshIntervalHours * 60 * 60 * 1000;
        this.apiClient = new ABSApiClient();

        logger.info('DataFlowService initialized', {
            cacheFilePath,
            refreshIntervalHours,
            refreshIntervalMs: this.refreshIntervalMs,
        });
    }

    async getDataFlows(forceRefresh: boolean = false): Promise<DataFlow[]> {
        logger.debug('Getting data flows', { forceRefresh });
        try {
            if (!this.cache) {
                logger.info('Cache not initialized, attempting to load from file');
                this.cache = await this.loadCache();
            }

            if (forceRefresh || !this.isCacheValid()) {
                logger.info('Cache invalid or refresh forced, fetching new data');
                const flows = await this.fetchDataFlows();
                this.cache = {
                    lastUpdated: new Date(),
                    flows,
                };
                await this.saveCache(this.cache);
                return flows;
            }

            logger.debug('Returning cached data flows', {
                flowCount: this.cache?.flows.length ?? 0,
                cacheAge: this.cache ? Date.now() - new Date(this.cache.lastUpdated).getTime() : 0,
            });
            return this.cache?.flows ?? [];
        } catch (error) {
            logger.error('Error getting data flows', { error });
            throw error;
        }
    }

    async getFlowData(
        flowId: string,
        dataKey: string = 'all',
        options?: DataQueryOptions
    ): Promise<unknown> {
        logger.info('Getting flow data', { flowId, dataKey, options });
        return this.apiClient.getData(flowId, dataKey, options);
    }

    private async fetchDataFlows(): Promise<DataFlow[]> {
        logger.info('Fetching data flows');
        // No try/catch: a failure here is already logged by the API client's
        // interceptor and again by the caller. Logging a third time at the
        // point of rethrow turned one failure into several near-identical
        // entries without adding context.
        const parsed = await this.apiClient.getDataFlows();
        return this.extractDataFlows(parsed);
    }

    private extractDataFlows(parsed: unknown): DataFlow[] {
        logger.debug('Extracting data flows from parsed XML');
        const structure = asRecord(asRecord(parsed)?.Structure);
        const structures = asRecord(structure?.Structures);
        const dataflowsContainer = asRecord(structures?.Dataflows);
        // Distinguish "the lookup path is missing" (parsing broke — the bug
        // this guards against) from "the list is present but empty" (a
        // legitimate zero-result response). Only the former is an error;
        // collapsing both into a throw would reject valid empty responses.
        if (dataflowsContainer === undefined) {
            throw new Error(
                'ABS API response contains no Structure.Structures.Dataflows — the payload shape is not what the parser expects'
            );
        }
        const dataflows = dataflowsContainer.Dataflow;
        const flows: unknown[] = Array.isArray(dataflows)
            ? dataflows
            : dataflows == null
              ? []
              : [dataflows];

        return flows.map((value): DataFlow => {
            const flow = asRecord(value);
            const identity = readIdentity(flow);
            const dataFlow: DataFlow = {
                ...identity,
                name: readText(flow?.Name),
                description: readText(flow?.Description),
            };
            const reference = asRecord(flow?.Structure)?.Ref;
            if (reference !== undefined) {
                dataFlow.structure = readIdentity(asRecord(reference));
            }
            return dataFlow;
        });
    }

    private async loadCache(): Promise<DataFlowCache | null> {
        logger.debug('Loading cache from file', { path: this.cacheFilePath });
        try {
            const data = await fs.readFile(this.cacheFilePath, 'utf8');
            const cache = parseCache(JSON.parse(data));
            if (cache === null) {
                // A truncated or hand-edited cache would otherwise yield an
                // Invalid Date, which compares false against every expiry
                // check — leaving the cache permanently stale and never
                // refetched. Treat it as absent so the next call refetches.
                logger.warn('Ignoring malformed cache file', { path: this.cacheFilePath });
                return null;
            }
            logger.info('Successfully loaded cache', {
                flowCount: cache.flows.length,
                lastUpdated: cache.lastUpdated,
            });
            return cache;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                logger.info('No cache file found', { path: this.cacheFilePath });
                return null;
            }
            // Unparseable JSON is deliberately NOT swallowed: a corrupt cache
            // file is a symptom worth surfacing, and `failure modes >
            // propagates a corrupt cache file` pins that choice. Only a
            // well-formed cache whose *shape* is wrong degrades to a refetch,
            // because that case would otherwise go undetected forever.
            logger.error('Error loading cache', { error });
            throw error;
        }
    }

    private async saveCache(cache: DataFlowCache): Promise<void> {
        logger.debug('Saving cache to file', {
            path: this.cacheFilePath,
            flowCount: cache.flows.length,
        });
        try {
            await fs.mkdir(path.dirname(this.cacheFilePath), { recursive: true });
            await fs.writeFile(this.cacheFilePath, JSON.stringify(cache, null, 2));
            logger.info('Successfully saved cache');
        } catch (error) {
            logger.error('Error saving cache', { error });
            throw error;
        }
    }

    private isCacheValid(): boolean {
        if (!this.cache || this.cache.flows.length === 0) {
            logger.debug('Cache is null');
            return false;
        }

        const age = Date.now() - new Date(this.cache.lastUpdated).getTime();
        const isValid = age < this.refreshIntervalMs;

        logger.debug('Checking cache validity', {
            age,
            refreshIntervalMs: this.refreshIntervalMs,
            isValid,
        });

        return isValid;
    }

    // Utility method to format a dataflow identifier for use in data queries
    public static formatDataflowIdentifier(flow: DataFlow): string {
        return `${flow.agencyID},${flow.id},${flow.version}`;
    }
}

/**
 * Validates on-disk cache content, returning `null` if it is not usable.
 *
 * `JSON.parse(...) as DataFlowCache` is a lie to the compiler: the file is
 * arbitrary bytes. In particular an unparseable `lastUpdated` yields an
 * Invalid Date, whose comparisons are always false — so a corrupt cache would
 * read as neither fresh nor expired and never be refreshed.
 */
function parseCache(value: unknown): DataFlowCache | null {
    const record = asRecord(value);
    if (record === undefined || !Array.isArray(record.flows)) {
        return null;
    }
    const lastUpdated = new Date(record.lastUpdated as string | number | Date);
    if (Number.isNaN(lastUpdated.getTime())) {
        return null;
    }
    return { flows: record.flows as DataFlowCache['flows'], lastUpdated };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
}

function readIdentity(
    value: Record<string, unknown> | undefined
): Pick<DataFlow, 'id' | 'agencyID' | 'version'> {
    const { id, agencyID, version } = value ?? {};
    if (
        typeof id !== 'string' ||
        !id.trim() ||
        typeof agencyID !== 'string' ||
        !agencyID.trim() ||
        typeof version !== 'string' ||
        !version.trim()
    ) {
        throw new Error('Invalid dataflow identity in ABS API response');
    }
    return { id, agencyID, version };
}

function readText(value: unknown): string {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
        const english = value.find((entry: unknown) => asRecord(entry)?.lang === 'en');
        return readText(english ?? value[0]);
    }
    const text = asRecord(value)?._text;
    return typeof text === 'string' ? text : '';
}
