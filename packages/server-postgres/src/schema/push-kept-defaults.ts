/**
 * The DEFAULTs `db push` keeps because a property says the database owns them.
 *
 * `databaseDefault: true` declares a DEFAULT somebody else wrote: a DBA's
 * `now()`, a migration's `'X-' || gen_random_uuid()`. The planner writes no
 * DEFAULT for it, since it has no expression to write, so `schema.sql` holds
 * the column without one. Atlas reads that file as the whole desired state and
 * planned `ALTER COLUMN … DROP DEFAULT`. The API kept letting creates through
 * without the field, and the database then refused them on NOT NULL.
 *
 * Atlas has no way to leave one column's DEFAULT alone: `--exclude` names
 * objects, and a DEFAULT is not one. So the desired state is made to agree with
 * the database instead. Before Atlas plans, the live DEFAULT of each such
 * column is read and appended to `schema.sql` as `ALTER TABLE … SET DEFAULT`,
 * and Atlas finds nothing to change.
 *
 * Two kinds are left out, because Atlas already does something else with them:
 *
 * - a DEFAULT reading a sequence (`nextval(…)`). Atlas does not manage
 *   sequences and leaves those DEFAULTs alone, and the sequence does not exist
 *   in the scratch database Atlas loads `schema.sql` into.
 * - a DEFAULT calling a function or operator the database defines (an
 *   extension's `uuid_generate_v4()`, a project's own function). The scratch
 *   database has none of them, and Atlas refuses such a column whether or not
 *   it is in `schema.sql`; adding it would only change the error.
 */
import { declaredDatabaseExtensions, type CollectionConfig, type Property } from "@rebasepro/types";
import { planSchema } from "./plan/plan-schema";
import { resolveColumnName } from "./column-plan-helpers";
import type { Queryable } from "./ensure-collection-tables";

/** A column whose DEFAULT the collections leave to the database. */
export interface DatabaseOwnedDefaultColumn {
    schema: string;
    table: string;
    column: string;
}

/** A DEFAULT the database holds for one of those columns, as SQL. */
export interface KeptDefault extends DatabaseOwnedDefaultColumn {
    expression: string;
}

/**
 * Every column declared `databaseDefault: true` that the planner writes no
 * DEFAULT for. An id strategy or `autoValue` writes one of its own, and that
 * one is the planner's to keep.
 */
export function databaseOwnedDefaultColumns(collections: CollectionConfig[]): DatabaseOwnedDefaultColumn[] {
    const declared = collections.filter(collection =>
        Object.values(collection.properties ?? {}).some(prop => isDatabaseOwned(prop)));
    if (declared.length === 0) return [];

    const plan = planSchema(collections, { databaseExtensions: declaredDatabaseExtensions() });
    const found: DatabaseOwnedDefaultColumn[] = [];
    for (const table of plan.tables) {
        const collection = declared.find(each => each.slug === table.slug);
        if (!collection) continue;
        for (const [key, prop] of Object.entries(collection.properties ?? {})) {
            if (!isDatabaseOwned(prop)) continue;
            const name = resolveColumnName(key, prop);
            const column = table.columns.find(each => each.column === name);
            if (!column || column.default || column.generated) continue;
            found.push({ schema: table.schema, table: table.table, column: name });
        }
    }
    return found;
}

const isDatabaseOwned = (prop: unknown): prop is Property =>
    typeof prop === "object" && prop !== null &&
    (prop as { databaseDefault?: unknown }).databaseDefault === true;

/**
 * Every column DEFAULT outside the system schemas, and whether Atlas can carry
 * it (see the module comment for the two it cannot).
 *
 * Rendered with only `pg_catalog` on the search path, so anything outside it
 * comes back schema-qualified and reads the same in whichever database
 * `schema.sql` is loaded into.
 */
const LIVE_DEFAULTS_SQL = `
    SELECT n.nspname AS "schema",
           c.relname AS "table",
           a.attname AS "column",
           pg_get_expr(d.adbin, d.adrelid) AS "expression",
           EXISTS (
               SELECT 1
               FROM pg_depend dep
               WHERE dep.classid = 'pg_attrdef'::regclass
                 AND dep.objid = d.oid
                 AND (
                     (dep.refclassid = 'pg_class'::regclass
                         AND EXISTS (SELECT 1 FROM pg_class s WHERE s.oid = dep.refobjid AND s.relkind = 'S'))
                     OR (dep.refclassid IN ('pg_proc'::regclass, 'pg_operator'::regclass)
                         AND dep.refobjid >= 16384)
                 )
           ) AS "uncarried"
    FROM pg_attrdef d
    JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    JOIN pg_class c ON c.oid = d.adrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE NOT a.attisdropped
      AND a.attgenerated = ''
      AND n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND n.nspname NOT LIKE 'pg\\_%'
`;

interface LiveDefaultRow extends KeptDefault {
    uncarried: boolean;
}

/**
 * The live DEFAULTs of `columns` that the desired state must carry so Atlas
 * plans no `DROP DEFAULT`. A column with no DEFAULT, or one Atlas cannot carry,
 * is not listed.
 *
 * Read in a transaction of its own, so the search path it narrows goes back
 * when it ends.
 */
export async function readKeptDefaults(client: Queryable, columns: DatabaseOwnedDefaultColumn[]): Promise<KeptDefault[]> {
    if (columns.length === 0) return [];
    const wanted = new Set(columns.map(keyOf));
    let rows: LiveDefaultRow[];
    await client.query("BEGIN READ ONLY");
    try {
        await client.query("SET LOCAL search_path TO pg_catalog");
        rows = (await client.query<LiveDefaultRow>(LIVE_DEFAULTS_SQL)).rows;
    } finally {
        await client.query("ROLLBACK");
    }
    return rows
        .filter(row => wanted.has(keyOf(row)) && !row.uncarried && row.expression)
        .map(({ schema, table, column, expression }) => ({ schema, table, column, expression }))
        .sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
}

const keyOf = (column: DatabaseOwnedDefaultColumn): string => `${column.schema}\u0000${column.table}\u0000${column.column}`;

const ident = (name: string): string => `"${name.replace(/"/g, "\"\"")}"`;

/** What is appended to `schema.sql`: one `SET DEFAULT` per kept DEFAULT. */
export function keptDefaultStatements(kept: KeptDefault[]): string[] {
    return kept.map(({ schema, table, column, expression }) =>
        `ALTER TABLE ${ident(schema)}.${ident(table)} ALTER COLUMN ${ident(column)} SET DEFAULT ${expression};`);
}

/** `schema.sql` with the kept DEFAULTs appended, under a comment saying why. */
export function withKeptDefaults(desiredSql: string, kept: KeptDefault[]): string {
    if (kept.length === 0) return desiredSql;
    return `${desiredSql.replace(/\s*$/, "\n")}\n` +
        "-- DEFAULTs the database holds for columns declared `databaseDefault: true`,\n" +
        "-- read before planning so the push leaves them as they are.\n" +
        `${keptDefaultStatements(kept).join("\n")}\n`;
}
