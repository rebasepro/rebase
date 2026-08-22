import { Pool, PoolConfig } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { logger } from "@rebasepro/server";

/**
 * Configuration for the Postgres connection pool.
 *
 * Sensible defaults are provided for production Cloud Run / single-instance
 * deployments. Override via environment variables or explicit config.
 */
export interface PostgresPoolConfig {
    /** Maximum number of connections in the pool (default: 20) */
    max?: number;
    /** Close idle connections after this many ms (default: 30 000) */
    idleTimeoutMillis?: number;
    /** Abort connection attempts after this many ms (default: 10 000) */
    connectionTimeoutMillis?: number;
    /** Per-query timeout in ms (default: 30 000) */
    queryTimeout?: number;
    /** Per-statement timeout in ms (default: 30 000) */
    statementTimeout?: number;
    /** Enable TCP keep-alive (default: true) */
    keepAlive?: boolean;
    /**
     * `search_path` pinned on every connection (default: `"public"`).
     *
     * Pass `false` to send no `search_path` at all and inherit whatever the
     * server/role defaults to. See {@link pinSearchPath} for why the default
     * is not "inherit".
     */
    searchPath?: string | false;
}

/**
 * Ceiling on pool size, from the environment.
 *
 * Exists for the managed development database. PGlite is a single session
 * behind a multiplexing socket server, and two pooled clients holding
 * overlapping transactions deadlock there — which a request-per-transaction
 * server produces the moment two requests overlap. One connection turns that
 * deadlock into ordinary queueing.
 *
 * A ceiling rather than a value, so it constrains every pool in the process
 * without any of them having to know why. Ignored when unset or unparseable,
 * because a malformed limit must not silently serialize a production server.
 */
export function poolMaxCeiling(env: NodeJS.ProcessEnv = process.env): number | null {
    const raw = env.REBASE_DB_POOL_MAX;
    if (typeof raw !== "string") return null;

    // Plain decimal digits only. `Number` would also accept `1e3`, `0x10` and
    // ` 4 ` — none of which anyone writes on purpose in a config value, and all
    // of which would mean this silently did something other than it appears to.
    if (!/^[0-9]+$/.test(raw.trim())) return null;

    const parsed = Number(raw.trim());

    return parsed >= 1 ? parsed : null;
}

/** Apply {@link poolMaxCeiling} to a requested pool size. */
export function cappedPoolMax(requested: number, env: NodeJS.ProcessEnv = process.env): number {
    const ceiling = poolMaxCeiling(env);

    return ceiling === null ? requested : Math.min(requested, ceiling);
}

const DEFAULT_POOL: Required<PostgresPoolConfig> = {
    max: 20,
    searchPath: "public",
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // The client-side read timeout MUST be comfortably above the server-side
    // statement_timeout. When the client timer fires first, node-postgres
    // abandons the in-flight statement but keeps the connection — inside a
    // transaction that leaves the tx open (and any pending ROLLBACK is
    // spliced out of the client queue before it ever reaches the wire), so
    // the pooled connection is returned still in-transaction with its RLS
    // GUCs set. The server abort (SQLSTATE 57014) is the clean path; the
    // client timeout is only a backstop for a dead network.
    queryTimeout: 60_000,
    statementTimeout: 30_000,
    keepAlive: true
};

/** ReadyForQuery status byte: `I` idle, `T` in transaction, `E` failed transaction. */
const TX_IDLE = "I";

/**
 * Pin `search_path` into a connection string, so unqualified SQL resolves to a
 * schema this framework chose rather than to one Postgres inferred.
 *
 * Postgres defaults `search_path` to `"$user", public`: the *first* candidate
 * is a schema named after the connecting role. Rebase creates a schema called
 * `rebase` (auth, history, api keys), and every template, compose file and
 * deployment doc names the database role `rebase` too — so `$user` resolves to
 * a schema that exists, and every unqualified statement lands there instead of
 * in `public`. The generated Drizzle schema emits bare `pgTable("posts", …)`
 * for any collection without an explicit `schema`, which makes the *runtime's*
 * own reads and writes unqualified; a developer's raw `rebase.sql(...)`, the
 * Studio SQL editor and any hand-written migration are unqualified too. The
 * result is collection tables created in, and served from, `rebase`.
 *
 * Drizzle cannot express the fix on its side: `pgSchema("public")` throws by
 * design ("just use pgTable() instead"), so there is no way to emit a
 * public-qualified table from the generator. The pin has to live on the
 * connection.
 *
 * Precedence is deliberate and verified against node-postgres: `options` in
 * the connection string wins over the `options` field passed to `Pool`, so
 * rewriting the URL — rather than setting the field — is what makes this
 * authoritative. Two escape hatches survive it:
 *
 *  - an `options` that already mentions `search_path` is left untouched, so a
 *    deployment that deliberately pins something else keeps it;
 *  - `searchPath: false` (or an unparseable, non-URL connection string) sends
 *    nothing and inherits the server default.
 *
 * Anything else in `options` (a `statement_timeout`, say) is preserved and the
 * `search_path` flag is appended to it.
 */
