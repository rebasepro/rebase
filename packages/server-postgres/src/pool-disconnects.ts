/**
 * What a pool says when the server ends its idle connections.
 *
 * `pg_terminate_backend` ends every connection to a database at once, and an
 * idle pool client hears it as an `error` event: one per connection, from
 * every pool the process holds. `rebase db branch create --force` does exactly
 * that to the database it copies, so fifteen forced creates beside a running
 * `rebase dev` printed 220 `❌ [ERROR] [pg-pool] Unexpected pool error
 * {"detail":"terminating connection due to administrator command"}` lines. It
 * read as an outage, and nothing was wrong: the pool opens new connections on
 * the next query. A database restart looks the same.
 */
import { logger } from "@rebasepro/server";

/** SQLSTATEs of a connection the server ended: admin_shutdown, crash_shutdown, cannot_connect_now. */
const SERVER_ENDED_CODES = new Set(["57P01", "57P02", "57P03"]);

/** Did the server end this connection, rather than something go wrong with it? */
export function serverEndedConnection(err: Error): boolean {
    const code = "code" in err ? err.code : undefined;
    return (typeof code === "string" && SERVER_ENDED_CODES.has(code))
        || /terminating connection due to administrator command/i.test(err.message);
}

/** How long one line stands for every server-ended connection after it, across all pools. */
export const DISCONNECT_BURST_MS = 10_000;

/** When the current burst's line stops covering further disconnects. */
let burstUntil = 0;

/** The logger methods a pool's error listener writes through. */
export type PoolErrorLog = Pick<typeof logger, "warn" | "error" | "debug">;

/**
 * Say a pool's `error` event: a connection the server ended is one WARN line
 * per burst for the whole process, and the rest of the burst is at debug;
 * anything else is the ERROR it always was.
 *
 * The window is fixed from the first disconnect, not extended by each, so a
 * second burst ten seconds later is said again.
 */
export function reportPoolError(label: string, err: Error, log: PoolErrorLog = logger, now: () => number = Date.now): void {
    if (!serverEndedConnection(err)) {
        log.error(`[${label}] Unexpected pool error`, { detail: err.message });
        return;
    }
    const at = now();
    if (at < burstUntil) {
        log.debug(`[${label}] The database ended another idle connection`, { detail: err.message });
        return;
    }
    burstUntil = at + DISCONNECT_BURST_MS;
    const code = "code" in err && typeof err.code === "string" ? `, ${err.code}` : "";
    log.warn(
        `[${label}] The database ended this server's idle connections (${err.message}${code}). ` +
        "New ones open on the next query. A database restart does this, and so does " +
        "`rebase db branch create --force`, which closes the database it copies."
    );
}
