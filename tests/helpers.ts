import fs from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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

/** A running stub of the ABS API, and the handle to shut it down. */
export interface StubAbsApi {
    /** Origin to hand the server as `ABS_API_BASE`, e.g. `http://127.0.0.1:53124`. */
    baseUrl: string;
    close: () => Promise<void>;
}

/**
 * Starts a throwaway HTTP server standing in for the ABS API.
 *
 * `src/index.ts` reads its base URL from `ABS_API_BASE`, so pointing a spawned
 * server at one of these makes both the upstream-failure and success paths
 * deterministic: no network, no DNS, and no dependence on
 * api.data.abs.gov.au being reachable from the machine running the tests.
 *
 * Binds an ephemeral port (`listen(0)`) so parallel workers never collide.
 */
export async function startStubAbsApi(
    handler: (req: IncomingMessage, res: ServerResponse) => void
): Promise<StubAbsApi> {
    const server = createServer(handler);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

    const address = server.address();
    if (address === null || typeof address === 'string') {
        throw new Error('stub ABS API did not bind to a TCP port');
    }

    return {
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () =>
            new Promise<void>((resolve, reject) => {
                server.close((error) => (error ? reject(error) : resolve()));
            }),
    };
}

/**
 * A base URL that always refuses connections.
 *
 * Port 1 on loopback is reserved and never bound, so requests fail immediately
 * with ECONNREFUSED. That is the `AxiosError`-without-a-`response` branch,
 * which the server handles separately from an HTTP error status.
 */
export const UNREACHABLE_API_BASE = 'http://127.0.0.1:1';
