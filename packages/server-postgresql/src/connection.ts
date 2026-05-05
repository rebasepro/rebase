import { Pool, PoolConfig } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

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
    queryTimeout: 30_000,
    statementTimeout: 30_000,
    keepAlive: true
};

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
    // Uses console.* because the structured logger lives in server-core
    // (a separate package). The caller can replace these with the structured
    // logger if desired via pool.on() after creation.
    pool.on("error", (err) => {
        console.error("[pg-pool] Unexpected pool error:", err.message);
        if (err.message.includes("ETIMEDOUT")) {
            console.warn("[pg-pool] Connection timeout detected — pool will auto-retry");
        }
    });

    // Create drizzle instance — pass schema when available to enable db.query relational API
    const db = schema ? drizzle(pool, { schema }) : drizzle(pool);

    return { db,
pool,
connectionString };
}
