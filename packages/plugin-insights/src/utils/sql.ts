import { Type } from "lucide-react";
import { DataSource, SQLDialect } from "../types";
import { format } from "sql-formatter";

export function getDialectFromDataSources(dataSources: DataSource[]): SQLDialect {
    if (!dataSources?.length) {
        return "bigquery";
    }
    const firstDataSourceType = dataSources[0].type;
    if (firstDataSourceType === "google_sheets" || firstDataSourceType === "file") {
        return "sqlite";
    }
    if (dataSources.some(ds => ds.type !== firstDataSourceType)) {
        console.warn("Mixed data source types detected. Using dialect of the first source.");
    }
    return firstDataSourceType ?? "bigquery"; // Default to BigQuery if no type is found
}

export function formatSQL(sql: string, dialect?: SQLDialect) {
    try {
        const formatted = format(sql, {
            language: dialect,
            paramTypes: {
                custom: [
                    { regex: String.raw`@[A-Z_][A-Z0-9_]*\b` }
                ]
            }
        });

        console.trace("Formatting SQL", {
            sql,
            dialect,
            formatted
        });
        return formatted;
    } catch (e) {
        console.error("Error formatting SQL", e);
        return sql;
    }
}
