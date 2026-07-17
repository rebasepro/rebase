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
}

const DEFAULT_POOL: Required<PostgresPoolConfig> = {
    max: 20,
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

    const pgPoolConfig: PoolConfig = {
        connectionString,
        max: opts.max,
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

    const pgPoolConfig: PoolConfig = {
        connectionString,
        max: opts.max,
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

    const pgPoolConfig: PoolConfig = {
        connectionString,
        max: opts.max,
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
