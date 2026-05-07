export type DataRow = {
    [key: string]: any;
};

export type SQLDialect = "bigquery" | "postgresql" | "mysql" | "sqlite";

export type FilterOp =
    | "<"
    | "<="
    | "=="
    | "!="
    | ">="
    | ">"
    ;

// TODO, currently not used, useful for filtering tables
export type ColumnFilter = [string, FilterOp, unknown];

export type SQLDataType = "STRING" | "INT64" | "FLOAT64" | "BOOL" | "TIMESTAMP" | "DATE" | "ARRAY";

export type FilterType = "text_exact" | "text_search" | "enum" | "number" | "boolean" | "date" | "date_range";

export type FilterValue = string | number | Date | [Date | number, Date | number] | any[] | null;
export type ParamFilter = {
    key: string;
    value?: FilterValue;
    operator?: FilterOp;
    type?: FilterType;
};

export type OrderBy = [string, "asc" | "desc"][];

export interface SQLQuery {
    sql: string;
    params?: DateParams;
    paramFilters?: ParamFilter[];
    orderBy?: OrderBy;
    filter?: ColumnFilter[];
    limit?: number;
    offset?: number;
}


export type DateParams = {
    dateStart?: Date | null;
    dateEnd?: Date | null;
}


export interface PostgresCredentials {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
    ssl?: boolean | {
        rejectUnauthorized: boolean;
    };
}
