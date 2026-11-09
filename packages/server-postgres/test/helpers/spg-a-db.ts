/**
 * Typed stand-ins for the database handles the unit tests drive.
 *
 * `spiedDrizzle()` is a real `NodePgDatabase` over a pool that never connects,
 * with `execute` replaced by a jest spy — so the code under test gets the
 * actual type it declares, and a test still decides what every statement
 * returns. `queryResult()` builds the full `pg` result a statement resolves to,
 * not the `{ rows }` fragment the code happens to read today.
 */
import { Pool, type QueryResult, type QueryResultRow } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";

/** A complete `pg` query result around `rows`. */
export function queryResult<R extends QueryResultRow = Record<string, unknown>>(
    rows: R[] = [],
    command = "SELECT"
): QueryResult<R> {
    return {
        command,
        rowCount: rows.length,
        oid: 0,
        fields: [],
        rows
    };
}

export interface SpiedDrizzle {
    db: NodePgDatabase;
    execute: jest.SpiedFunction<NodePgDatabase["execute"]>;
}

/**
 * A real drizzle database whose `execute` resolves to an empty result unless a
 * test says otherwise. The pool is never connected: nothing reaches it while
 * `execute` is spied.
 */
export function spiedDrizzle(): SpiedDrizzle {
    const db = drizzle(new Pool());
    const execute = jest.spyOn(db, "execute").mockResolvedValue(queryResult());
    return { db, execute };
}
