/**
 * How long queries wait for a pooled database connection.
 *
 * A write holds its connection — and its transaction, and the locks it has
 * taken — for as long as its callbacks run: `beforeSave` runs after the
 * transaction has begun, `afterSave` before it commits. Callbacks that await
 * something slow therefore take connections out of the pool for that long, and
 * once enough of them run at once every other request queues for one. Measured
 * with the default pool of 20: 25 concurrent saves whose `beforeSave` awaited
 * 300 ms made an unrelated one-row read wait 290 ms for a connection.
 *
 * Nothing else shows that queue. Request latency rises, but so it does for a
 * slow query; this histogram says how much of a request was spent waiting for
 * a connection at all. Near zero is a healthy pool.
 *
 * @module
 */
import { DB_POOL_WAIT_METRIC, POOL_WAIT_BUCKETS_MS, type MetricsRegistry } from "./index.js";

/** `pg.Pool`'s callback form of `connect`, which `pool.query` uses internally. */
type ConnectCallback = (err: Error | undefined, client: unknown, done: (release?: unknown) => void) => void;

/**
 * `connect` as a `pg.Pool` has it: a promise without a callback, the callback
 * with one. Both are timed — transactions check out with the first,
 * `pool.query` with the second.
 */
export type PoolConnect = (callback?: ConnectCallback) => Promise<unknown> | void;

const timedPools = new WeakSet<object>();

/**
 * Time every checkout from `pool`, from the call to the moment a connection is
 * handed over, and report it to `record` in milliseconds. A failed checkout is
 * not recorded: it is an error, not a wait.
 *
 * Wraps `connect` on this pool object only. `false` when the pool has no
 * `connect` to time (a driver that is not pool-based) or is timed already.
 */
export function timePoolCheckouts(pool: { connect?: PoolConnect }, record: (waitMs: number) => void): boolean {
    const original = pool.connect;
    if (typeof original !== "function" || timedPools.has(pool)) return false;
    timedPools.add(pool);

    pool.connect = function timedConnect(this: unknown, callback?: ConnectCallback) {
        const started = performance.now();
        if (typeof callback === "function") {
            return original.call(this, (err, client, done) => {
                if (!err) record(performance.now() - started);
                callback(err, client, done);
            });
        }
        const checkout = original.call(this);
        return checkout === undefined
            ? checkout
            : checkout.then(client => {
                record(performance.now() - started);
                return client;
            });
    };
    return true;
}

/**
 * Time the checkouts of every pool-based data source into `registry`'s
 * {@link DB_POOL_WAIT_METRIC} histogram, labelled by the source's key.
 */
export function recordPoolWaits(
    registry: MetricsRegistry,
    sources: readonly { key: string; connection: { pool?: { connect?: PoolConnect } } }[]
): void {
    for (const source of sources) {
        const pool = source.connection.pool;
        if (!pool) continue;
        timePoolCheckouts(pool, waitMs => registry.observe(DB_POOL_WAIT_METRIC, waitMs, { source: source.key }, POOL_WAIT_BUCKETS_MS));
    }
}
