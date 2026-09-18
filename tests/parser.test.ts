import { XMLParser } from 'fast-xml-parser';
import { beforeAll, describe, expect, it } from 'vitest';
import { FIXTURE_FIRST_FLOW, FIXTURE_FLOW_COUNT, loadDataflowsXml } from './helpers.js';

/**
 * Characterisation tests for the SDMX-ML payload itself.
 *
 * These assert the *shape of the real ABS response* rather than the behaviour
 * of our code, so they stay true regardless of how the parsing bugs get fixed.
 * They are the contract any future parser implementation must satisfy.
 */

/** The parser options used in production (`ABSApiClient.ts:19-23`). */
const PRODUCTION_PARSER_OPTIONS = {
    ignoreAttributes: false,
    attributeNamePrefix: '',
    textNodeName: '_text',
} as const;

interface ParsedRef {
    id: string;
    version: string;
    agencyID: string;
    package?: string;
    class?: string;
}

interface ParsedFlow {
    id: string;
    agencyID: string;
    version: string;
    Name?: { _text: string; lang?: string };
    Description?: { _text: string; lang?: string };
    Structure?: { Ref: ParsedRef };
}

describe('SDMX-ML dataflow payload', () => {
    let xml: string;

    beforeAll(async () => {
        xml = await loadDataflowsXml();
    });

    it('is namespaced, so the production parser yields namespace-prefixed keys', () => {
        const parser = new XMLParser(PRODUCTION_PARSER_OPTIONS);
        const parsed = parser.parse(xml) as Record<string, unknown>;

        expect(Object.keys(parsed)).toContain('message:Structure');
        expect(Object.keys(parsed)).not.toContain('Structure');
    });

    it('defeats the un-prefixed lookup path used by DataFlowService', () => {
        // Regression guard for bug #2: `DataFlowService.ts:76` reads
        // `parsed.Structure?.Dataflows?.Dataflow`. Against the real payload that
        // is `undefined`, and the `|| []` fallback turns the miss into a silent
        // "success" with zero flows. This test documents *why* that happens.
        const parser = new XMLParser(PRODUCTION_PARSER_OPTIONS);
        const parsed = parser.parse(xml) as {
            Structure?: { Dataflows?: { Dataflow?: unknown } };
        };

        expect(parsed.Structure?.Dataflows?.Dataflow).toBeUndefined();
    });

    it('exposes 1208 dataflows once namespace prefixes are removed', () => {
        const parser = new XMLParser({
            ...PRODUCTION_PARSER_OPTIONS,
            removeNSPrefix: true,
        });
        const parsed = parser.parse(xml) as {
            Structure: { Structures: { Dataflows: { Dataflow: ParsedFlow[] } } };
        };

        // NOTE: the correct path has FOUR levels, not three. The message wraps
        // the dataflows in `message:Structures`, so even with `removeNSPrefix`
        // the path is Structure > Structures > Dataflows > Dataflow.
        const flows = parsed.Structure.Structures.Dataflows.Dataflow;

        expect(Array.isArray(flows)).toBe(true);
        expect(flows).toHaveLength(FIXTURE_FLOW_COUNT);
    });

    it('carries id/agencyID/version as attributes and name/description as text nodes', () => {
        const parser = new XMLParser({
            ...PRODUCTION_PARSER_OPTIONS,
            removeNSPrefix: true,
        });
        const parsed = parser.parse(xml) as {
            Structure: { Structures: { Dataflows: { Dataflow: ParsedFlow[] } } };
        };
        const first = parsed.Structure.Structures.Dataflows.Dataflow[0];

        expect(first.id).toBe(FIXTURE_FIRST_FLOW.id);
        expect(first.agencyID).toBe(FIXTURE_FIRST_FLOW.agencyID);
        expect(first.version).toBe(FIXTURE_FIRST_FLOW.version);

        // `common:Name` has an `xml:lang` attribute, so with `ignoreAttributes:
        // false` the text lands under the configured `textNodeName`.
        expect(first.Name?._text).toContain(FIXTURE_FIRST_FLOW.namePrefix);
        expect(first.Description?._text).toBeTruthy();
    });

    it('nests the datastructure reference under Structure > Ref', () => {
        const parser = new XMLParser({
            ...PRODUCTION_PARSER_OPTIONS,
            removeNSPrefix: true,
        });
        const parsed = parser.parse(xml) as {
            Structure: { Structures: { Dataflows: { Dataflow: ParsedFlow[] } } };
        };
        const first = parsed.Structure.Structures.Dataflows.Dataflow[0];

        expect(first.Structure?.Ref.id).toBe(FIXTURE_FIRST_FLOW.id);
        expect(first.Structure?.Ref.agencyID).toBe(FIXTURE_FIRST_FLOW.agencyID);
        expect(first.Structure?.Ref.version).toBe(FIXTURE_FIRST_FLOW.version);
    });

    it('gives every dataflow the identity fields the DataFlow type requires', () => {
        const parser = new XMLParser({
            ...PRODUCTION_PARSER_OPTIONS,
            removeNSPrefix: true,
        });
        const parsed = parser.parse(xml) as {
            Structure: { Structures: { Dataflows: { Dataflow: ParsedFlow[] } } };
        };
        const flows = parsed.Structure.Structures.Dataflows.Dataflow;

        for (const flow of flows) {
            expect(typeof flow.id).toBe('string');
            expect(flow.id.length).toBeGreaterThan(0);
            expect(typeof flow.agencyID).toBe('string');
            expect(typeof flow.version).toBe('string');
        }
    });
});
