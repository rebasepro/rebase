/**
 * The DEFAULTs `db push` keeps because a property says the database owns them.
 *
 * `databaseDefault: true` declares a DEFAULT somebody else wrote: a DBA's
 * `now()`, a migration's `'X-' || gen_random_uuid()`. The planner writes no
 * DEFAULT for it, since it has no expression to write. Copy the live DEFAULT
 * into the push input so Ptah keeps it, including defaults that reference a
 * sequence or a function the database already holds.
 */
import { declaredDatabaseExtensions, type CompiledTable } from "@rebasepro/types";
import { databaseOwnsDefault } from "@rebasepro/common";
import { planSchema } from "./plan/plan-schema";
import type { Queryable } from "./ensure-tables";

/** A column whose DEFAULT the tables leave to the database. */
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
 * Every column declared `.dbDefault()` that the planner writes no DEFAULT
 * for. A key strategy or a stamp writes one of its own, and that one is the
 * planner's to keep.
 */
export function databaseOwnedDefaultColumns(tables: readonly CompiledTable[]): DatabaseOwnedDefaultColumn[] {
    const declared = new Map(tables
        .map(table => [table.descriptor.slug, table.descriptor.columns.filter(databaseOwnsDefault)] as const)
        .filter(([, columns]) => columns.length > 0));
    if (declared.size === 0) return [];

    const plan = planSchema(tables, { databaseExtensions: declaredDatabaseExtensions() });
    const found: DatabaseOwnedDefaultColumn[] = [];
    for (const table of plan.tables) {
        const owned = table.slug ? declared.get(table.slug) : undefined;
        if (!owned) continue;
        for (const { column: name } of owned) {
            const column = table.columns.find(each => each.column === name);
            if (!column || column.default || column.generated) continue;
            found.push({ schema: table.schema, table: table.table, column: name });
        }
    }
    return found;
}

/**
 * Every column DEFAULT outside the system schemas.
 *
 * Rendered with only `pg_catalog` on the search path, so anything outside it
 * comes back schema-qualified and reads the same in whichever database
 * `schema.sql` is loaded into.
 */
const LIVE_DEFAULTS_SQL = `
    SELECT n.nspname AS "schema",
           c.relname AS "table",
           a.attname AS "column",
           pg_get_expr(d.adbin, d.adrelid) AS "expression"
    FROM pg_attrdef d
    JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    JOIN pg_class c ON c.oid = d.adrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE NOT a.attisdropped
      AND a.attgenerated = ''
      AND n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND n.nspname NOT LIKE 'pg\\_%'
`;

/**
 * The live DEFAULTs of `columns` that the desired state must carry so Ptah
 * plans no `DROP DEFAULT`.
 *
 * Read in a transaction of its own, so the search path it narrows goes back
 * when it ends.
 */
export async function readKeptDefaults(client: Queryable, columns: DatabaseOwnedDefaultColumn[]): Promise<KeptDefault[]> {
    if (columns.length === 0) return [];
    const wanted = new Set(columns.map(keyOf));
    let rows: KeptDefault[];
    await client.query("BEGIN READ ONLY");
    try {
        await client.query("SET LOCAL search_path TO pg_catalog");
        rows = (await client.query<KeptDefault>(LIVE_DEFAULTS_SQL)).rows;
    } finally {
        await client.query("ROLLBACK");
    }
    return rows
        .filter(row => wanted.has(keyOf(row)) && row.expression)
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
