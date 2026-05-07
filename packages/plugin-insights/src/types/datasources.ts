// Re-export everything from the richer dashboards/datasources
// except DatabaseConnectionConfig which conflicts with database.ts
export {
    type DataSource,
    type BigQueryDataSource,
    type DatabaseDataSource,
    type GoogleSheetsDataSource,
    type FileDataSource,
    isDatabaseDataSource,
    isGoogleSheetsDataSource,
    areDataSourcesEqual,
} from "./dashboards/datasources";
