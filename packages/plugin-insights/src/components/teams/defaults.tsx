import { DatabaseConnectionConfig } from "../../types";

export const DEFAULT_MYSQL_CONNECTION = {
    type: "mysql",
    port: 3306,
    databaseName: "mysql",
    user: "root",
} satisfies Partial<DatabaseConnectionConfig>;

export const DEFAULT_POSTGRES_CONNECTION = {
    type: "postgresql",
    port: 5432,
    databaseName: "postgres",
    user: "postgres",
} satisfies Partial<DatabaseConnectionConfig>;
