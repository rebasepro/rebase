export type BigQueryDatasetTable = {
    tableId: string;
    timePartitioning?: {
        from: string;
        to: string;
    };
    metadata: any;
};
export type BigQueryDatasetConfig = {
    datasetId: string;
    description?: string;
    tables: Array<BigQueryDatasetTable>;
};
