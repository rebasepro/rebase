import type { PgTable, AnyPgColumn } from "drizzle-orm/pg-core";

/** Drizzle PgTable with column access by name. Runtime Drizzle tables satisfy this shape. */
export type RebasePgTable = PgTable & Record<string, AnyPgColumn>;

/**
 * Read a statically-declared drizzle table as one whose columns are looked up
 * by name.
 *
 * The auth services take either the tables this package declares or a host
 * application's own, and reach their columns through strings — `has("aal")`,
 * `col("sessionId")` — because which columns exist is a property of the
 * database in front of them, not of the schema this package compiled against.
 * That is what {@link RebasePgTable} is for.
 *
 * A concrete table does not satisfy it: its columns have specific types and it
 * carries methods and symbols besides, so `Record<string, AnyPgColumn>` is not
 * a supertype and a direct `as` is refused. Written out, that refusal was
 * answered six times with `as unknown as RebasePgTable`, which also discarded
 * the check that the thing being converted is a table at all — the parameter
 * below is what restores it.
 */
export function asRebasePgTable(table: PgTable): RebasePgTable {
    return table as RebasePgTable;
}
