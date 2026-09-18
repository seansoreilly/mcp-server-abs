import axios, { type AxiosInstance } from 'axios';
import { XMLParser } from 'fast-xml-parser';
import type { DataFormat, DataQueryOptions, DetailLevel, ReferenceScope } from '../../types/abs.js';
import { ABSError } from '../../types/abs.js';
import logger from '../../utils/logger.js';

export class ABSApiClient {
    private readonly api: AxiosInstance;
    private readonly xmlParser: XMLParser;

    constructor() {
        this.api = axios.create({
            baseURL: 'https://data.api.abs.gov.au',
            timeout: 30000, // 30 seconds
            headers: {
                Accept: 'application/xml',
            },
        });

        this.xmlParser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: '',
            textNodeName: '_text',
            removeNSPrefix: true,
        });

        // Add response interceptor for logging
        this.api.interceptors.response.use(
            (response) => {
                logger.debug('API Response received', {
                    url: response.config.url,
                    status: response.status,
                    dataSize: response.data?.length,
                });
                return response;
            },
            (error) => {
                throw this.toAbsError(error);
            }
        );
    }

    async getDataFlows(): Promise<unknown> {
        logger.info('Fetching dataflows from ABS API');

        const response = await this.api.get<unknown>('/rest/dataflow', {
            headers: {
                Accept: 'application/vnd.sdmx.structure+xml;version=2.1',
            },
        });

        return this.parseXml(response.data);
    }

    async getStructures(
        structureType: string,
        agencyId: string = 'ABS',
        detail?: DetailLevel,
        references?: ReferenceScope
    ): Promise<unknown> {
        logger.info('Fetching structures from ABS API', {
            structureType,
            agencyId,
            detail,
            references,
        });

        const response = await this.api.get<unknown>(`/rest/${structureType}/${agencyId}`, {
            params: {
                detail,
                references,
            },
        });

        return this.parseXml(response.data);
    }

    async getData(
        dataflowId: string,
        dataKey: string = 'all',
        options?: DataQueryOptions
    ): Promise<unknown> {
        logger.info('Fetching data from ABS API', {
            dataflowId,
            dataKey,
            options,
        });

        const format = options?.format ?? 'jsondata';
        const response = await this.api.get<unknown>(`/rest/data/${dataflowId}/${dataKey}`, {
            params: {
                ...options,
                format,
            },
            headers: {
                Accept: this.getAcceptHeader(format),
            },
        });

        const contentType = String(response.headers?.['content-type'] ?? '').toLowerCase();
        if (contentType.includes('csv') || (!contentType && format.startsWith('csv'))) {
            return response.data;
        }
        // Prefer the declared content type. Without one, sniff the body rather
        // than trusting `format`: `jsondata` is the default, so keying off it
        // would send an XML body down the JSON path.
        if (contentType.includes('json') || (!contentType && this.looksLikeJson(response.data))) {
            const data: unknown =
                typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
            if (data === null || typeof data !== 'object') {
                throw new Error('Invalid JSON data response from ABS API');
            }
            return data;
        }
        return this.parseXml(response.data);
    }

    /**
     * Whether a body looks like JSON, used only when the response carries no
     * `content-type`. A JSON document must start with `{` or `[`; anything
     * else (notably an XML document) goes to the XML parser.
     */
    private looksLikeJson(data: unknown): boolean {
        if (typeof data === 'object' && data !== null) {
            return true;
        }
        if (typeof data !== 'string') {
            return false;
        }
        const trimmed = data.trimStart();
        return trimmed.startsWith('{') || trimmed.startsWith('[');
    }

    private parseXml(data: unknown): unknown {
        if (typeof data !== 'string') {
            throw new Error('Expected an XML string from ABS API');
        }
        return this.xmlParser.parse(data);
    }

    private getAcceptHeader(format: DataFormat): string {
        switch (format) {
            case 'csvfile':
            case 'csvfilewithlabels':
                return 'text/csv';
            case 'jsondata':
                return 'application/vnd.sdmx.data+json';
            case 'genericdata':
                return 'application/xml';
            case 'structurespecificdata':
                return 'application/vnd.sdmx.structurespecificdata+xml';
            default:
                return 'application/xml';
        }
    }

    /**
     * Converts an unknown thrown value into a structured {@link ABSError}.
     *
     * Returns rather than throws so callers read as `throw this.toAbsError(e)`
     * — the previous `: never` signature made the `throw` that followed every
     * call site unreachable.
     */
    private toAbsError(error: unknown): ABSError {
        if (axios.isAxiosError(error)) {
            logger.error('ABS API Error', {
                status: error.response?.status,
                statusText: error.response?.statusText,
                url: error.config?.url,
                message: error.message,
            });
            return new ABSError(error.message, {
                status: error.response?.status,
                statusText: error.response?.statusText,
                url: error.config?.url,
            });
        }

        logger.error('Unknown API Error', { error });
        return new ABSError(error instanceof Error ? error.message : 'Unknown error');
    }
}
