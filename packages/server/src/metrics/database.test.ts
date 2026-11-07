import { describe, it, expect, jest } from "@jest/globals";
import type { DatabaseHealthSample, SQLAdmin } from "@rebasepro/types";
import { MetricsRegistry } from "./index";
import {
    applyHealthSample,
    noteDbConnectionError,
    recordDatabasePools,
    startDatabaseProbe,
    type MeteredSource
} from "./database";

function sqlAdmin(extra: Pick<SQLAdmin, "poolStats" | "sampleHealth">): SQLAdmin {
    return { executeSql: async () => [], ...extra };
}

describe("database metrics", () => {
    it("reports the server's pool and the driver's own pools per source", () => {
        const registry = new MetricsRegistry();
        const sources: MeteredSource[] = [{
            key: "(default)",
            pool: { totalCount: 7, idleCount: 2, waitingCount: 3 },
            admin: () => sqlAdmin({ poolStats: () => [{ pool: "read", total: 4, idle: 4, waiting: 0 }] })
        }];
        recordDatabasePools(registry, sources);

        const text = registry.render();
        expect(text).toContain('rebase_db_pool_connections{pool="primary",source="(default)"} 7');
        expect(text).toContain('rebase_db_pool_idle{pool="primary",source="(default)"} 2');
        expect(text).toContain('rebase_db_pool_waiting{pool="primary",source="(default)"} 3');
        expect(text).toContain('rebase_db_pool_connections{pool="read",source="(default)"} 4');
    });

    it("reads the pools at each render, not once", () => {
        const registry = new MetricsRegistry();
        const pool = { totalCount: 1, idleCount: 1, waitingCount: 0 };
        recordDatabasePools(registry, [{ key: "db", pool, admin: () => undefined }]);
        expect(registry.render()).toContain('rebase_db_pool_connections{pool="primary",source="db"} 1');
        pool.totalCount = 9;
        expect(registry.render()).toContain('rebase_db_pool_connections{pool="primary",source="db"} 9');
    });

    it("reports connection errors by code as a counter", () => {
        const registry = new MetricsRegistry();
        recordDatabasePools(registry, []);
        noteDbConnectionError("53300");
        const text = registry.render();
        expect(text).toMatch(/# TYPE rebase_db_connection_errors_total counter/);
        expect(text).toMatch(/rebase_db_connection_errors_total\{code="53300"\} [1-9]/);
    });

    it("writes a health sample as gauges, leaving out what the sample lacks", () => {
        const registry = new MetricsRegistry();
        const sample: DatabaseHealthSample = {
            connections: { active: 3, idle: 10 },
            maxConnections: 76,
            sizeBytes: 123456,
            replicaLagSeconds: 0.25
        };
        applyHealthSample(registry, "(default)", sample);
        applyHealthSample(registry, "analytics", { maxConnections: 100 });
        const text = registry.render();
        expect(text).toContain('rebase_db_connections{source="(default)",state="active"} 3');
        expect(text).toContain('rebase_db_connections{source="(default)",state="idle"} 10');
        expect(text).toContain('rebase_db_max_connections{source="(default)"} 76');
        expect(text).toContain('rebase_db_size_bytes{source="(default)"} 123456');
        expect(text).toContain('rebase_db_replica_lag_seconds{source="(default)"} 0.25');
        expect(text).toContain('rebase_db_max_connections{source="analytics"} 100');
        expect(text).not.toContain('rebase_db_size_bytes{source="analytics"}');
    });

    it("samples every source with a sampleHealth on start and on each interval, and stops", async () => {
        jest.useFakeTimers();
        try {
            const registry = new MetricsRegistry();
            const sampleHealth = jest.fn(async (): Promise<DatabaseHealthSample> => ({ maxConnections: 50 }));
            const stop = startDatabaseProbe(registry, [
                { key: "a", admin: () => sqlAdmin({ sampleHealth }) },
                { key: "b", admin: () => undefined }
            ], 1000);
            await Promise.resolve();
            expect(sampleHealth).toHaveBeenCalledTimes(1);
            await jest.advanceTimersByTimeAsync(1000);
            expect(sampleHealth).toHaveBeenCalledTimes(2);
            stop();
            await jest.advanceTimersByTimeAsync(5000);
            expect(sampleHealth).toHaveBeenCalledTimes(2);
            expect(registry.render()).toContain('rebase_db_max_connections{source="a"} 50');
        } finally {
            jest.useRealTimers();
        }
    });

    it("keeps the last values when a sample fails", async () => {
        const registry = new MetricsRegistry();
        applyHealthSample(registry, "a", { maxConnections: 76 });
        const stop = startDatabaseProbe(registry, [{
            key: "a",
            admin: () => sqlAdmin({ sampleHealth: async () => { throw new Error("connection refused"); } })
        }], 60_000);
        await new Promise(resolve => setImmediate(resolve));
        stop();
        expect(registry.render()).toContain('rebase_db_max_connections{source="a"} 76');
    });
});
