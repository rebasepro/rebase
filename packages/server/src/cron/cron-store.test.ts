import { describe, it, expect, jest, afterEach } from "@jest/globals";
import { createCronStore } from "./cron-store";
import { logger } from "../utils/logger";
import type { DataDriver } from "@rebasepro/types";

// ─── Helpers ────────────────────────────────────────────────────────

type ExecuteSql = (sql: string, options?: { params?: unknown[] }) => Promise<Record<string, unknown>[]>;

function makeDriver(executeSql: ExecuteSql): DataDriver {
    return { admin: { executeSql } } as unknown as DataDriver;
}

/**
 * A driver that records every statement and lets a test make chosen ones fail.
 * `behaviour` throws to fail the statement it is handed.
 */
function recordingDriver(behaviour: (sql: string) => void = () => { /* succeed */ }) {
    const statements: string[] = [];
    const driver = makeDriver(async (sql) => {
        statements.push(sql);
        behaviour(sql);
        return [];
    });
    return {
        driver,
        statements
    };
}

/** A driver error shaped the way Drizzle surfaces one: the real error in `.cause`. */
function drizzleError(code: string, message: string): Error {
    return new Error("Failed query: …", { cause: Object.assign(new Error(message), { code }) });
}

/** The duplicate-key a losing `CREATE … IF NOT EXISTS` actually raises. */
const catalogRace = () => drizzleError(
    "23505",
    'duplicate key value violates unique constraint "pg_type_typname_nsp_index"'
);

const revokesIn = (statements: string[]) =>
    statements.filter(s => s.includes("REVOKE ALL ON"));

afterEach(() => {
    jest.restoreAllMocks();
});

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

    // ── Simultaneous boot ────────────────────────────────────────────
    //
    // Every replica calls ensureTable at once on a rolling deploy. `CREATE …
    // IF NOT EXISTS` checks the catalog and then writes to it non-atomically,
    // so the losers get a duplicate key on a catalog index rather than the
    // no-op the syntax suggests.

    describe("concurrent boot", () => {
        it("retries a create that lost the race to another instance", async () => {
            let attempts = 0;
            const { driver, statements } = recordingDriver((sql) => {
                if (sql.includes(`CREATE TABLE IF NOT EXISTS rebase.cron_claims`)) {
                    attempts++;
                    if (attempts < 3) throw catalogRace();
                }
            });

            await createCronStore(driver)!.ensureTable();

            expect(attempts).toBe(3);
            // Having retried its way through, the instance carries on to the
            // sweeps and the revokes like any other.
            expect(statements.some(s => s.includes("DELETE FROM rebase.cron_claims"))).toBe(true);
            expect(revokesIn(statements)).toHaveLength(2);
        });

        it("stops retrying after a bounded number of attempts", async () => {
            let attempts = 0;
            const { driver } = recordingDriver((sql) => {
                if (sql.includes("CREATE SCHEMA")) {
                    attempts++;
                    throw catalogRace();
                }
            });

            await createCronStore(driver)!.ensureTable();

            // Bounded — a permanently failing statement must not spin.
            expect(attempts).toBe(4);
        });

        it("does not retry an error that is not a create race", async () => {
            let attempts = 0;
            const { driver } = recordingDriver((sql) => {
                if (sql.includes("CREATE TABLE IF NOT EXISTS rebase.cron_logs")) {
                    attempts++;
                    throw drizzleError("42501", "permission denied for schema rebase");
                }
            });

            await createCronStore(driver)!.ensureTable();

            // A real failure has to surface at once, not be reported four
            // attempts later as a race it never was.
            expect(attempts).toBe(1);
        });

        it("keeps building the claims table when an earlier statement fails hard", async () => {
            // The failure that motivated this: one dead statement used to
            // abandon everything after it, and the claims table — the only
            // thing coordinating the fleet — came after the logs index.
            const { driver, statements } = recordingDriver((sql) => {
                if (sql.includes("CREATE INDEX")) throw new Error("out of disk space");
            });

            await createCronStore(driver)!.ensureTable();

            expect(statements.some(s => s.includes("CREATE TABLE IF NOT EXISTS rebase.cron_claims"))).toBe(true);
            expect(revokesIn(statements)).toHaveLength(2);
        });

        it("revokes end-user access even when a claim sweep fails", async () => {
            // The revoke is a security control: a writable cron_claims lets any
            // signed-in user suppress a scheduled run. It cannot be collateral
            // damage from a failed housekeeping query.
            const { driver, statements } = recordingDriver((sql) => {
                if (sql.includes("DELETE FROM rebase.cron_claims")) throw new Error("sweep exploded");
            });

            await createCronStore(driver)!.ensureTable();

            const revokes = revokesIn(statements);
            expect(revokes).toHaveLength(2);
            expect(revokes.some(s => s.includes("cron_claims"))).toBe(true);
            expect(revokes.some(s => s.includes("cron_logs"))).toBe(true);
        });

        it("reports the loss of coordination when the claims table is unusable", async () => {
            const errors: string[] = [];
            jest.spyOn(logger, "error").mockImplementation((message: string) => { errors.push(message); });
            jest.spyOn(logger, "info").mockImplementation(() => { /* silence */ });
            jest.spyOn(logger, "warn").mockImplementation(() => { /* silence */ });

            const { driver } = recordingDriver((sql) => {
                if (sql.includes("cron_claims")) {
                    throw new Error('relation "rebase.cron_claims" does not exist');
                }
            });

            await createCronStore(driver)!.ensureTable();

            // The old message — "Continuing without cron log persistence" —
            // named the wrong casualty. Losing claims means losing the only
            // thing that stops N instances running the same job N times.
            expect(errors.some(m => /every instance will now run every job/i.test(m))).toBe(true);
        });

        it("says nothing alarming when both tables are fine", async () => {
            const errors: string[] = [];
            jest.spyOn(logger, "error").mockImplementation((message: string) => { errors.push(message); });
            jest.spyOn(logger, "info").mockImplementation(() => { /* silence */ });

            await createCronStore(recordingDriver().driver)!.ensureTable();

            expect(errors).toHaveLength(0);
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
