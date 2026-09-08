/**
 * Build drizzle tables at runtime from an introspected schema.
 *
 * **Every** data source's tables are built here, from `information_schema`,
 * after boot-ensure has run — a project with declared collections included. The
 * committed `schema.generated.ts` is a build artefact for Atlas, `db push`,
 * `eject` and user code; the runtime does not read it for its tables, because a
 * file that is one commit behind the database used to change what the server
 * served (a renamed foreign-key column 500'd every request, a lost relation
 * silently emptied a list). See `catalogue-schema.ts` for the caller.
 *
 * These are handed to drizzle as its schema, which keeps the relational query
 * path (`db.query.*`) working; without them FetchService would fall back to
 * plain selects and lose relation loading.
 *
 * Two things a caller has to supply for the tables to match what the generated
 * module used to produce, both about *names*: the Drizzle object is keyed by the
 * wire name of a column and not by the column (`authorId`, not `author_id`), and
 * a relation is keyed by the collection's own relation key rather than by a
 * guess made from the foreign key. Both come from the collections — see
 * `columnKeysFromCollections` and `buildDrizzleRelationsFromCollections`.
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

import { relations, sql, type Relations } from "drizzle-orm";
import { toWireKey } from "@rebasepro/utils";

import type { TableColumn, TableMeta } from "./introspect-db-logic";

/**
 * The Drizzle object key a column is served under, given its table.
 *
 * Defaults to the column name — right for a junction table and for a database
 * nothing declares — and is supplied from the collections wherever there is
 * one, because there the wire name is the property key. Every read and write
 * path in this driver indexes tables and rows by that key.
 */
export type ColumnKeyResolver = (tableName: string, columnName: string) => string;

const columnNameAsKey: ColumnKeyResolver = (_table, column) => column;

/** drizzle ships no bytea builder; binary must round-trip as a Buffer. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
    dataType: () => "bytea"
});

/**
 * A full-text search column, declared with its real SQL type.
 *
 * Not cosmetic: `isSearchIndexColumn` asks the column for its type and drops
 * every `tsvector` from the projection, so a search column that fell through to
 * `text` (the old default for an unrecognised type) would be selected, returned
 * to callers, and rendered in the admin as a wall of lexemes. drizzle ships no
 * builder for these two.
 */
const tsvector = customType<{ data: string; driverData: string }>({
    dataType: () => "tsvector"
});

const tsquery = customType<{ data: string; driverData: string }>({
    dataType: () => "tsquery"
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
        // `mode: "string"`, both of them, because that is what the generated
        // module declared for every `date` property: the value Postgres sent,
        // untouched. Drizzle's default mode is `date`, which parses it into a
        // `Date` — the same instant in a different shape, and a difference that
        // would have appeared only on the read path of a project that changed
        // nothing. (`parsePropertyFromServer` normalises either shape to an ISO
        // string for a declared `date` property, so what a REST caller sees is
        // the same; a raw `db.select()` is where the two differ.)
        case "timestamp":
            return timestamp(name, { mode: "string" });
        case "timestamptz":
            return timestamp(name, { withTimezone: true, mode: "string" });
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
        case "tsvector":
            return tsvector(name);
        case "tsquery":
            return tsquery(name);
        default:
            // Includes text, enums (pg enums are strings on the wire), citext,
            // geography, and anything else this driver hasn't met yet.
            //
            // An enum deliberately stays `text`, which is what the generated
            // module's `pgEnum` column also serves: drizzle does no runtime
            // validation of enum members either way, and Postgres rejects a
            // label it does not have. The difference is only in the type the
            // generated *types* carry, and those come from the collection.
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
 *
 * @param columnKey how a column is named on the wire — see {@link ColumnKeyResolver}.
 */
export function buildDrizzleTablesFromSchema(
    tablesMap: Map<string, TableMeta>,
    pgSchemaName = "public",
    columnKey: ColumnKeyResolver = columnNameAsKey
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
        const keyOf = new Map<string, string>();

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
            // A stored generated column must be left out of every INSERT, which
            // is what `.generatedAlwaysAs` tells drizzle. The expression is
            // carried through so a drizzle-kit run over these tables describes
            // the column it actually found; nothing at runtime evaluates it.
            if (col.is_generated === "ALWAYS") {
                builder = (builder as unknown as {
                    generatedAlwaysAs(expr: unknown): PgColumnBuilderBase
                }).generatedAlwaysAs(sql.raw(col.generation_expression ?? ""));
            }

            const key = columnKey(tableName, col.column_name);
            keyOf.set(col.column_name, key);
            columns[key] = builder;
        }

        const isComposite = meta.pks.length > 1;
        tables[tableName] = createTable(
            tableName,
            columns,
            isComposite
                ? (t) => [primaryKey({ columns: meta.pks.map((pk) => t[keyOf.get(pk) ?? pk]) as never })]
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
    tables: Record<string, PgTable>,
    columnKey: ColumnKeyResolver = columnNameAsKey
): Record<string, Relations> {
    /** Owning side, per table: the `one()` relations from its foreign keys. */
    const owning = new Map<string, { key: string; targetTable: string; fkColumn: string; targetColumn: string; relationName: string }[]>();
    /** Inverse side, per referenced table: the matching `many()` back-references. */
    const inverse = new Map<string, { key: string; sourceTable: string; relationName: string }[]>();

    for (const [tableName, meta] of tablesMap) {
        if (!tables[tableName]) continue;
        // The keys the table actually carries — what a relation key must not
        // collide with, since both live in one Drizzle object.
        const columnNames = new Set(meta.columns.map((c) => columnKey(tableName, c.column_name)));

        for (const fk of meta.fks) {
            if (!tables[fk.foreign_table_name]) continue;

            // Mirrors buildRelations in introspect-runtime: author_id -> author,
            // falling back to the target table when the column name carries no
            // hint. `toWireKey` for the same reason it is there — the two keys
            // must be the same string or the collection advertises a relation key
            // drizzle has never heard of (`author_ref` here, `authorRef` there).
            let key = toWireKey(fk.column_name.replace(/_id$/, ""));
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
                {
                    key,
                    targetTable: fk.foreign_table_name,
                    // The Drizzle keys, not the columns: `fields`/`references`
                    // index the built table objects, which are keyed by the
                    // wire name wherever a collection supplies one.
                    fkColumn: columnKey(tableName, fk.column_name),
                    targetColumn: columnKey(fk.foreign_table_name, fk.foreign_column_name),
                    relationName
                }
            ]);

            const backKey = tableName;
            const targetColumns = new Set(
                (tablesMap.get(fk.foreign_table_name)?.columns ?? [])
                    .map((c) => columnKey(fk.foreign_table_name, c.column_name))
            );
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
