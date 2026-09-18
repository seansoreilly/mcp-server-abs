/**
 * Single source of truth for the ABS API origin.
 *
 * This lived in two modules once, and they drifted: the server used
 * `api.data.abs.gov.au` (which does not resolve) while the API client used
 * `data.api.abs.gov.au` (which does). Defining it once removes the
 * possibility. Overridable so tests can point at a local stub.
 */
export const ABS_API_BASE = process.env.ABS_API_BASE ?? 'https://data.api.abs.gov.au';

/** Where the dataflow cache is written. */
export const ABS_CACHE_FILE =
    process.env.ABS_CACHE_FILE ?? new URL('../cache/dataflows.json', import.meta.url).pathname;

/** How long a cached dataflow list stays fresh. */
export const ABS_CACHE_REFRESH_HOURS = Number(process.env.ABS_CACHE_REFRESH_HOURS ?? 24);

/** Request timeout for ABS API calls, in milliseconds. */
export const ABS_REQUEST_TIMEOUT_MS = Number(process.env.ABS_REQUEST_TIMEOUT_MS ?? 30_000);
