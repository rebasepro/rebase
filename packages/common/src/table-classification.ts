/**
 * Table Classification
 *
 * Shared constants and pure functions for classifying database tables.
 * Used by both the server-side PostgresBackendDriver and the Studio RLS editor.
 */

import { REBASE_INTERNAL_TABLES } from "./util/internal-tables";

/** Possible categories a database table can belong to. */
export type TableCategory = "rebase-internal" | "junction" | "user";

/** Schemas that are always considered Rebase-internal. */
export const REBASE_INTERNAL_SCHEMAS: readonly string[] = ["rebase", "auth"];

/** Table-name prefixes that mark a table as Rebase-internal regardless of schema. */
export const REBASE_INTERNAL_PREFIXES: readonly string[] = [
  "_rebase_",
  "_auth_",
  "drizzle_",
];

/**
 * Synchronously classify a table based on naming conventions.
 *
 * @param tableName  - The unqualified name of the table.
 * @param schemaName - The schema the table belongs to (e.g. `"public"`, `"rebase"`).
 * @returns `"rebase-internal"` when the table belongs to a reserved schema or
 *          carries a reserved prefix; `"user"` otherwise.
 *
 * @remarks
 * Junction-table detection requires an async database query and is therefore
 * **not** handled by this function. Use {@link detectJunctionTables} to obtain
 * the set of junction tables, then reclassify as needed.
 */
/** The schema Rebase puts both its own tables and the tenant's collections in. */
const REBASE_SCHEMA = "rebase";

/**
 * Rebase's own tables, by unqualified name.
 *
 * Reused from `util/internal-tables`, which maintains it for the privilege
 * revoke — rather than a second list here, which would be a second thing to
 * keep true. It already excludes `users` for the reason that matters to this
 * function too: the auth user table is also a collection, with RLS and
 * policies, and hiding it would hide the one table almost every policy
 * references.
 *
 * That list is deliberately willing to claim common nouns — `jobs`, `branches`,
 * `api_keys` — because its own caller re-checks each against `relrowsecurity`.
 * This function has no such signal, so the layer above supplies it: a table the
 * project MAPS to a collection is classified as the customer's before this is
 * consulted at all.
 */
const INTERNAL_TABLE_NAMES: ReadonlySet<string> = new Set(REBASE_INTERNAL_TABLES);

export function classifyTable(
  tableName: string,
  schemaName: string,
): TableCategory {
  if (REBASE_INTERNAL_PREFIXES.some((prefix) => tableName.startsWith(prefix))) {
    return "rebase-internal";
  }

  // Shared ground: Rebase's plumbing and the customer's collections both live
  // here, so the NAME decides, not the schema.
  if (schemaName === REBASE_SCHEMA) {
    return INTERNAL_TABLE_NAMES.has(tableName) ? "rebase-internal" : "user";
  }

  if (REBASE_INTERNAL_SCHEMAS.includes(schemaName)) {
    return "rebase-internal";
  }

  return "user";
}

/**
 * Convenience predicate that checks whether a table is Rebase-internal.
 *
 * @param tableName  - The unqualified name of the table.
 * @param schemaName - The schema the table belongs to.
 * @returns `true` if the table is classified as `"rebase-internal"`.
 */
export function isRebaseInternalTable(
  tableName: string,
  schemaName: string,
): boolean {
  return classifyTable(tableName, schemaName) === "rebase-internal";
}

/** SQL query that detects junction tables in the `public` schema. */
export const JUNCTION_TABLES_SQL = `
  SELECT t.table_name
  FROM information_schema.tables t
  WHERE t.table_schema = 'public'
    AND t.table_type = 'BASE TABLE'
    AND NOT EXISTS (
      SELECT 1
      FROM information_schema.columns c
      WHERE c.table_schema = t.table_schema
        AND c.table_name = t.table_name
        AND c.column_name NOT IN (
          SELECT kcu.column_name
          FROM information_schema.key_column_usage kcu
          JOIN information_schema.table_constraints tc
            ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
          WHERE tc.constraint_type = 'FOREIGN KEY'
            AND kcu.table_schema = t.table_schema
            AND kcu.table_name = t.table_name
        )
    )
`;

/**
 * Asynchronously detect junction (link) tables in the `public` schema.
 *
 * A junction table is defined as a table where **every** column participates in
 * at least one foreign-key constraint.
 *
 * @param executeSql - A callback that executes a raw SQL string and returns the
 *                     resulting rows.
 * @returns A `Set` containing the names of all detected junction tables.
 */
export async function detectJunctionTables(
  executeSql: (sql: string) => Promise<Record<string, unknown>[]>,
): Promise<Set<string>> {
  const rows = await executeSql(JUNCTION_TABLES_SQL);
  const junctionTables = new Set<string>();

  for (const row of rows) {
    if (typeof row.table_name === "string") {
      junctionTables.add(row.table_name);
    }
  }

  return junctionTables;
}
