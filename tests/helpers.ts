import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { vi } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Repository root, resolved from this file so tests do not depend on cwd. */
export const repoRoot = path.resolve(here, '..');

/**
 * The committed `dataflows.xml` — a real captured ABS response
 * (NSI Web Service v8.19.6.0) containing 1208 namespaced dataflows.
 */
export const fixturePath = path.join(repoRoot, 'dataflows.xml');

let cachedFixture: string | null = null;

/** Reads the 3.5 MB fixture once per worker; callers must not mutate the result. */
export async function loadDataflowsXml(): Promise<string> {
    if (cachedFixture === null) {
        cachedFixture = await fs.readFile(fixturePath, 'utf8');
    }
    return cachedFixture;
}

/** Number of `<structure:Dataflow>` elements in the committed fixture. */
export const FIXTURE_FLOW_COUNT = 1208;

/** First dataflow in the fixture, in document order. */
export const FIXTURE_FIRST_FLOW = {
    id: 'ABORIGINAL_POP_PROJ',
    agencyID: 'ABS',
    version: '1.3.0',
    namePrefix: 'Projected population, Aboriginal and Torres Strait Islander Australians',
} as const;

/** Creates a unique temp dir and returns it with a cleanup function. */
export async function makeTempDir(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'abs-mcp-test-'));
    return {
        dir,
        cleanup: async () => {
            await fs.rm(dir, { recursive: true, force: true });
        },
    };
}

/**
 * The subset of the winston logger surface the services actually call.
 * Mocked everywhere so tests neither create a `logs/` directory nor
 * write to stdout (which would corrupt the MCP stdio channel in prod).
 */
export interface MockLogger {
    debug: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
}

export function createMockLogger(): MockLogger {
    return {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    };
}
