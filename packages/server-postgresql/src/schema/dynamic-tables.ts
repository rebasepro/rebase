/**
 * Build drizzle tables at runtime from an introspected schema.
 *
 * CMS mode gets its drizzle tables from a generated `schema.generated.ts` that
 * the developer commits. BaaS mode has no such file — it points at a database
 * and serves it — so the equivalent table objects are constructed here from
 * `information_schema` metadata.
 *
 * These are handed to drizzle as its schema, which keeps the relational query
 * path (`db.query.*`) working; without them FetchService would fall back to
 * plain selects and lose relation loading.
 */
import {
    bigint,
    boolean,
    doublePrecision,
    integer,
    jsonb,
    numeric,
    pgSchema,
    pgTable,
    primaryKey,
    real,
    smallint,
    text,
    time,
    timestamp,
    uuid,
    varchar,
    date,
    type PgColumnBuilderBase,
    type PgTable
} from "drizzle-orm/pg-core";

import type { TableColumn, TableMeta } from "./introspect-db-logic";

/**
 * Map a Postgres column to a drizzle column builder.
 *
 * Unknown types fall back to `text`: the driver still reads and writes them,
 * with the value passing through as a string, which beats dropping the column.
 */
function columnBuilderFor(col: TableColumn): PgColumnBuilderBase {
    const name = col.column_name;
    const dataType = col.data_type.toLowerCase();

    // Arrays and enums are matched before the scalar types: "_int4" and
    // "USER-DEFINED" would otherwise fall through to the substring checks.
    if (dataType === "array" || col.udt_name.startsWith("_")) {
        return text(name).array();
    }
    if (dataType === "user-defined") {
        // Includes pg enums; drizzle treats the value as a string either way.
        return text(name);
    }

    switch (dataType) {
        case "uuid":
            return uuid(name);
        case "boolean":
            return boolean(name);
        case "smallint":
            return smallint(name);
        case "integer":
            return integer(name);
        case "bigint":
            return bigint(name, { mode: "number" });
        case "real":
            return real(name);
        case "double precision":
            return doublePrecision(name);
        case "numeric":
        case "money":
            return numeric(name);
        case "json":
        case "jsonb":
            return jsonb(name);
        case "date":
            return date(name);
        case "time":
        case "time without time zone":
        case "time with time zone":
            return time(name);
        case "timestamp":
        case "timestamp without time zone":
            return timestamp(name);
        case "timestamp with time zone":
            return timestamp(name, { withTimezone: true });
        case "character varying":
        case "varchar": {
            // atttypmod carries the declared length + 4 (header); -1 means unbounded.
            const length = col.atttypmod && col.atttypmod > 4 ? col.atttypmod - 4 : undefined;
            return length ? varchar(name, { length }) : text(name);
        }
        default:
            return text(name);
    }
}

/**
 * Build one drizzle table per introspected table, keyed by table name.
 */
export function buildDrizzleTablesFromSchema(
    tablesMap: Map<string, TableMeta>,
    pgSchemaName = "public"
): Record<string, PgTable> {
    const schema = pgSchemaName === "public" ? null : pgSchema(pgSchemaName);
    // The column set is only known at runtime, so drizzle's generic table
    // signature can't be satisfied statically; call it through a loose type.
    const createTable = (schema ? schema.table.bind(schema) : pgTable) as unknown as (
        name: string,
        columns: Record<string, PgColumnBuilderBase>,
        extras?: (self: Record<string, unknown>) => unknown[]
    ) => PgTable;

    const tables: Record<string, PgTable> = {};

    for (const [tableName, meta] of tablesMap) {
        const columns: Record<string, PgColumnBuilderBase> = {};

        for (const col of meta.columns) {
            let builder = columnBuilderFor(col);

            if (col.is_nullable === "NO") {
                builder = (builder as unknown as { notNull(): PgColumnBuilderBase }).notNull();
            }
            // Single-column primary keys are marked inline; composite keys are
            // declared in the table extras below.
            if (meta.pks.length === 1 && meta.pks[0] === col.column_name) {
                builder = (builder as unknown as { primaryKey(): PgColumnBuilderBase }).primaryKey();
            }

            columns[col.column_name] = builder;
        }

        const isComposite = meta.pks.length > 1;
        tables[tableName] = createTable(
            tableName,
            columns,
            isComposite
                ? (t) => [primaryKey({ columns: meta.pks.map((pk) => t[pk]) as never })]
                : undefined
        );
    }

    return tables;
}