export function pinSearchPath(connectionString: string, searchPath: string | false = "public"): string {
    if (searchPath === false) return connectionString;

    let url: URL;
    try {
        url = new URL(connectionString);
    } catch {
        // Key/value DSNs and anything else we cannot parse are returned as
        // given: a connection that works unpinned beats one we corrupted.
        return connectionString;
    }
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") return connectionString;

    const existing = url.searchParams.get("options");
    if (existing && /(^|\s)-c\s*search_path\s*=/.test(existing)) return connectionString;

    const flag = `-c search_path=${searchPath}`;
    url.searchParams.set("options", existing ? `${existing} ${flag}` : flag);
    // Re-serialize by hand. `URLSearchParams` writes a space as `+`, which
    // node-postgres happens to decode but libpq does not — and this same string
    // is handed to `pg_dump`/`psql` for backups. Percent-encoding is the form
    // both agree on, and is what the scaffolded `.env` already ships.
    url.search = Array.from(url.searchParams.entries())
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
        .join("&");
    return url.toString();
}

/**
 * Destroy pool clients that are released while still inside a transaction.
 *
 * pg-pool returns a client to the idle list whenever `release()` is called
 * without an error — even if the connection is still mid-transaction (status
 * `T`/`E`). That happens in practice: drizzle's pool transaction releases in
 * a `finally` after attempting ROLLBACK, and if the ROLLBACK itself fails
 * (e.g. it was queued behind a statement that hit the client-side
 * query_timeout), the client goes back dirty. The next checkout then runs
 * its statements inside the zombie transaction — with the previous request's
 * `app.*` RLS GUCs still applied, which turns unrelated queries into
 * RLS-scoped ones (observed in production as registration failing with
 * SQLSTATE 42501 under a leaked anonymous context).
 *
 * pg-pool emits `release` before it consults its private `_expired` set, so
 * marking the client expired here makes `_release()` destroy it instead of
 * pooling it. Both `client._txStatus` (pg ≥ 8.16) and `pool._expired` are
 * private APIs — feature-detect and fall back to loud logging so an upstream
 * change degrades to observability, never to silent corruption.
 */
export function guardPoolAgainstDirtyRelease(pool: Pool, label: string): void {
    pool.on("release", (err: Error | undefined, client: unknown) => {
        if (err) return; // errored clients are already destroyed by pg-pool
        const txStatus = (client as { _txStatus?: string | null })?._txStatus;
        if (typeof txStatus !== "string" || txStatus === TX_IDLE) return;

        // pg-pool keeps expired clients in a WeakSet (a plain object works too
        // if upstream ever changes it — duck-type on add/has).
        const expired = (pool as unknown as { _expired?: { add(c: object): unknown; has(c: object): boolean } })._expired;
        if (expired && typeof expired.add === "function" && typeof expired.has === "function" && client && typeof client === "object") {
            expired.add(client);
            logger.error(
                `[${label}] Client released back to the pool while still in a transaction ` +
                `(status '${txStatus}') — destroying it so the open transaction and its ` +
                `session state (RLS GUCs) cannot leak into the next request.`
            );
        } else {
            logger.error(
                `[${label}] Client released mid-transaction (status '${txStatus}') but the ` +
                `pool's internal expiry set is unavailable (pg-pool internals changed?). ` +
                `The connection may leak its open transaction into subsequent requests.`
            );
        }
    });
}

/**
 * Create a Drizzle-backed Postgres connection with a production-grade
 * connection pool.
 *
 * @param connectionString  Postgres connection URL
 * @param schema            Optional Drizzle schema for the relational API
 * @param poolConfig        Optional pool tuning (merged over defaults)
 *
 * @returns `{ db, pool, connectionString }` — the `pool` is exposed so
 *          callers can register shutdown hooks (`pool.end()`) or monitor
 *          pool metrics.
 */
