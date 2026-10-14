/**
 * A database closed to new connections (`ALLOW_CONNECTIONS false`), read off
 * the error a refused connection raises, and the operator's line that names it.
 *
 * Its own module rather than in `errors.ts`, which the package root re-exports
 * whole: these are the server's to use, not part of its API.
 *
 * @module
 */
import { logger } from "../utils/logger";

/** How often the closed-database line is said: once a minute, as the other database lines in `errors.ts` are. */
const CLOSED_WARNING_INTERVAL_MS = 60_000;

/** When the closed-database line was last said. */
let lastClosedWarningAt = 0;

/** Forget when the closed-database line was last said. @internal For tests only. */
export function _resetClosedDatabaseWarningForTests(): void {
    lastClosedWarningAt = 0;
}

/**
 * The database that refused the connection because it is closed to new ones
 * (`ALLOW_CONNECTIONS false`), or null.
 *
 * Postgres says it as `database "x" is not currently accepting connections`,
 * SQLSTATE 55000. That code also covers statements the database judged
 * (`lastval is not yet defined in this session`), so the sentence is what is
 * matched — through Drizzle's `cause` and a dual-stack `AggregateError`. The
 * driver's CLI reads it the same way (`closedDatabaseName` in
 * `@rebasepro/server-postgres`'s `cli-errors.ts`).
 */
export function closedDatabaseName(error: unknown, depth = 0): string | null {
    if (typeof error !== "object" || error === null || depth > 8) return null;
    const message = Reflect.get(error, "message");
    if (typeof message === "string") {
        const named = /database "(.+)" is not currently accepting connections/.exec(message);
        if (named) return named[1];
    }
    const inner = Reflect.get(error, "errors");
    if (Array.isArray(inner)) {
        for (const item of inner) {
            const named = closedDatabaseName(item, depth + 1);
            if (named) return named;
        }
    }
    return closedDatabaseName(Reflect.get(error, "cause"), depth + 1);
}

/**
 * The operator's line for a closed database, at most once a minute, when
 * `error` is one: which database, that nothing is lost, and what opens it. `true`
 * when it was one — said now or within the minute — so the caller says nothing
 * more general about it.
 *
 * Nothing in a development database closes one but `rebase db branch create
 * --force`, which closes its source for the copy; one stopped part-way leaves
 * it closed, and every `rebase db branch` command opens it again first.
 */
export function warnIfDatabaseClosed(error: unknown): boolean {
    const database = closedDatabaseName(error);
    if (database === null) return false;
    const now = Date.now();
    if (now - lastClosedWarningAt < CLOSED_WARNING_INTERVAL_MS) return true;
    lastClosedWarningAt = now;
    logger.error(
        `❌ Database "${database}" is closed to new connections (ALLOW_CONNECTIONS false), so requests that need it ` +
        "are answered 503 DATABASE_UNAVAILABLE. Nothing in it is lost: `rebase db branch create --force` closes its " +
        "source for the copy, and one stopped part-way leaves it closed. Open it again with `rebase db branch list` " +
        `(every \`rebase db branch\` command opens it first), or run ALTER DATABASE "${database.replace(/"/g, '""')}" ` +
        "ALLOW_CONNECTIONS true; connected to the server's postgres database. Not repeated for a minute."
    );
    return true;
}
