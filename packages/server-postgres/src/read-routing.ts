/**
 * Which connection an authenticated read runs on: the primary, or a standby
 * (`DATABASE_READ_URL`).
 *
 * A standby serves a read as well as the primary does — the RLS context is
 * transaction-local (`applyAuthContext`), and `SET LOCAL ROLE` and
 * `set_config(…, true)` both work on a hot standby — but it serves what it
 * has replayed, which is a little behind. Two rules keep that from being
 * visible:
 *
 * - **Read-your-writes.** A principal that just wrote reads from the primary
 *   for {@link ReadRoutingOptions.stickyMs} afterwards, so a save followed by
 *   a list shows the save. In-process: another instance does not know about
 *   the write, and the lag guard is what bounds what it can serve.
 * - **Lag guard.** The standby's replay lag is sampled every
 *   {@link ReadRoutingOptions.sampleIntervalMs}; above
 *   {@link ReadRoutingOptions.maxLagMs}, or with no recent sample, every read
 *   goes to the primary. So does every read for a while after the standby
 *   failed one (see {@link isReplicaFallbackError}), and the failed read is
 *   retried on the primary.
 *
 * What never comes here is decided by the caller: writes, reads inside a
 * write's transaction, the service identity (crons, jobs, `dataAsAdmin`), and
 * everything on the base driver — auth, realtime, idempotency, the SQL
 * console, `rebase.sql`.
 *
 * @module
 */
import { logger } from "@rebasepro/server";

/** How reads are routed, from `REBASE_READ_STICKY_MS` / `REBASE_READ_MAX_LAG_MS`. */
export interface ReadRoutingOptions {
    /** How long a principal reads from the primary after a write. Default 5000. */
    stickyMs: number;
    /** Replay lag above which every read goes to the primary. Default 1000. */
    maxLagMs: number;
    /** How often the standby's lag is sampled. Default 1000. */
    sampleIntervalMs?: number;
    /** How long the standby is left alone after it failed a read. Default 10 000. */
    failureCooldownMs?: number;
    /** Principals remembered as recent writers before the oldest is forgotten. Default 10 000. */
    maxPinnedPrincipals?: number;
    /** The clock, for tests. */
    now?: () => number;
}

export const DEFAULT_READ_STICKY_MS = 5_000;
export const DEFAULT_READ_MAX_LAG_MS = 1_000;
const DEFAULT_SAMPLE_INTERVAL_MS = 1_000;
const DEFAULT_FAILURE_COOLDOWN_MS = 10_000;
const DEFAULT_MAX_PINNED = 10_000;
/** A sample older than this many intervals is no evidence about the standby now. */
const STALE_SAMPLE_INTERVALS = 3;
const FAILURE_WARNING_INTERVAL_MS = 60_000;

/** Why a read went where it did. Reported in debug logs and tests. */
export type ReadRoute =
    | { target: "replica" }
    | { target: "primary"; reason: "sticky" | "lag" | "no-sample" | "unavailable" };

/**
 * Parse one of the routing variables: a whole number of milliseconds, zero
 * allowed. A value that is set and malformed throws, naming the variable — a
 * mistyped guard must not quietly become another number.
 */
export function parseReadRoutingMs(raw: string, variable: string): number {
    const trimmed = raw.trim();
    if (!/^[0-9]+$/.test(trimmed)) {
        throw new Error(`${variable} must be a whole number of milliseconds, got "${raw}".`);
    }
    return Number(trimmed);
}

/** The routing options from the environment, defaults filled in. */
export function readRoutingOptionsFromEnv(env: Record<string, string | undefined>): ReadRoutingOptions {
    const sticky = env.REBASE_READ_STICKY_MS?.trim();
    const lag = env.REBASE_READ_MAX_LAG_MS?.trim();
    return {
        stickyMs: sticky ? parseReadRoutingMs(sticky, "REBASE_READ_STICKY_MS") : DEFAULT_READ_STICKY_MS,
        maxLagMs: lag ? parseReadRoutingMs(lag, "REBASE_READ_MAX_LAG_MS") : DEFAULT_READ_MAX_LAG_MS
    };
}

/**
 * Whether two connection strings name the same database on the same server as
 * the same role — ignoring the query string, where the boot pins
 * `options=-c search_path=…` onto the primary's URL. Comparing the strings
 * themselves is how the read pool came to be opened for a `DATABASE_READ_URL`
 * that named the primary: the pinned primary URL never equalled the bare one.
 *
 * Unparseable strings are compared as given.
 */
