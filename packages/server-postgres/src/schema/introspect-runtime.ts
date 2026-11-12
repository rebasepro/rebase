/**
 * Runtime introspection — what a backend with no `backend/schema` serves.
 *
 * `introspectTables` (`./introspect-tables`) describes every protected table
 * of the database as a `TableDescriptor`; this module turns those into what
 * the request-time code still reads — collections, lowered at the same
 * boundary a declared table crosses at boot — and reads the catalogue the
 * runtime builds its Drizzle tables from (`introspectSchema`, shared with the
 * declared path in `catalogue-schema.ts`).
 *
 * Distinct from `introspect-db.ts`, which describes the same database with
 * `describeTables(…, { purpose: "generate" })` and prints the descriptors as
 * `backend/schema` source for a developer to edit and commit.
 */
import type { PostgresCollectionConfig, TableDescriptor } from "@rebasepro/types";
import { isSchemaDefinitionError, lowerTables, tableDefsFromDescriptors } from "@rebasepro/common";

import {
    TableRow,
    TableColumn,
    EnumValue,
    PrimaryKeyRow,
    ForeignKeyRow,
    TableMeta,
    buildTablesMap,
    buildEnumMap,
    identifyJoinTables
} from "./introspect-db-logic";

export interface IntrospectedSchema {
    tablesMap: Map<string, TableMeta>;
    enumMap: Map<string, string[]>;
    joinTables: Set<string>;
}

/** Minimal query surface — satisfied by pg.Client and pg.Pool alike. */
export interface Queryable {
    query<R>(text: string, values?: unknown[]): Promise<{ rows: R[] }>;
}

/**
 * Read tables, columns, enums, primary keys and foreign keys for a schema.
 * Mirrors the queries in introspect-db.ts.
 */
export async function introspectSchema(
    client: Queryable,
    pgSchema: string,
    /**
     * Read views and materialized views too, as tables to read from — what
     * the runtime catalogue needs for collections that declare `view`. Off
     * for introspection that turns relations into collections, where a view
     * is not one.
     */
    options: { views?: boolean } = {}
): Promise<IntrospectedSchema> {
    const { rows: tables } = await client.query<TableRow>(
        `SELECT table_name
         FROM information_schema.tables
         WHERE table_schema = $1 AND table_type ${options.views ? "IN ('BASE TABLE', 'VIEW')" : "= 'BASE TABLE'"}
           AND table_name NOT LIKE 'drizzle_%'
           AND table_name NOT LIKE 'rebase_%'
         ${options.views ? `UNION
         SELECT c.relname AS table_name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = $1 AND c.relkind = 'm'
           AND COALESCE(obj_description(c.oid, 'pg_class'), '') NOT LIKE 'rebase:view-rows:%'` : ""}
         ORDER BY table_name`,
        [pgSchema]
    );

    const { rows: columns } = await client.query<TableColumn>(
        `SELECT
            c.table_name,
            c.column_name,
            c.data_type,
            c.udt_name,
            c.is_nullable,
            c.column_default,
            -- A stored generated column must be declared as one, or drizzle
            -- writes DEFAULT into it on every INSERT. Postgres tolerates that
            -- today; the generated module has always declared them properly,
            -- and the runtime tables are built to match it.
            c.is_generated,
            c.generation_expression,
            (SELECT a.atttypmod FROM pg_attribute a
             JOIN pg_class pc ON a.attrelid = pc.oid
             WHERE pc.relname = c.table_name
               AND a.attname = c.column_name
               AND pc.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = c.table_schema)) as atttypmod
         FROM information_schema.columns c
         WHERE c.table_schema = $1
           -- A table has no column of that name (it is a system column); the
           -- gate of a materialized view carries one for fingerprint(), and it
           -- is not the collection's.
           AND NOT (c.column_name = 'xmin' AND EXISTS (
               SELECT 1 FROM information_schema.views v
               WHERE v.table_schema = c.table_schema AND v.table_name = c.table_name))
         ${options.views ? `UNION ALL
         -- A materialized view is in neither information_schema.tables nor
         -- .columns: its columns, in the same shape, from the catalogue.
         SELECT c.relname, a.attname,
                CASE WHEN t.typcategory = 'A' THEN 'ARRAY' WHEN t.typtype = 'e' THEN 'USER-DEFINED'
                     ELSE format_type(a.atttypid, NULL) END,
                t.typname, CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END, NULL, 'NEVER', NULL, a.atttypmod
         FROM pg_attribute a
         JOIN pg_class c ON c.oid = a.attrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_type t ON t.oid = a.atttypid
         WHERE n.nspname = $1 AND c.relkind = 'm' AND a.attnum > 0 AND NOT a.attisdropped
           AND COALESCE(obj_description(c.oid, 'pg_class'), '') NOT LIKE 'rebase:view-rows:%'` : ""}`,
        [pgSchema]
    );

    const { rows: enumValues } = await client.query<EnumValue>(
        `SELECT t.typname AS enum_name,
                e.enumlabel AS enum_value,
                e.enumsortorder AS sort_order
         FROM pg_type t
         JOIN pg_enum e ON t.oid = e.enumtypid
         JOIN pg_namespace n ON t.typnamespace = n.oid
         WHERE n.nspname = $1
         ORDER BY t.typname, e.enumsortorder`,
        [pgSchema]
    );

    const { rows: pks } = await client.query<PrimaryKeyRow>(
        `SELECT t.relname as table_name, a.attname as column_name
         FROM   pg_index i
         JOIN   pg_attribute a ON a.attrelid = i.indrelid
                             AND a.attnum = ANY(i.indkey)
         JOIN   pg_class t ON t.oid = i.indrelid
         JOIN   pg_namespace n ON n.oid = t.relnamespace
         WHERE  i.indisprimary AND n.nspname = $1`,
        [pgSchema]
    );

    const { rows: fks } = await client.query<ForeignKeyRow>(
        `SELECT
            tc.table_name,
            kcu.column_name,
            ccu.table_name AS foreign_table_name,
            ccu.column_name AS foreign_column_name
         FROM information_schema.table_constraints AS tc
         JOIN information_schema.key_column_usage AS kcu
           ON tc.constraint_name = kcu.constraint_name
           AND tc.table_schema = kcu.table_schema
         JOIN information_schema.constraint_column_usage AS ccu
           ON ccu.constraint_name = tc.constraint_name
           AND ccu.table_schema = tc.table_schema
         WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = $1`,
        [pgSchema]
    );

    const tablesMap = buildTablesMap(tables, columns, pks, fks);
    return {
        tablesMap,
        enumMap: buildEnumMap(enumValues),
        joinTables: identifyJoinTables(tablesMap)
    };
}

