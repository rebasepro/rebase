export type DataSource = BigQueryDataSource | DatabaseDataSource | GoogleSheetsDataSource | FileDataSource;
export type BigQueryDataSource = {
    type: "bigquery";
    projectId: string;
    datasetId: string;
    location?: string;
    id?: string;
    name?: string;
    title?: string;
}

export type DatabaseDataSource = {
    type: "postgresql" | "mysql";
    host: string;
    port?: number;
    user: string;
    password?: string;
    name: string;
    databaseName?: string;
    id: string;
    title?: string;
    teamId?: string;
}

export type DatabaseConnectionConfig = DatabaseDataSource;

export type GoogleSheetsDataSource = {
    type: "google_sheets";
    id: string;
    title: string;
    name?: string;
    spreadsheetId: string;
}

export function isDatabaseDataSource(dataSource: DataSource): dataSource is DatabaseDataSource {
    return dataSource.type === "postgresql" || dataSource.type === "mysql";
}

export function isGoogleSheetsDataSource(dataSource: DataSource): dataSource is GoogleSheetsDataSource {
    return dataSource.type === "google_sheets";
}

export function areDataSourcesEqual(prev: DataSource, next: DataSource): boolean {
    if (prev === next) return true;
    if (prev.type !== next.type) return false;
    if (prev.id !== next.id) return false;
    if (prev.type === "bigquery" && next.type === "bigquery") {
        return prev.projectId === next.projectId && prev.datasetId === next.datasetId;
    }
    return true;
}

export type FileDataSource = {
    type: "file";
    id: string;
    name: string;
    originalName: string;
    size: number;
    mimeType?: string;
    uploadedAt: Date;
    uploaderId: string;
}
