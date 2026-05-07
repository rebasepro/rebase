import { DataSource, isDatabaseDataSource, isGoogleSheetsDataSource } from "../types";

export function datasourceToString(dataSource: DataSource): string {
    if (dataSource.type === "bigquery" || !dataSource.type) {
        return `${dataSource.projectId}.${dataSource.datasetId}`;
    } else if (isDatabaseDataSource(dataSource)) {
        return dataSource.name ?? dataSource.id;
    } else if (isGoogleSheetsDataSource(dataSource)) {
        return dataSource.title ?? dataSource.id;
    } else if (dataSource.type === "file") {
        return dataSource.name ?? dataSource.originalName ?? dataSource.id;
    }
    return "";

}

export const formatDataSource = (dataSource: DataSource) => {

    if (dataSource.type == "bigquery" || !dataSource.type) {
        return (
            <div key={getDataSourceKey(dataSource)} className={"inline-block"}>
                <span>{dataSource.projectId + "."}</span>
                <span className={"font-semibold"}>{dataSource.datasetId}</span>
            </div>
        );
    } else if (isDatabaseDataSource(dataSource)) {
        return (
            <div key={getDataSourceKey(dataSource)} className={"inline-block"}>
                {dataSource.name ?? dataSource.id}
            </div>
        );
    } else if (isGoogleSheetsDataSource(dataSource)) {
        return (
            <div key={getDataSourceKey(dataSource)} className={"inline-block"}>
                {dataSource.title ?? dataSource.id}
            </div>
        );
    } else if (dataSource.type === "file") {
        return (
            <div key={getDataSourceKey(dataSource)} className={"inline-block"}>
                {dataSource.name ?? dataSource.originalName ?? dataSource.id}
            </div>
        );
    }
    return null;
};

export const getDataSourceKey = (dataSource: DataSource): string => {
    if (dataSource.type === "bigquery") {
        return `${dataSource.projectId}.${dataSource.datasetId}`;
    } else if (isDatabaseDataSource(dataSource)) {
        return dataSource.id;
    } else if (isGoogleSheetsDataSource(dataSource)) {
        return dataSource.id;
    } else if (dataSource.type === "file") {
        return dataSource.id;
    }
    return "";
};