export function sameDatabaseTarget(a: string, b: string): boolean {
    let left: URL;
    let right: URL;
    try {
        left = new URL(a);
        right = new URL(b);
    } catch {
        return a === b;
    }
    const port = (url: URL) => url.port || "5432";
    return left.hostname.toLowerCase() === right.hostname.toLowerCase()
        && port(left) === port(right)
        && decodeURIComponent(left.pathname) === decodeURIComponent(right.pathname)
        && decodeURIComponent(left.username) === decodeURIComponent(right.username);
}

/**
 * SQLSTATEs after which a read is retried on the primary: the standby could
 * not serve it, not a judgement of the statement. Class 08 (connection), class
 * 53 (out of connections or resources), `57P0x` (shutting down, restarting,
 * starting), `57014` (statement cancelled — a standby cancels queries that
 * conflict with replay), and `40001` (the same conflict, reported as a
 * serialization failure).
 */
function isReplicaSqlState(code: string): boolean {
    return code.startsWith("08") || code.startsWith("53") || code.startsWith("57P")
        || code === "57014" || code === "40001";
}

const REPLICA_NETWORK_CODES = new Set([
    "ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH", "ETIMEDOUT", "EPIPE"
]);

const REPLICA_POOL_MESSAGES = [
    "timeout exceeded when trying to connect",
    "Connection terminated due to connection timeout",
    "Connection terminated unexpectedly",
    "Client has encountered a connection error and is not queryable",
    "Query read timeout"
];

/**
 * Whether a read that failed on the standby should be run again on the
 * primary: the standby (or the way to it) failed, anywhere down the cause
 * chain. A policy denial, a bad filter or an error a hook threw is the read's
 * own answer, and the primary would give it too — those are not retried, so a
 * hook with side effects does not run twice for them.
 */
export function isReplicaFallbackError(error: unknown, depth = 0): boolean {
    if (!error || typeof error !== "object" || depth > 8) return false;
    const code = Reflect.get(error, "code");
    if (typeof code === "string" && (REPLICA_NETWORK_CODES.has(code) || (/^[0-9A-Z]{5}$/.test(code) && isReplicaSqlState(code)))) {
        return true;
    }
    const message = Reflect.get(error, "message");
    if (typeof message === "string" && REPLICA_POOL_MESSAGES.some(m => message.startsWith(m))) return true;
    if (error instanceof AggregateError && error.errors.some(e => isReplicaFallbackError(e, depth + 1))) return true;
    return isReplicaFallbackError(Reflect.get(error, "cause"), depth + 1);
}

/**
 * Replay lag in milliseconds, as the standby sees it: zero when it has
 * replayed everything it received (an idle primary sends nothing, and the
 * last replayed transaction's age would otherwise grow without bound), else
 * the age of the last transaction it replayed. Zero on a server that is not
 * in recovery — a read URL that names a primary has no lag. `null` when the
 * standby cannot say.
 */
export const REPLICA_LAG_SQL = `SELECT CASE
    WHEN NOT pg_is_in_recovery() THEN 0
    WHEN pg_last_wal_receive_lsn() IS NOT NULL AND pg_last_wal_receive_lsn() = pg_last_wal_replay_lsn() THEN 0
    ELSE EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp())) * 1000
END AS lag_ms`;

/** Run {@link REPLICA_LAG_SQL} on `pool`, in milliseconds. */
/**
 * What a probe asks of a pool: one statement, answered with its rows. A
 * `pg.Pool` is one. The rows are read as they arrive, not as a declared shape.
 */
export interface RowsQueryable {
    query(text: string): Promise<{ rows: Record<string, unknown>[] }>;
}

export async function readReplicaLagMs(pool: RowsQueryable): Promise<number | null> {
    const result = await pool.query(REPLICA_LAG_SQL);
    const raw = result.rows[0]?.lag_ms;
    if (raw === null || raw === undefined) return null;
    const lag = Number(raw);
    return Number.isFinite(lag) ? Math.max(0, lag) : null;
}

/**
 * The standby's routing state for one data source: recent writers, the last
 * lag sample, and whether the standby failed a read recently. One per source,
 * held by the base driver, so every request's authenticated driver shares it.
 */
export class ReadRouter<Db = unknown> {
    readonly stickyMs: number;
    readonly maxLagMs: number;
    private readonly sampleIntervalMs: number;
    private readonly failureCooldownMs: number;
    private readonly maxPinned: number;
    private readonly now: () => number;