/**
 * What {@link lowerIntrospectedTables} returns.
 *
 * @group Schema
 */
export interface LoweredIntrospection {
    /** The descriptors served — every one given, unless it is in {@link dropped}. */
    tables: TableDescriptor[];
    /** The request-time collections, one per descriptor of {@link tables}, in the same order. */
    collections: PostgresCollectionConfig[];
    /**
     * Descriptors no collection could be lowered from, each with why: a table
     * `defineTable` itself refuses (no columns, a schema name that is not a plain
     * identifier). They are not served; the relations into them are dropped.
     */
    dropped: { table: string; reason: string }[];
}

/** A descriptor without its relations into `removed`; a foreign-key column such a relation held becomes a plain column. */
function withoutRelationsInto(descriptor: TableDescriptor, removed: ReadonlySet<string>): TableDescriptor {
    const gone = descriptor.relations.filter(relation => removed.has(relation.target));
    if (gone.length === 0) return descriptor;
    const goneNames = new Set(gone.map(relation => relation.name));
    return {
        ...descriptor,
        relations: descriptor.relations.filter(relation => !goneNames.has(relation.name)),
        columns: descriptor.columns.map(column => {
            if (column.foreignKeyOf === undefined || !goneNames.has(column.foreignKeyOf)) return column;
            const { foreignKeyOf: _foreignKeyOf, derived: _derived, ...plain } = column;
            return plain;
        })
    };
}

/**
 * The collections an introspected database is served through.
 *
 * Each descriptor becomes a definition (`tableDefsFromDescriptors`) and is
 * lowered (`lowerTables`, with `introspected: true` so a `{ kind: "other" }`
 * column passes its value through). The definitions carry `rls: "admin-only"`,
 * which lowers to no rule at all: Rebase generates no policy for a table it did
 * not declare, and the request-time code reads none — the database's own
 * policies decide every row, as they always have. The descriptors keep stating
 * those policies for `GET /api/schema/tables`.
 *
 * Never throws for one table: a descriptor that cannot be lowered is dropped
 * and named in {@link LoweredIntrospection.dropped}, and the rest are served.
 *
 * @group Schema
 */
export function lowerIntrospectedTables(tables: readonly TableDescriptor[]): LoweredIntrospection {
    const dropped: LoweredIntrospection["dropped"] = [];
    let remaining = [...tables];
    for (;;) {
        try {
            const bySlug = new Map(remaining.map(table => [table.slug, table]));
            const defs = tableDefsFromDescriptors(remaining, { rls: () => "admin-only" });
            const collections = lowerTables(defs, { introspected: true, describe: slug => bySlug.get(slug) });
            return { tables: remaining, collections, dropped };
        } catch (error) {
            if (!isSchemaDefinitionError(error)) throw error;
            const reasons = new Map<string, string[]>();
            for (const problem of error.problems) {
                const table = remaining.find(candidate => candidate.name === problem.table || candidate.slug === problem.table);
                if (!table) continue;
                reasons.set(table.slug, [...(reasons.get(table.slug) ?? []), problem.key ? `${problem.key}: ${problem.message}` : problem.message]);
            }
            if (reasons.size === 0) throw error;
            for (const [table, list] of reasons) dropped.push({ table, reason: list.join("; ") });
            const removed = new Set(reasons.keys());
            remaining = remaining.filter(table => !removed.has(table.slug)).map(table => withoutRelationsInto(table, removed));
        }
    }
}
