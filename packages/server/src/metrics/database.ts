/**
 * What the database side of this process looks like, for `/metrics`.
 *
 * Three kinds of number, each answering a question the pool-wait histogram
 * cannot:
 *
 * - **Pools** (`rebase_db_pool_{connections,idle,waiting}`, per source and pool) —
 *   read from the pools at each scrape. `waiting` above zero for long is a
 *   pool too small for its load; `total` across instances is what they ask of
 *   the database between them.
 * - **Connection errors** (`rebase_db_connection_errors_total{code}`) —
 *   requests answered 503 because no connection could be had: the server out
 *   of connections (`53300`, `53400`), the pool exhausted, a connect timeout,
 *   the database unreachable. Counted where the request's error is classified.
 * - **The server** (`rebase_db_connections{state}`, `rebase_db_max_connections`,
 *   `rebase_db_size_bytes`, `rebase_db_replica_lag_seconds`) — sampled every
 *   30 seconds by a probe on each source's own connection, not at scrape time:
 *   a scrape every few seconds must not become a query every few seconds.
 *
 * The control plane scrapes this on every substrate, including where it
 * cannot reach the database itself, so these are how it sees the database.
 *
 * @module
 */
import { isSQLAdmin, type DatabaseAdmin, type DatabaseHealthSample, type DatabasePoolStats } from "@rebasepro/types";
import type { MetricsRegistry } from "./index.js";
import { logger } from "../utils/logger";
import { dbConnectionErrorCounts } from "./db-connection-errors";

export { dbConnectionErrorCounts, noteDbConnectionError, type DbConnectionErrorCode } from "./db-connection-errors";

export const DB_POOL_CONNECTIONS_METRIC = "rebase_db_pool_connections";
export const DB_POOL_IDLE_METRIC = "rebase_db_pool_idle";
export const DB_POOL_WAITING_METRIC = "rebase_db_pool_waiting";
export const DB_CONNECTION_ERRORS_METRIC = "rebase_db_connection_errors_total";
export const DB_CONNECTIONS_METRIC = "rebase_db_connections";
export const DB_MAX_CONNECTIONS_METRIC = "rebase_db_max_connections";
export const DB_SIZE_METRIC = "rebase_db_size_bytes";
export const DB_REPLICA_LAG_METRIC = "rebase_db_replica_lag_seconds";

/** How often the server behind each source is sampled. */
export const DB_PROBE_INTERVAL_MS = 30_000;

/** A pool's three counts, as `pg.Pool` keeps them. Any field may be missing on another driver's pool. */
interface CountedPool {
    totalCount?: number;
    idleCount?: number;
    waitingCount?: number;
}

/** One data source as the metrics see it: its key, the pool the server opened, and how to reach its admin. */
export interface MeteredSource {
    key: string;
    pool?: CountedPool;
    admin: () => DatabaseAdmin | undefined;
}

function statsOfServerPool(pool: CountedPool | undefined): DatabasePoolStats | undefined {
    if (!pool) return undefined;
    const { totalCount, idleCount, waitingCount } = pool;
    if (typeof totalCount !== "number" || typeof idleCount !== "number" || typeof waitingCount !== "number") return undefined;
    return { pool: "primary", total: totalCount, idle: idleCount, waiting: waitingCount };
}

/**
 * Report each source's pools and the connection-error totals at every render.
 * The server's own pool is read directly — any driver whose pool keeps
 * `pg.Pool`'s counts reports it — and the driver's other pools through
 * `SQLAdmin.poolStats`, when it has one.
 */
export function recordDatabasePools(registry: MetricsRegistry, sources: readonly MeteredSource[]): void {
    registry.onRender(() => {
        for (const source of sources) {
            const stats: DatabasePoolStats[] = [];
            const primary = statsOfServerPool(source.pool);
            if (primary) stats.push(primary);
            const admin = source.admin();
            if (isSQLAdmin(admin) && admin.poolStats) {
                try {
                    stats.push(...admin.poolStats());
                } catch {
                    // A driver that cannot count its pools reports the server's alone.
                }
            }
            for (const stat of stats) {
                const labels = { source: source.key, pool: stat.pool };
                registry.setGauge(DB_POOL_CONNECTIONS_METRIC, stat.total, labels);
                registry.setGauge(DB_POOL_IDLE_METRIC, stat.idle, labels);
                registry.setGauge(DB_POOL_WAITING_METRIC, stat.waiting, labels);
            }
        }
        for (const [code, count] of dbConnectionErrorCounts()) {
            registry.setCounter(DB_CONNECTION_ERRORS_METRIC, count, { code });
        }
    });
}

/** Write one source's sample into the registry. A field the sample lacks leaves its gauge as it was. */
export function applyHealthSample(registry: MetricsRegistry, source: string, sample: DatabaseHealthSample): void {
    if (sample.connections) {
        for (const [state, count] of Object.entries(sample.connections)) {
            registry.setGauge(DB_CONNECTIONS_METRIC, count, { source, state });
        }
    }
    if (sample.maxConnections !== undefined) registry.setGauge(DB_MAX_CONNECTIONS_METRIC, sample.maxConnections, { source });
    if (sample.sizeBytes !== undefined) registry.setGauge(DB_SIZE_METRIC, sample.sizeBytes, { source });
    if (sample.replicaLagSeconds !== undefined) registry.setGauge(DB_REPLICA_LAG_METRIC, sample.replicaLagSeconds, { source });
}

/**
 * Sample every source that can be sampled, now and every
 * {@link DB_PROBE_INTERVAL_MS}. Returns the stop. The timer is unref'd, so it
 * never holds the process open; a sample still running is not doubled.
 *
 * A source whose driver has no `SQLAdmin.sampleHealth` is skipped. A failed
 * sample is logged at debug and leaves the last values in place — the gauges
 * describe the database, and the database did not change because one sample
 * failed.
 */
export function startDatabaseProbe(
    registry: MetricsRegistry,
    sources: readonly MeteredSource[],
    intervalMs: number = DB_PROBE_INTERVAL_MS
): () => void {
    let running = false;
    const sampleAll = async (): Promise<void> => {
        if (running) return;
        running = true;
        try {
            await Promise.all(sources.map(async (source) => {
                const admin = source.admin();
                if (!isSQLAdmin(admin) || !admin.sampleHealth) return;
                try {
                    applyHealthSample(registry, source.key, await admin.sampleHealth());
                } catch (error: unknown) {
                    logger.debug("[metrics] Could not sample the database", {
                        source: source.key,
                        error: error instanceof Error ? error.message : String(error)
                    });
                }
            }));
        } finally {
            running = false;
        }
    };
    void sampleAll();
    const timer = setInterval(() => void sampleAll(), intervalMs);
    timer.unref?.();
    return () => clearInterval(timer);
}
