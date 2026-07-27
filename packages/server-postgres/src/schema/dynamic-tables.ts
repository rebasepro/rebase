/**
 * Build drizzle tables at runtime from an introspected schema.
 *
 * A project with declared collections gets its drizzle tables from a generated `schema.generated.ts` that
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
    char,
    cidr,
    customType,
    date,
    doublePrecision,
    geometry,
    inet,
    integer,
    interval,
    json,
    jsonb,
    line,
    macaddr,
    macaddr8,
    numeric,
    pgSchema,
    pgTable,
    point,
    primaryKey,
    real,
    smallint,
    text,
    time,
    timestamp,
    uuid,
    varchar,
    vector,
    type PgColumnBuilderBase,
    type PgTable
} from "drizzle-orm/pg-core";

import { relations, type Relations } from "drizzle-orm";

import type { TableColumn, TableMeta } from "./introspect-db-logic";

/** drizzle ships no bytea builder; binary must round-trip as a Buffer. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
    dataType: () => "bytea"
});

/**
 * Postgres stores a column's type modifier (varchar length, vector dimensions)
 * in `atttypmod`. For length-carrying string types it is length + VARHDRSZ(4);
 * for pgvector it is the dimension count as-is. -1 means unspecified.
 */
function varlenLength(col: TableColumn): number | undefined {
    return col.atttypmod && col.atttypmod > 4 ? col.atttypmod - 4 : undefined;
}

/**
 * Map a Postgres type to a drizzle column builder, keyed on `udt_name` — the
 * concrete underlying type, which is exact where `data_type` reports umbrella
 * values like "ARRAY" or "USER-DEFINED".
 *
 * Unknown types fall back to `text`: the driver still reads and writes them,
 * with the value passing through as a string, which beats dropping the column.
 */
function scalarBuilder(udtName: string, name: string, col: TableColumn): PgColumnBuilderBase {
    switch (udtName) {
        case "uuid":
            return uuid(name);
        case "bool":
            return boolean(name);
        case "int2":
            return smallint(name);
        case "int4":
            return integer(name);
        case "int8":
            return bigint(name, { mode: "number" });
        case "float4":
            return real(name);
        case "float8":
            return doublePrecision(name);
        case "numeric":
        case "money":
            return numeric(name);
        case "json":
            return json(name);
        case "jsonb":
            return jsonb(name);
        case "date":
            return date(name);
        case "time":
            return time(name);
        case "timetz":
            return time(name, { withTimezone: true });
        case "timestamp":
            return timestamp(name);
        case "timestamptz":
            return timestamp(name, { withTimezone: true });
        case "interval":
            return interval(name);
        case "bytea":
            return bytea(name);
        case "inet":
            return inet(name);
        case "cidr":
            return cidr(name);
        case "macaddr":
            return macaddr(name);
        case "macaddr8":
            return macaddr8(name);
        case "point":
            return point(name);
        case "line":
            return line(name);
        case "geometry":
            return geometry(name);
        case "vector": {
            // drizzle requires the dimension count; without it fall back to text
            // rather than declaring a vector of unknown width.
            const dimensions = col.atttypmod && col.atttypmod > 0 ? col.atttypmod : undefined;
            return dimensions ? vector(name, { dimensions }) : text(name);
        }
        case "bpchar": {
            const length = varlenLength(col);
            return length ? char(name, { length }) : char(name);
        }
        case "varchar": {
            const length = varlenLength(col);
            return length ? varchar(name, { length }) : text(name);
        }
        default:
            // Includes text, enums (pg enums are strings on the wire), citext,
            // geography, and anything else this driver hasn't met yet.
            return text(name);
    }
}

function columnBuilderFor(col: TableColumn): PgColumnBuilderBase {
    // Array types are named after their element with a leading underscore
    // (_int4 = int4[]), so the element mapping is reused verbatim.
    if (col.udt_name.startsWith("_")) {
        const element = scalarBuilder(col.udt_name.slice(1), col.column_name, col);
        return (element as unknown as { array(): PgColumnBuilderBase }).array();
    }
    return scalarBuilder(col.udt_name, col.column_name, col);
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

/**
 * Build drizzle `relations()` for the foreign keys, so the relational query
 * path can actually load them.
 *
 * FetchService asks drizzle for `with: { <key>: true }`, keyed by the relation
 * property on the collection. Tables alone don't satisfy that — without these,
 * `?include=author` silently returns the raw `author_id` and no author.
 *
 * The keys here must match `buildRelations` in introspect-runtime.ts, which is
 * what names the collection's relation properties.
 */
export function buildDrizzleRelationsFromSchema(
    tablesMap: Map<string, TableMeta>,
    tables: Record<string, PgTable>
): Record<string, Relations> {
    /** Owning side, per table: the `one()` relations from its foreign keys. */
    const owning = new Map<string, { key: string; targetTable: string; fkColumn: string; targetColumn: string; relationName: string }[]>();
    /** Inverse side, per referenced table: the matching `many()` back-references. */
    const inverse = new Map<string, { key: string; sourceTable: string; relationName: string }[]>();

    for (const [tableName, meta] of tablesMap) {
        if (!tables[tableName]) continue;
        const columnNames = new Set(meta.columns.map((c) => c.column_name));

        for (const fk of meta.fks) {
            if (!tables[fk.foreign_table_name]) continue;

            // Mirrors buildRelations in introspect-runtime: author_id -> author,
            // falling back to the target table when the column name carries no hint.
            let key = fk.column_name.replace(/_id$/, "");
            if (meta.pks.includes(fk.column_name) && key === fk.column_name) {
                key = fk.foreign_table_name;
            }
            // A relation key must not shadow a real column.
            if (columnNames.has(key)) continue;

            // Pairs the two sides. Drizzle matches a named one() to the many()
            // carrying the same name, and disambiguates multiple foreign keys
            // into the same table.
            const relationName = `${tableName}_${fk.column_name}`;

            owning.set(tableName, [
                ...(owning.get(tableName) ?? []),
                { key, targetTable: fk.foreign_table_name, fkColumn: fk.column_name, targetColumn: fk.foreign_column_name, relationName }
            ]);

            const backKey = tableName;
            const targetColumns = new Set((tablesMap.get(fk.foreign_table_name)?.columns ?? []).map((c) => c.column_name));
            if (targetColumns.has(backKey)) continue;

            inverse.set(fk.foreign_table_name, [
                ...(inverse.get(fk.foreign_table_name) ?? []),
                { key: backKey, sourceTable: tableName, relationName }
            ]);
        }
    }

    const built: Record<string, Relations> = {};

    for (const tableName of tablesMap.keys()) {
        const table = tables[tableName];
        const ones = owning.get(tableName) ?? [];
        const manys = inverse.get(tableName) ?? [];
        if (!table || (ones.length === 0 && manys.length === 0)) continue;

        built[`${tableName}Relations`] = relations(table, ({ one, many }) => {
            const map: Record<string, unknown> = {};

            for (const rel of ones) {
                map[rel.key] = one(tables[rel.targetTable], {
                    fields: [(table as unknown as Record<string, never>)[rel.fkColumn]],
                    references: [(tables[rel.targetTable] as unknown as Record<string, never>)[rel.targetColumn]],
                    relationName: rel.relationName
                });
            }

            // Drizzle needs the inverse of every named one(); without it,
            // normalizeRelation throws and the relational path is dead.
            for (const rel of manys) {
                // An inverse must not collide with an owning key on this table.
                if (map[rel.key]) continue;
                map[rel.key] = many(tables[rel.sourceTable], { relationName: rel.relationName });
            }

            return map as never;
        });
    }

    return built;
}
