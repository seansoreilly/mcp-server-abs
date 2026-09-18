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
    dimensionAtObservation?: 'TIME_PERIOD' | 'AllDimensions' | string;
}

export interface ABSError extends Error {
    status?: number;
    statusText?: string;
    url?: string;
}
