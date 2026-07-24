import { probeDataSource } from "../src/boot/driver";
import type { InitializedDataSource } from "../src/boot/driver";

/**
 * Probing secondary data sources for health.
 *
 * The default source is covered by `backend.healthCheck()`. Everything else is
 * covered only by this, and a probe that silently never runs is worse than no
 * probe: `/health` would keep answering 200 while every collection routed to an
 * unreachable database returns 500, and an orchestrator would keep sending it
 * traffic.
 *
 * The first version of this probe looked for `connection.query`, which the
 * Postgres driver does not expose — the query lives on `connection.pool`. It
 * therefore skipped every source and reported everything healthy. Hence the
 * tests below pin *where* the probe looks.
 */
function source(connection: Partial<InitializedDataSource["connection"]>): InitializedDataSource {
    return {
        key: "analytics",
        engine: "postgres",
        driverPackage: "@rebasepro/server-postgres",
        bootstrapper: { type: "postgres", initializeDriver: async () => ({}) } as never,
        connection: connection as InitializedDataSource["connection"]
    };
}

describe("probeDataSource", () => {
    it("queries through the pool, which is where the driver puts it", async () => {
        const calls: string[] = [];
        const result = await probeDataSource(source({
            db: {},
            pool: {
                end: async () => {},
                query: async (sql: string) => {
                    calls.push(sql);
                    return {};
                }
            }
        }));

        expect(result).toEqual({ healthy: true });
        expect(calls).toEqual(["SELECT 1"]);
    });

    it("reports the failure when the source cannot answer", async () => {
        const result = await probeDataSource(source({
            db: {},
            pool: {
                end: async () => {},
                query: async () => {
                    throw new Error("ECONNREFUSED");
                }
            }
        }));

        expect(result?.healthy).toBe(false);
        expect(result?.error).toContain("ECONNREFUSED");
    });

    it("accepts a driver that exposes query directly", async () => {
        const result = await probeDataSource(source({
            db: {},
            query: async () => ({})
        }));

        expect(result).toEqual({ healthy: true });
    });

    it("returns undefined when there is no way to ask", async () => {
        // Unknown, not unhealthy — a driver that cannot be probed must not fail
        // the health check.
        expect(await probeDataSource(source({ db: {} }))).toBeUndefined();
        expect(await probeDataSource(source({ db: {},
            pool: { end: async () => {} } }))).toBeUndefined();
    });
});
