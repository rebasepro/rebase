/**
 * The columns a caller may not read, taken out of what their SQL returned.
 *
 * Per-field read rules (`access.read`, and `excludeFromApi`, which is
 * `read: []`) are not something Postgres can hold for one request role shared
 * by every user, so the SDK applies them to each row it serves
 * (`stripUnreadable`). SQL run as the caller (`DataDriver.sql`) returns rows
 * the SDK never walked — and `SELECT *` from a users table would hand over the
 * password hash.
 *
 * Postgres says where each result column came from: the row description
 * carries the table's oid and the column's number for every column that is a
 * plain reference to one, aliased or not, `RETURNING` included. A column whose
 * origin is a collection property this caller cannot read is dropped from
 * every row, the way the API drops it.
 *
 * What it cannot see is a value computed from such a column — `md5(hash)`,
 * `hash || ''` — whose origin Postgres reports as none. That is the query
 * text's business, and the query text is the application's (see
 * `caller-sql.ts`).
 *
 * A driver that reports no origins at all (PGlite) has its result columns
 * matched by name instead, against every restricted column of every
 * collection: it may drop a column of the same name from another table, never
 * keep one it should drop.
 */
import { getTableName, hasFieldAccessRules, restrictedFieldNames, type FieldViewer } from "@rebasepro/common";
import { isPostgresCollectionConfig, type CollectionConfig } from "@rebasepro/types";

/** A result column as the driver describes it. */
export interface ResultField {
    name: string;
    /** The originating table's oid; 0 for a computed column. Absent when the driver does not say (PGlite). */
    tableID?: number;
    /** The originating column's number within it. */
    columnID?: number;
}

/** The columns of a result, from a pg `QueryResult` (or the last of several). */
export function fieldsOfResult(result: unknown): ResultField[] {
    const last = Array.isArray(result) ? result[result.length - 1] : result;
    if (typeof last !== "object" || last === null || !("fields" in last)) return [];
    const fields = (last as { fields: unknown }).fields;
    if (!Array.isArray(fields)) return [];
    return fields.flatMap((field: unknown) => {
        if (typeof field !== "object" || field === null || !("name" in field)) return [];
        const { name, tableID, columnID } = field as { name: unknown; tableID?: unknown; columnID?: unknown };
        return [{
            name: String(name),
            ...(typeof tableID === "number" ? { tableID } : {}),
            ...(typeof columnID === "number" ? { columnID } : {})
        }];
    });
}

type CatalogueRunner = (text: string, params: unknown[]) => Promise<Record<string, unknown>[]>;

interface Relation {
    schema: string;
    name: string;
    /** `attnum` → `attname`. */
    columns: Map<number, string>;
}

/**
 * The relations result columns came from, by oid, read from the catalogue the
 * first time an oid is seen. An oid never changes meaning: a table that is
 * dropped and created again gets a new one, which is read when it appears.
 */
export class ColumnOrigins {
    private readonly relations = new Map<number, Relation | null>();

    async describe(oids: number[], run: CatalogueRunner): Promise<Map<number, Relation | null>> {
        const unseen = [...new Set(oids)].filter(oid => !this.relations.has(oid));
        if (unseen.length > 0) {
            const rows = await run(
                `SELECT c.oid::int AS oid, n.nspname AS schema, c.relname AS name, a.attnum::int AS attnum, a.attname AS column
                 FROM pg_class c
                 JOIN pg_namespace n ON n.oid = c.relnamespace
                 JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
                 WHERE c.oid = ANY($1::oid[])`,
                [unseen]
            );
            for (const oid of unseen) this.relations.set(oid, null);
            for (const row of rows) {
                const oid = Number(row.oid);
                let relation = this.relations.get(oid);
                if (!relation) {
                    relation = { schema: String(row.schema), name: String(row.name), columns: new Map() };
                    this.relations.set(oid, relation);
                }
                relation.columns.set(Number(row.attnum), String(row.column));
            }
        }
        return new Map(oids.map(oid => [oid, this.relations.get(oid) ?? null]));
    }
}

const schemaOf = (collection: CollectionConfig): string =>
    (isPostgresCollectionConfig(collection) && collection.schema) || "public";

/**
 * `rows` without the columns `viewer` may not read, by the origins `fields`
 * describe. The rows are changed in place and returned.
 */
export async function withoutUnreadableColumns(
    rows: Record<string, unknown>[],
    fields: ResultField[],
    viewer: FieldViewer,
    collections: CollectionConfig[],
    origins: ColumnOrigins,
    run: CatalogueRunner
): Promise<Record<string, unknown>[]> {
    const restricted = collections.filter(hasFieldAccessRules);
    if (restricted.length === 0 || rows.length === 0 || fields.length === 0) return rows;

    const refusedBy = new Map<string, Set<string>>();
    for (const collection of restricted) {
        const { refused } = restrictedFieldNames(collection, viewer, "read");
        if (refused.size > 0) refusedBy.set(`${schemaOf(collection)}.${getTableName(collection)}`, refused);
    }
    if (refusedBy.size === 0) return rows;

    const drop = new Set<string>();
    if (fields.every(field => field.tableID === undefined)) {
        const everyRefused = new Set([...refusedBy.values()].flatMap(names => [...names]));
        for (const field of fields) if (everyRefused.has(field.name)) drop.add(field.name);
    } else {
        const fromTables = fields.filter(field => field.tableID && field.columnID);
        const relations = await origins.describe(fromTables.map(field => field.tableID!), run);
        for (const field of fromTables) {
            const relation = relations.get(field.tableID!);
            const column = relation?.columns.get(field.columnID!);
            if (relation && column && refusedBy.get(`${relation.schema}.${relation.name}`)?.has(column)) drop.add(field.name);
        }
    }
    if (drop.size === 0) return rows;
    for (const row of rows) for (const name of drop) delete row[name];
    return rows;
}
