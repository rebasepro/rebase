/**
 * The server's DDL bootstrapper, over a Drizzle handle.
 *
 * `createDdlBootstrapper` in `@rebasepro/server` wants a plain
 * `(sql: string) => Promise<rows>`; the driver's internal stores hold a Drizzle
 * database. This is the adapter between them, and it exists so the retry policy
 * has exactly one definition. A second copy of the SQLSTATE list living in the
 * driver is how the two drift apart, and the drift is invisible: both versions
 * work perfectly on every single-instance deployment.
 */
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { createDdlBootstrapper, type DdlBootstrapper } from "@rebasepro/server";

/**
 * A {@link DdlBootstrapper} that runs its statements through `db.execute`.
 *
 * @param db    the Drizzle handle the calling store already holds
 * @param scope log prefix identifying the caller, e.g. `"channel-presence"`
 */
export function drizzleDdlBootstrapper(
    db: NodePgDatabase<Record<string, unknown>>,
    scope: string
): DdlBootstrapper {
    return createDdlBootstrapper(async (statement: string) => {
        // `sql.raw`, because everything reaching this path is DDL assembled from
        // identifiers that were validated before they got here — there is no
        // parameter to bind, and Drizzle's tagged template would treat the whole
        // statement as one.
        const result = await db.execute(sql.raw(statement));
        return (result as unknown as { rows?: Record<string, unknown>[] }).rows ?? [];
    }, scope);
}
