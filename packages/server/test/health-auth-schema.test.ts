import { createHealthCheck } from "../src/init/health";
import type { AuthSchemaHealth, DataDriver } from "@rebasepro/types";

/**
 * `/health` has to answer "can this server serve requests", not "is the database
 * reachable". Those came apart in the worst possible way once an auth migration
 * became one-way: an older runtime deployed against an already-migrated database
 * booted cleanly, answered `SELECT 1` in a millisecond, reported 200 — and
 * failed every login and token refresh with SQLSTATE 42P10. The orchestrator
 * kept routing traffic to it because nothing it probed was broken.
 *
 * So the database probe passing is necessary but not sufficient, which is what
 * these tests pin.
 */
function driver(onQuery: () => void = () => {}): DataDriver {
    return {
        admin: {
            executeSql: async () => {
                onQuery();
                return { rows: [] };
            }
        }
    } as unknown as DataDriver;
}

const healthySchema: AuthSchemaHealth = { healthy: true, problems: [] };

describe("createHealthCheck", () => {
    it("is healthy when the database answers and no auth probe is supplied", async () => {
        // An AuthAdapter deployment, or one with no auth at all, has nothing to
        // probe. Absence of the check must not read as failure.
        const result = await createHealthCheck(driver())();

        expect(result.healthy).toBe(true);
        expect(result.details).toBeUndefined();
    });

    it("is healthy when the database answers and the auth schema matches", async () => {
        const result = await createHealthCheck(driver(), async () => healthySchema)();

        expect(result.healthy).toBe(true);
    });

    it("is UNHEALTHY when the database is reachable but the auth schema is not servable", async () => {
        // The regression this whole change exists for. Before it, this case
        // returned `healthy: true`.
        const mismatch: AuthSchemaHealth = {
            healthy: false,
            problems: ["database is at auth schema version 3, this runtime understands 2"],
            databaseVersion: 3,
            runtimeVersion: 2
        };

        const result = await createHealthCheck(driver(), async () => mismatch)();

        expect(result.healthy).toBe(false);
        expect(result.details).toEqual({ authSchema: mismatch });
    });

    it("still probes the database first, so a dead database is not masked by a passing auth probe", async () => {
        const dead = {
            admin: {
                executeSql: async () => {
                    throw new Error("ECONNREFUSED");
                }
            }
        } as unknown as DataDriver;

        const result = await createHealthCheck(dead, async () => healthySchema)();

        expect(result.healthy).toBe(false);
        expect(result.details?.error).toContain("ECONNREFUSED");
    });

    it("reports latency on the unhealthy-schema path too", async () => {
        // An orchestrator that graphs latency should not see a gap when the
        // server goes degraded.
        const result = await createHealthCheck(driver(), async () => ({
            healthy: false,
            problems: ["refresh_tokens is missing session_id"]
        }))();

        expect(result.healthy).toBe(false);
        expect(typeof result.latencyMs).toBe("number");
    });
});
