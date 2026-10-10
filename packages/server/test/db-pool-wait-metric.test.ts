/**
 * `/metrics` reports how long queries wait for a pooled database connection.
 *
 * Write callbacks hold a connection — and the write's transaction — for as
 * long as they run, so slow ones starve the pool and every other request
 * queues for a connection. Nothing measured that queue; request latency alone
 * cannot tell it from a slow query.
 */
import { describe, it, expect } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";
import { DB_POOL_WAIT_METRIC, MetricsRegistry, POOL_WAIT_BUCKETS_MS } from "../src/metrics";
import { recordPoolWaits, timePoolCheckouts, type PoolConnect } from "../src/metrics/pool-wait";

type Callback = Parameters<NonNullable<Parameters<PoolConnect>[0]>>;

/**
 * A pool shaped like `pg.Pool`: `connect()` resolves a client once one is
 * free, `connect(cb)` calls back — and, like pg-pool, `query` checks out
 * through `this.connect(cb)`, so a wrapper on the instance sees it.
 */
function fakePool(options: { waitMs: number; fail?: boolean }) {
    const pool = {
        async end() { /* nothing to close */ },
        connect(callback?: (...args: Callback) => void): Promise<unknown> | void {
            const checkout = new Promise<unknown>((resolve, reject) => setTimeout(
                () => options.fail ? reject(new Error("ECONNREFUSED")) : resolve({ release() { /* back to the pool */ } }),
                options.waitMs
            ));
            if (!callback) return checkout;
            checkout.then(client => callback(undefined, client, () => undefined), (err: Error) => callback(err, undefined, () => undefined));
        },
        query(this: { connect: PoolConnect }, _sql: string): Promise<unknown> {
            return new Promise((resolve, reject) => {
                this.connect((err, client) => err ? reject(err) : resolve(client));
            });
        }
    };
    return pool;
}

describe("the pool-wait histogram", () => {
    it("renders as a Prometheus histogram, by data source", () => {
        const registry = new MetricsRegistry();
        registry.observe(DB_POOL_WAIT_METRIC, 0.4, { source: "default" }, POOL_WAIT_BUCKETS_MS);
        registry.observe(DB_POOL_WAIT_METRIC, 290, { source: "default" }, POOL_WAIT_BUCKETS_MS);
        const text = registry.render();

        expect(text).toContain(`# TYPE ${DB_POOL_WAIT_METRIC} histogram`);
        expect(text).toContain(`${DB_POOL_WAIT_METRIC}_bucket{source="default",le="1"} 1`);
        expect(text).toContain(`${DB_POOL_WAIT_METRIC}_bucket{source="default",le="250"} 1`);
        expect(text).toContain(`${DB_POOL_WAIT_METRIC}_bucket{source="default",le="500"} 2`);
        expect(text).toContain(`${DB_POOL_WAIT_METRIC}_bucket{source="default",le="+Inf"} 2`);
        expect(text).toContain(`${DB_POOL_WAIT_METRIC}_sum{source="default"} 290.400`);
        expect(text).toContain(`${DB_POOL_WAIT_METRIC}_count{source="default"} 2`);
    });

    it("times a checkout by either form of connect, and through query", async () => {
        const waits: number[] = [];
        const pool = fakePool({ waitMs: 30 });
        expect(timePoolCheckouts(pool, ms => waits.push(ms))).toBe(true);

        await pool.connect();
        await new Promise<void>(resolve => pool.connect(() => resolve()));
        await pool.query("SELECT 1");

        expect(waits).toHaveLength(3);
        for (const ms of waits) expect(ms).toBeGreaterThanOrEqual(25);
    });

    it("records no wait for a checkout that failed, and does not time a pool twice", async () => {
        const waits: number[] = [];
        const pool = fakePool({ waitMs: 1, fail: true });
        timePoolCheckouts(pool, ms => waits.push(ms));
        expect(timePoolCheckouts(pool, ms => waits.push(ms))).toBe(false);

        await expect(pool.connect()).rejects.toThrow("ECONNREFUSED");
        await expect(pool.query("SELECT 1")).rejects.toThrow("ECONNREFUSED");
        expect(waits).toEqual([]);
    });

    it("is fed by every pool-based data source the runtime booted", async () => {
        const registry = new MetricsRegistry();
        const main = fakePool({ waitMs: 1 });
        const analytics = fakePool({ waitMs: 1 });
        recordPoolWaits(registry, [
            { key: "default", connection: { pool: main } },
            { key: "analytics", connection: { pool: analytics } },
            { key: "mongo", connection: {} }
        ]);

        await main.query("SELECT 1");
        await analytics.connect();
        await analytics.connect();

        const text = registry.render();
        expect(text).toContain(`${DB_POOL_WAIT_METRIC}_count{source="default"} 1`);
        expect(text).toContain(`${DB_POOL_WAIT_METRIC}_count{source="analytics"} 2`);
    });

    it("is wired by the runtime boot, beside the request metrics", () => {
        const boot = readFileSync(path.join(__dirname, "../src/boot/boot.ts"), "utf8");
        expect(boot).toMatch(/if \(metrics\) \{[\s\S]*?app\.use\("\/\*", metrics\.middleware\);[\s\S]*?recordPoolWaits\(metrics\.registry, dataSources\);/);
    });
});
