import { createHealthCheck, AUTH_SCHEMA_RECHECK_MS, DATABASE_PROBE_TIMEOUT_MS } from "../src/init/health";
import type { AuthSchemaHealth, DataDriver } from "@rebasepro/types";

/**
 * `/health` under load. It asked `SELECT 1` through the pool every request
 * shares, so a pool whose connections were all serving slow requests made the
 * readiness probe (3 s) give up, and a pod that was serving — slowly — was
 * taken out of the Service: with one pod, nothing served at all. A driver that
 * can probe on a connection of its own is asked that way, within a timeout
 * under the probe's, and a healthy auth-schema answer is reused for a minute
 * instead of queueing a catalogue query behind the load every few seconds.
 */
function probingDriver(probe: (timeoutMs: number) => Promise<void>, onExecuteSql: () => void = () => {}): DataDriver {
    return {
        admin: {
            executeSql: async () => {
                onExecuteSql();
                return [];
            },
            probe
        }
    } as unknown as DataDriver;
}

const healthySchema: AuthSchemaHealth = { healthy: true, problems: [] };

describe("the health check with a busy pool", () => {
    it("probes on the driver's own connection, not through the pool, with a timeout under the readiness probe's", async () => {
        const timeouts: number[] = [];
        let pooled = 0;
        const check = createHealthCheck(probingDriver(async (ms) => { timeouts.push(ms); }, () => pooled++));

        const result = await check();

        expect(result.healthy).toBe(true);
        expect(timeouts).toEqual([DATABASE_PROBE_TIMEOUT_MS]);
        expect(DATABASE_PROBE_TIMEOUT_MS).toBeLessThan(3_000);
        expect(pooled).toBe(0);
    });

    it("is unhealthy when the probe fails: a database that does not answer is still down", async () => {
        const check = createHealthCheck(probingDriver(async () => { throw new Error("connect ECONNREFUSED 10.0.0.1:5432"); }));

        const result = await check();

        expect(result.healthy).toBe(false);
        expect(result.details).toEqual({ error: "connect ECONNREFUSED 10.0.0.1:5432" });
    });

    it("reuses a healthy auth-schema answer for a minute", async () => {
        let asked = 0;
        const now = jest.spyOn(Date, "now").mockReturnValue(1_000_000);
        try {
            const check = createHealthCheck(probingDriver(async () => {}), async () => { asked++; return healthySchema; });
            await check();
            await check();
            expect(asked).toBe(1);
            now.mockReturnValue(1_000_000 + AUTH_SCHEMA_RECHECK_MS + 1);
            await check();
            expect(asked).toBe(2);
        } finally {
            now.mockRestore();
        }
    });

    it("never reuses an unhealthy auth-schema answer", async () => {
        const answers: AuthSchemaHealth[] = [{ healthy: false, problems: ["mismatch"] }, healthySchema];
        let asked = 0;
        const check = createHealthCheck(probingDriver(async () => {}), async () => answers[Math.min(asked++, 1)]);

        expect((await check()).healthy).toBe(false);
        expect((await check()).healthy).toBe(true);
        expect(asked).toBe(2);
    });
});
