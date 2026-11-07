/**
 * Requests that failed for want of a database connection, counted where the
 * error handler classifies them — see `rebase_db_connection_errors_total` in
 * `database.ts`, which renders these.
 *
 * Its own module, with no imports, because the error handler is part of the
 * portable `@rebasepro/server/functions` entry: whatever it imports has to load
 * on a runtime without Node.
 *
 * @module
 */

/**
 * Why a request found no connection: a SQLSTATE (`53300`, `53400`) or
 * `pool_exhausted`, `connect_timeout`, `unreachable`. A closed set — never a
 * message — so the label stays bounded.
 */
export type DbConnectionErrorCode = "53300" | "53400" | "pool_exhausted" | "connect_timeout" | "unreachable";

/**
 * Process-wide totals. Kept here rather than in a registry because the error
 * handler has no registry to hand, and a process with metrics off should pay
 * one map increment and nothing more.
 */
const connectionErrors = new Map<string, number>();

/** Count one request that failed for want of a connection. */
export function noteDbConnectionError(code: DbConnectionErrorCode): void {
    connectionErrors.set(code, (connectionErrors.get(code) ?? 0) + 1);
}

/** The totals so far, for rendering and for tests. */
export function dbConnectionErrorCounts(): ReadonlyMap<string, number> {
    return connectionErrors;
}