export function createPostgresDatabaseConnection(
    connectionString: string,
    schema?: Record<string, unknown>,
    poolConfig?: PostgresPoolConfig
) {
    const opts = { ...DEFAULT_POOL,
...poolConfig };
    connectionString = pinSearchPath(connectionString, opts.searchPath);

    const pgPoolConfig: PoolConfig = {
        connectionString,
        max: cappedPoolMax(opts.max),
        idleTimeoutMillis: opts.idleTimeoutMillis,
        connectionTimeoutMillis: opts.connectionTimeoutMillis,
        query_timeout: opts.queryTimeout,
        statement_timeout: opts.statementTimeout,
        keepAlive: opts.keepAlive,
        keepAliveInitialDelayMillis: 0
    };

    const pool = new Pool(pgPoolConfig);

    // ── Pool event logging ────────────────────────────────────────────────
    // Uses console.* because the structured logger lives in server
    // (a separate package). The caller can replace these with the structured
    // logger if desired via pool.on() after creation.
    pool.on("error", (err) => {
        logger.error("[pg-pool] Unexpected pool error", { detail: err.message });
        if (err.message.includes("ETIMEDOUT")) {
            logger.warn("[pg-pool] Connection timeout detected — pool will auto-retry");
        }
    });
    guardPoolAgainstDirtyRelease(pool, "pg-pool");

    // Create drizzle instance — pass schema when available to enable db.query relational API
    const db = schema ? drizzle(pool, { schema }) : drizzle(pool);

    return { db,
pool,
connectionString };
}

/**
 * Create a direct (non-pooled) connection for operations that require
 * session-level features incompatible with PgBouncer transaction mode,
 * such as LISTEN/NOTIFY, prepared statements, or advisory locks.
 *
 * Uses a smaller pool since this is only for specific use cases.
 */
export function createDirectDatabaseConnection(
    connectionString: string,
    schema?: Record<string, unknown>,
    poolConfig?: PostgresPoolConfig
) {
    const opts = {
        ...DEFAULT_POOL,
        max: 5,
        ...poolConfig
    };
    connectionString = pinSearchPath(connectionString, opts.searchPath);

    const pgPoolConfig: PoolConfig = {
        connectionString,
        max: cappedPoolMax(opts.max),
        idleTimeoutMillis: opts.idleTimeoutMillis,
        connectionTimeoutMillis: opts.connectionTimeoutMillis,
        query_timeout: opts.queryTimeout,
        statement_timeout: opts.statementTimeout,
        keepAlive: opts.keepAlive,
        keepAliveInitialDelayMillis: 0
    };

    const pool = new Pool(pgPoolConfig);

    pool.on("error", (err) => {
        logger.error("[pg-direct-pool] Unexpected pool error", { detail: err.message });
    });
    guardPoolAgainstDirtyRelease(pool, "pg-direct-pool");

    const db = schema ? drizzle(pool, { schema }) : drizzle(pool);

    return { db,
pool,
connectionString };
}

/**
 * Create a read-only connection for routing read queries to replicas.
 * Uses a moderate pool size since reads are distributed across replicas.
 */
export function createReadReplicaConnection(
    connectionString: string,
    schema?: Record<string, unknown>,
    poolConfig?: PostgresPoolConfig
) {
    const opts = {
        ...DEFAULT_POOL,
        max: 10,
        ...poolConfig
    };
    connectionString = pinSearchPath(connectionString, opts.searchPath);

    const pgPoolConfig: PoolConfig = {
        connectionString,
        max: cappedPoolMax(opts.max),
        idleTimeoutMillis: opts.idleTimeoutMillis,
        connectionTimeoutMillis: opts.connectionTimeoutMillis,
        query_timeout: opts.queryTimeout,
        statement_timeout: opts.statementTimeout,
        keepAlive: opts.keepAlive,
        keepAliveInitialDelayMillis: 0
    };

    const pool = new Pool(pgPoolConfig);

    pool.on("error", (err) => {
        logger.error("[pg-replica-pool] Unexpected pool error", { detail: err.message });
    });
    guardPoolAgainstDirtyRelease(pool, "pg-replica-pool");

    const db = schema ? drizzle(pool, { schema }) : drizzle(pool);

    return { db,
pool,
connectionString };
}
