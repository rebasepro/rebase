import { describe, it, expect, jest } from "@jest/globals";

jest.mock("@rebasepro/server", () => ({
    logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }
}));

import { poolStatsOf, sampleDatabaseHealth } from "../src/database-health";

/** A pool that answers each statement by what it asks about, or fails it. */
function answering(answers: { connections?: unknown[]; max?: string; bytes?: string; lag?: number | null }, failing: RegExp[] = []) {
    return {
        query: async (text: string) => {
            if (failing.some(pattern => pattern.test(text))) throw new Error("permission denied");
            if (/pg_stat_activity/.test(text)) return { rows: answers.connections ?? [] };
            if (/max_connections/.test(text)) return { rows: [{ max: answers.max }] };
            if (/pg_database_size/.test(text)) return { rows: [{ bytes: answers.bytes }] };
            if (/pg_is_in_recovery/.test(text)) return { rows: [{ lag_ms: answers.lag }] };
            throw new Error(`unexpected: ${text}`);
        }
    };
}

describe("sampleDatabaseHealth", () => {
    it("reads connections by state, the limit, the size and the replica's lag", async () => {
        const sample = await sampleDatabaseHealth(
            answering({ connections: [{ state: "active", count: 2 }, { state: "idle", count: 9 }], max: "76", bytes: "8192" }) as never,
            answering({ lag: 250 }) as never
        );
        expect(sample).toEqual({
            connections: { active: 2, idle: 9 },
            maxConnections: 76,
            sizeBytes: 8192,
            replicaLagSeconds: 0.25
        });
    });

    it("leaves out what it could not read, rather than reporting zero", async () => {
        const sample = await sampleDatabaseHealth(
            answering({ max: "100", bytes: "1" }, [/pg_stat_activity/, /pg_database_size/]) as never
        );
        expect(sample).toEqual({ maxConnections: 100 });
    });

    it("reports no lag without a replica, or when the replica cannot say", async () => {
        expect((await sampleDatabaseHealth(answering({ max: "1" }) as never)).replicaLagSeconds).toBeUndefined();
        expect((await sampleDatabaseHealth(answering({ max: "1" }) as never, answering({ lag: null }) as never)).replicaLagSeconds)
            .toBeUndefined();
    });
});

describe("poolStatsOf", () => {
    it("names the pool and copies the three counts", () => {
        expect(poolStatsOf({ totalCount: 3, idleCount: 1, waitingCount: 4 }, "read"))
            .toEqual({ pool: "read", total: 3, idle: 1, waiting: 4 });
    });
});