    /** Principal → when its read-your-writes window ends. Insertion order is age. */
    private readonly pinnedUntil = new Map<string, number>();
    private lagMs: number | null = null;
    private sampledAt = Number.NEGATIVE_INFINITY;
    private unavailableUntil = 0;
    private lastFailureWarningAt = Number.NEGATIVE_INFINITY;
    private timer?: ReturnType<typeof setInterval>;
    private sampling?: Promise<void>;

    constructor(
        /** The standby's handle, which routed reads open their transaction on. */
        readonly db: Db,
        private readonly sampleLag: () => Promise<number | null>,
        options: ReadRoutingOptions
    ) {
        this.stickyMs = options.stickyMs;
        this.maxLagMs = options.maxLagMs;
        this.sampleIntervalMs = options.sampleIntervalMs ?? DEFAULT_SAMPLE_INTERVAL_MS;
        this.failureCooldownMs = options.failureCooldownMs ?? DEFAULT_FAILURE_COOLDOWN_MS;
        this.maxPinned = options.maxPinnedPrincipals ?? DEFAULT_MAX_PINNED;
        this.now = options.now ?? Date.now;
    }

    /** Take the first sample and keep sampling. Unref'd: it never holds the process open. */
    start(): void {
        if (this.timer) return;
        void this.sample();
        this.timer = setInterval(() => void this.sample(), this.sampleIntervalMs);
        this.timer.unref?.();
    }

    stop(): void {
        if (this.timer) clearInterval(this.timer);
        this.timer = undefined;
    }

    /** One lag sample. A failed sample leaves no sample, so reads go to the primary. */
    sample(): Promise<void> {
        this.sampling ??= (async () => {
            try {
                const lag = await this.sampleLag();
                this.lagMs = lag;
                this.sampledAt = lag === null ? Number.NEGATIVE_INFINITY : this.now();
            } catch (error: unknown) {
                this.lagMs = null;
                this.sampledAt = Number.NEGATIVE_INFINITY;
                this.noteReplicaFailure(error);
            } finally {
                this.sampling = undefined;
            }
        })();
        return this.sampling;
    }

    /** The last sampled lag in seconds, or `undefined` with no current sample. */
    get lagSeconds(): number | undefined {
        return this.hasFreshSample() && this.lagMs !== null ? this.lagMs / 1000 : undefined;
    }

    /**
     * Where `principal`'s read goes. A read with no principal is routed on the
     * standby's health alone: there is no write of its own to see.
     */
    route(principal?: string): ReadRoute {
        const now = this.now();
        if (now < this.unavailableUntil) return { target: "primary", reason: "unavailable" };
        if (principal !== undefined) {
            const until = this.pinnedUntil.get(principal);
            if (until !== undefined) {
                if (now < until) return { target: "primary", reason: "sticky" };
                this.pinnedUntil.delete(principal);
            }
        }
        if (!this.hasFreshSample() || this.lagMs === null) return { target: "primary", reason: "no-sample" };
        if (this.lagMs > this.maxLagMs) return { target: "primary", reason: "lag" };
        return { target: "replica" };
    }

    /**
     * `principal` is writing: its reads go to the primary until
     * {@link stickyMs} after this. Called when the write starts AND when it
     * ends, so a read during a long write is pinned too and the window runs
     * from the commit.
     */
    notePrimaryWrite(principal: string): void {
        if (this.stickyMs <= 0) return;
        this.pinnedUntil.delete(principal);
        this.pinnedUntil.set(principal, this.now() + this.stickyMs);
        while (this.pinnedUntil.size > this.maxPinned) {
            const oldest = this.pinnedUntil.keys().next().value;
            if (oldest === undefined) break;
            this.pinnedUntil.delete(oldest);
        }
    }

    /** The standby failed: leave it alone for the cooldown, and say so once a minute. */
    noteReplicaFailure(error: unknown): void {
        const now = this.now();
        this.unavailableUntil = now + this.failureCooldownMs;
        if (now - this.lastFailureWarningAt >= FAILURE_WARNING_INTERVAL_MS) {
            this.lastFailureWarningAt = now;
            logger.warn(
                "⚠️ The read replica (DATABASE_READ_URL) failed, so reads are served by the primary for now. " +
                "Not repeated for a minute.",
                { error: error instanceof Error ? error.message : String(error) }
            );
        }
    }

    private hasFreshSample(): boolean {
        return this.now() - this.sampledAt <= this.sampleIntervalMs * STALE_SAMPLE_INTERVALS;
    }
}
