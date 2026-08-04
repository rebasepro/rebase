import { describe, it, expect, jest } from "@jest/globals";
import { createCronStore } from "./cron-store";
import type { DataDriver } from "@rebasepro/types";

// ─── Helpers ────────────────────────────────────────────────────────

type ExecuteSql = (sql: string, options?: { params?: unknown[] }) => Promise<Record<string, unknown>[]>;

function makeDriver(executeSql: ExecuteSql): DataDriver {
    return { admin: { executeSql } } as unknown as DataDriver;
}

// ─── Tests ──────────────────────────────────────────────────────────

describe("createCronStore", () => {
    it("returns undefined for drivers without SQL admin", () => {
        expect(createCronStore({} as DataDriver)).toBeUndefined();
        expect(createCronStore({ admin: {} } as DataDriver)).toBeUndefined();
    });

    describe("ensureTable", () => {
        it("creates the logs and claims tables and prunes stale claims", async () => {
            const statements: string[] = [];
            const store = createCronStore(makeDriver(async (sql) => {
                statements.push(sql);
                return [];
            }))!;
            await store.ensureTable();
            const all = statements.join("\n");
            expect(all).toContain("CREATE TABLE IF NOT EXISTS rebase.cron_logs");
            expect(all).toContain("CREATE TABLE IF NOT EXISTS rebase.cron_claims");
            expect(all).toContain("PRIMARY KEY (job_id, slot)");
            expect(all).toContain("DELETE FROM rebase.cron_claims");
        });

        it("releases claims on slots that have not happened yet", async () => {
            const statements: string[] = [];
            const params: unknown[][] = [];
            const store = createCronStore(makeDriver(async (sql, options) => {
                statements.push(sql);
                if (options?.params) params.push(options.params);
                return [];
            }))!;
            await store.ensureTable();

            const sweep = statements.find(s => s.includes("slot > now()"));
            expect(sweep).toBeDefined();
            expect(sweep).toContain("DELETE FROM rebase.cron_claims");
            // A stranded claim is only recoverable if the sweep reports it.
            expect(sweep).toContain("RETURNING job_id, slot");
            // Minutes, not days — a stranded claim must not wait out the
            // retention window before its job can run again.
            expect(sweep).toContain("make_interval(mins =>");
            expect(params).toContainEqual([2]);
        });

        it("survives a driver that returns no rows from the sweep", async () => {
            const store = createCronStore(makeDriver(async () => undefined as never))!;
            await expect(store.ensureTable()).resolves.toBeUndefined();
        });
    });

    describe("tryClaimRun", () => {
        const SLOT = "2026-07-18T12:00:00.000Z";

        it("returns true when the insert wins (row returned)", async () => {
            const exec = jest.fn<ExecuteSql>().mockResolvedValue([{ job_id: "j1" }]);
            const store = createCronStore(makeDriver(exec))!;
            await expect(store.tryClaimRun("j1", SLOT)).resolves.toBe(true);
            const [sql, options] = exec.mock.calls[0]!;
            expect(sql).toContain("INSERT INTO rebase.cron_claims");
            expect(sql).toContain("ON CONFLICT (job_id, slot) DO NOTHING");
            expect(options?.params).toEqual(["j1", SLOT]);
        });

        it("returns false when the slot is already claimed (no row returned)", async () => {
            const store = createCronStore(makeDriver(async () => []))!;
            await expect(store.tryClaimRun("j1", SLOT)).resolves.toBe(false);
        });

        it("returns false on a unique violation surfaced as an error", async () => {
            const pgError = Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" });
            const store = createCronStore(makeDriver(async () => { throw pgError; }))!;
            await expect(store.tryClaimRun("j1", SLOT)).resolves.toBe(false);
        });

        it("returns false when the unique violation is buried in the cause chain (Drizzle)", async () => {
            const pgError = Object.assign(new Error("duplicate key"), { code: "23505" });
            const wrapped = new Error("Failed query: INSERT ...", { cause: pgError });
            const store = createCronStore(makeDriver(async () => { throw wrapped; }))!;
            await expect(store.tryClaimRun("j1", SLOT)).resolves.toBe(false);
        });

        it("returns false on a SQLite-style unique violation", async () => {
            const store = createCronStore(makeDriver(async () => {
                throw new Error("UNIQUE constraint failed: cron_claims.job_id, cron_claims.slot");
            }))!;
            await expect(store.tryClaimRun("j1", SLOT)).resolves.toBe(false);
        });

        it("fails open (returns true) on unrelated store errors", async () => {
            const store = createCronStore(makeDriver(async () => { throw new Error("connection refused"); }))!;
            await expect(store.tryClaimRun("j1", SLOT)).resolves.toBe(true);
        });
    });
});
