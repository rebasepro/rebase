/**
 * What a Postgres source reports about itself for `/metrics`: its pools, and a
 * sample of the server behind them.
 *
 * The control plane scrapes the runtime on every substrate, including ones
 * where it cannot reach the database directly. So the numbers a database
 * needs watched by — connections against `max_connections`, its size, how far
 * a standby is behind — are read here, by the process that is connected
 * anyway, and published with the rest of its metrics.
 *
 * @module
 */
import type { Pool } from "pg";
import type { DatabaseHealthSample, DatabasePoolStats } from "@rebasepro/types";
import { readReplicaLagMs, type RowsQueryable } from "./read-routing";

/** The three counts `pg.Pool` keeps, as a stats row for `pool`. */
export function poolStatsOf(pool: Pick<Pool, "totalCount" | "idleCount" | "waitingCount">, name: string): DatabasePoolStats {
    return { pool: name, total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount };
}

/**
 * Connections by state, across the server — `max_connections` is a server
 * limit, so a count of one database's would understate how close it is.
 * Client backends only: the server's own workers do not count against it.
 * A role without `pg_read_all_stats` sees other roles' sessions with a null
 * state, which is counted as `unknown` rather than dropped.
 */
const CONNECTIONS_SQL = `SELECT COALESCE(state, 'unknown') AS state, count(*)::int AS count
    FROM pg_stat_activity
    WHERE backend_type = 'client backend'
    GROUP BY 1`;

/**
 * Sample the server behind `primary`, and the standby behind `replica` when
 * there is one. Each part is read on its own: a role that may not read one
 * answer still reports the others, and the part it could not read is left
 * out rather than reported as zero.
 */
export async function sampleDatabaseHealth(
    primary: RowsQueryable,
    replica?: RowsQueryable
): Promise<DatabaseHealthSample> {
    const sample: DatabaseHealthSample = {};
    const [connections, max, size, lag] = await Promise.allSettled([
        primary.query(CONNECTIONS_SQL),
        primary.query("SELECT current_setting('max_connections') AS max"),
        primary.query("SELECT pg_database_size(current_database())::text AS bytes"),
        replica ? readReplicaLagMs(replica) : Promise.resolve(null)
    ]);
    if (connections.status === "fulfilled") {
        sample.connections = Object.fromEntries(connections.value.rows.map(row => [String(row.state), Number(row.count)]));
    }
    if (max.status === "fulfilled") {
        const value = Number(max.value.rows[0]?.max);
        if (Number.isFinite(value)) sample.maxConnections = value;
    }
    if (size.status === "fulfilled") {
        const value = Number(size.value.rows[0]?.bytes);
        if (Number.isFinite(value)) sample.sizeBytes = value;
    }
    if (lag.status === "fulfilled" && lag.value !== null) {
        sample.replicaLagSeconds = lag.value / 1000;
    }
    return sample;
}
