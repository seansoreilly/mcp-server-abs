export interface DataFlow {
    id: string;
    agencyID: string;
    version: string;
    name: string;
    description: string;
    structure?: {
        id: string;
        version: string;
        agencyID: string;
    };
}

export interface DataFlowCache {
    lastUpdated: Date;
    flows: DataFlow[];
}

export type DetailLevel =
    | 'full'
    | 'allstubs'
    | 'referencestubs'
    | 'referencepartial'
    | 'allcompletestubs'
    | 'referencecompletestubs';

export type ReferenceScope =
    | 'none'
    | 'parents'
    | 'parentsandsiblings'
    | 'children'
    | 'descendants'
    | 'all'
    | 'datastructure'
    | 'dataflow'
    | 'codelist'
    | 'conceptscheme'
    | 'categoryscheme'
    | 'contentconstraint'
    | 'actualconstraint'
    | 'agencyscheme'
    | 'categorisation'
    | 'hierarchicalcodelist';

export type DataFormat =
    | 'csvfilewithlabels'
    | 'csvfile'
    | 'jsondata'
    | 'genericdata'
    | 'structurespecificdata';

export interface DataQueryOptions {
    startPeriod?: string;
    endPeriod?: string;
    format?: DataFormat;
    detail?: 'full' | 'dataonly' | 'serieskeysonly' | 'nodata';
    // `'A' | 'B' | string` collapses to plain `string`, losing both checking and
    // autocomplete. `(string & {})` keeps the literals as hints while still
    // accepting any dimension id the ABS API may define.
    dimensionAtObservation?: 'TIME_PERIOD' | 'AllDimensions' | (string & {});
}

/**
 * An error from the ABS API, carrying the HTTP context as structured fields.
 *
 * A real class rather than an interface over a plain `Error`: `instanceof`
 * works, the shape is guaranteed by the constructor instead of by whoever
 * remembered to assign the fields, and callers can branch on `status` rather
 * than parsing it back out of a message string.
 */
export class ABSError extends Error {
    readonly status?: number;
    readonly statusText?: string;
    readonly url?: string;

    constructor(
        message: string,
        context: { status?: number; statusText?: string; url?: string } = {}
    ) {
        super(message);
        this.name = 'ABSError';
        this.status = context.status;
        this.statusText = context.statusText;
        this.url = context.url;
    }
}
