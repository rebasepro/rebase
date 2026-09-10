/**
 * Read the rows out of whatever a SQL driver actually returned.
 *
 * Two shapes reach this repository's stores through the same call, and which
 * one arrives is a property of the driver rather than of the query:
 * node-postgres hands back a `{ rows }` envelope, and the other paths — a bare
 * `executeSql`, Drizzle's `db.execute()` on some builds — hand back an array.
 * `@rebasepro/server`'s `SqlExec` type declares the array, so the envelope is
 * off-contract every time it turns up, and it still turns up.
 *
 * Reading one shape only is how a store silently sees nothing: the rate limiter
 * that did it counted every caller as being on their first request — a limiter
 * that never limits, with no error anywhere to say so.
 *
 * Written inline it came to `result as unknown as { rows?: T[] } | T[]`, five
 * times across three packages. That is the problem restated as an assertion: a
 * union the caller has to re-test at runtime anyway, with `unknown` in the
 * middle only because neither half overlaps what the signature promised. The
 * `Array.isArray` below is that same test done once, and it *narrows* — so
 * these branches are checked rather than claimed.
 *
 * The element type is the one claim that stays a claim: these are rows from
 * hand-written SQL, and nothing at this layer can check a column list.
 */
export function sqlRows<T = Record<string, unknown>>(result: unknown): T[] {
    if (Array.isArray(result)) return result as T[];
    if (result !== null && typeof result === "object") {
        const rows = (result as { rows?: unknown }).rows;
        if (Array.isArray(rows)) return rows as T[];
    }
    return [];
}

/** The first row of {@link sqlRows}, or `undefined` when there were none. */
export function firstSqlRow<T = Record<string, unknown>>(result: unknown): T | undefined {
    return sqlRows<T>(result)[0];
}
