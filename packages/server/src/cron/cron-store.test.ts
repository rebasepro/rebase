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

        it("creates the job state table, with the lease columns, and revokes it", async () => {
            // The table every replica reads a pause from, and the lease that
            // keeps a manual trigger off a run another process is making. An
            // aged database gains it on its next boot, from this statement.
            const { driver, statements } = recordingDriver();
            await createCronStore(driver)!.ensureTable();

            const create = statements.find(s => s.includes("CREATE TABLE IF NOT EXISTS rebase.cron_job_state"));
            expect(create).toBeDefined();
            expect(create).toContain("job_id TEXT PRIMARY KEY");
            // NULL is "follow the code", so the column must allow it.
            expect(create).toMatch(/enabled BOOLEAN(,|\s)/);
            expect(create).not.toMatch(/enabled BOOLEAN NOT NULL/);
            expect(create).toContain("running_until TIMESTAMPTZ");
            expect(create).toContain("running_by TEXT");

            expect(revokesIn(statements).some(s => s.includes("\"cron_job_state\""))).toBe(true);
        });

        it("indexes the failed runs, so the per-job failure count reads only those", async () => {
            const { driver, statements } = recordingDriver();
            await createCronStore(driver)!.ensureTable();

            const index = statements.find(s => s.includes("idx_cron_logs_job_failures"));
            expect(index).toContain("CREATE INDEX IF NOT EXISTS");
            expect(index).toContain("WHERE NOT success");
        });

        it("says what is lost when the job state table is unusable", async () => {
            const warnings: string[] = [];
            jest.spyOn(logger, "warn").mockImplementation((message: string) => { warnings.push(message); });
            jest.spyOn(logger, "info").mockImplementation(() => { /* silence */ });

            const { driver } = recordingDriver((sql) => {
                if (sql.includes("cron_job_state")) throw new Error('relation "rebase.cron_job_state" does not exist');
            });
            await createCronStore(driver)!.ensureTable();

            expect(warnings.some(m => /pausing a job .*only the process/i.test(m))).toBe(true);
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
            expect(revokesIn(statements)).toHaveLength(3);
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
            expect(statements.some(s => s.includes("CREATE TABLE IF NOT EXISTS rebase.cron_job_state"))).toBe(true);
            expect(revokesIn(statements)).toHaveLength(3);
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
            expect(revokes).toHaveLength(3);
            expect(revokes.some(s => s.includes("cron_claims"))).toBe(true);
            expect(revokes.some(s => s.includes("cron_logs"))).toBe(true);
            expect(revokes.some(s => s.includes("cron_job_state"))).toBe(true);
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

        it("throws on an unrelated store error, so the caller decides what an unknown means", async () => {
            // Not `true`. The store cannot tell whether the slot already ran,
            // and the scheduler's two callers want opposite answers to that:
            // a scheduled run fails open, a catch-up fails closed. Answering
            // `true` here decided for both, and made the catch-up's fail-closed
            // branch unreachable.
            const store = createCronStore(makeDriver(async () => {
                throw drizzleError("42P01", 'relation "rebase.cron_claims" does not exist');
            }))!;
            await expect(store.tryClaimRun("j1", SLOT)).rejects.toThrow("Failed query");
        });
    });

    // ── The fleet-wide job state ─────────────────────────────────────

    describe("saveEnabledOverride", () => {
        it("upserts the override with who made it", async () => {
            const exec = jest.fn<ExecuteSql>().mockResolvedValue([]);
            await createCronStore(makeDriver(exec))!.saveEnabledOverride("nightly", false, "admin-uid");

            const [sql, options] = exec.mock.calls[0]!;
            expect(sql).toContain("INSERT INTO rebase.cron_job_state");
            expect(sql).toContain("ON CONFLICT (job_id) DO UPDATE");
            expect(sql).toContain("updated_at = now()");
            expect(options?.params).toEqual(["nightly", false, "admin-uid"]);
        });

        it("writes NULL to hand the decision back to the code", async () => {
            const exec = jest.fn<ExecuteSql>().mockResolvedValue([]);
            await createCronStore(makeDriver(exec))!.saveEnabledOverride("nightly", null);

            expect(exec.mock.calls[0]![1]?.params).toEqual(["nightly", null, null]);
        });

        it("does not swallow a failed write", async () => {
            // A pause that was not saved must not be answered as one that was:
            // the route turns this into an error, rather than a 200 that only
            // the replica serving it believes.
            const store = createCronStore(makeDriver(async () => {
                throw drizzleError("42P01", 'relation "rebase.cron_job_state" does not exist');
            }))!;
            await expect(store.saveEnabledOverride("nightly", false)).rejects.toThrow("Failed query");
        });
    });

    describe("fetchJobStates", () => {
        it("reads the override and a live lease for the jobs asked about", async () => {
            const exec = jest.fn<ExecuteSql>().mockResolvedValue([
                { job_id: "paused", enabled: false, running_by: null },
                { job_id: "busy", enabled: null, running_by: "worker-1:42#ab12" }
            ]);
            const states = await createCronStore(makeDriver(exec))!.fetchJobStates(["paused", "busy", "untouched"]);

            expect(states.get("paused")).toEqual({ enabled: false, runningBy: undefined });
            expect(states.get("busy")).toEqual({ enabled: null, runningBy: "worker-1:42#ab12" });
            // No row is no override: the code decides.
            expect(states.has("untouched")).toBe(false);

            const [sql, options] = exec.mock.calls[0]!;
            // An expired lease is nobody's: only a live one is reported.
            expect(sql).toContain("running_until > now()");
            // One placeholder per job, as the job store does: every driver
            // binds a string, not every driver binds an array.
            expect(sql).toContain("IN ($1, $2, $3)");
            expect(options?.params).toEqual(["paused", "busy", "untouched"]);
        });

        it("asks nothing for no jobs", async () => {
            const exec = jest.fn<ExecuteSql>().mockResolvedValue([]);
            await expect(createCronStore(makeDriver(exec))!.fetchJobStates([])).resolves.toEqual(new Map());
            expect(exec).not.toHaveBeenCalled();
        });

        it("throws when it cannot tell, so the caller decides", async () => {
            // The scheduler falls back to the code's `enabled` on a failed read.
            // Answering "no override" here would make that decision for it and
            // hide the failure.
            const store = createCronStore(makeDriver(async () => {
                throw drizzleError("42P01", 'relation "rebase.cron_job_state" does not exist');
            }))!;
            await expect(store.fetchJobStates(["j1"])).rejects.toThrow("Failed query");
        });
    });

    describe("tryAcquireRunLease", () => {
        it("takes the lease only when nobody holds a live one", async () => {
            const exec = jest.fn<ExecuteSql>().mockResolvedValue([{ acquired: true, holder: null }]);
            const lease = await createCronStore(makeDriver(exec))!.tryAcquireRunLease("j1", "api-1:7#x", 330);

            expect(lease).toEqual({ acquired: true });
            const [sql, options] = exec.mock.calls[0]!;
            expect(sql).toContain("INSERT INTO rebase.cron_job_state");
            expect(sql).toContain("ON CONFLICT (job_id) DO UPDATE");
            // The whole exclusion: an update that only happens over a lease
            // that is absent or already expired.
            expect(sql).toMatch(/WHERE s\.running_until IS NULL OR s\.running_until <= now\(\)/);
            expect(sql).toContain("make_interval(secs =>");
            expect(options?.params).toEqual(["j1", 330, "api-1:7#x"]);
        });

        it("reports who holds it when it is taken", async () => {
            const store = createCronStore(makeDriver(async () => [{ acquired: false, holder: "worker-1:42#ab12" }]))!;
            await expect(store.tryAcquireRunLease("j1", "api-1:7#x", 330))
                .resolves.toEqual({ acquired: false, holder: "worker-1:42#ab12" });
        });

        it("throws when the database gives no answer at all", async () => {
            // The statement always returns one row. None means the store does
            // not know — and "taken" would silently skip the run, "free" would
            // claim a lease nobody wrote.
            const store = createCronStore(makeDriver(async () => []))!;
            await expect(store.tryAcquireRunLease("j1", "api-1:7#x", 330)).rejects.toThrow(/no answer/i);
        });

        it("throws on a driver error", async () => {
            const store = createCronStore(makeDriver(async () => {
                throw drizzleError("42P01", 'relation "rebase.cron_job_state" does not exist');
            }))!;
            await expect(store.tryAcquireRunLease("j1", "api-1:7#x", 330)).rejects.toThrow("Failed query");
        });
    });

    describe("releaseRunLease", () => {
        it("clears only the lease this run took", async () => {
            // Keyed on the holder, so a run that outlived its own lease cannot
            // release the one another process has taken since.
            const exec = jest.fn<ExecuteSql>().mockResolvedValue([]);
            await createCronStore(makeDriver(exec))!.releaseRunLease("j1", "api-1:7#x");

            const [sql, options] = exec.mock.calls[0]!;
            expect(sql).toContain("SET running_until = NULL, running_by = NULL");
            expect(sql).toContain("WHERE job_id = $1 AND running_by = $2");
            expect(options?.params).toEqual(["j1", "api-1:7#x"]);
        });
    });

    describe("fetchRunSummaries", () => {
        it("reads each job's count and last run from its own rows", async () => {
            const exec = jest.fn<ExecuteSql>().mockResolvedValue([
                {
                    job_id: "nightly",
                    total_runs: 12,
                    total_failures: 2,
                    started_at: "2026-09-20T03:00:00.000Z",
                    duration_ms: 812,
                    success: false,
                    error: "boom"
                },
                { job_id: "never", total_runs: 0, total_failures: 0, started_at: null, duration_ms: null, success: null, error: null }
            ]);
            const summaries = await createCronStore(makeDriver(exec))!.fetchRunSummaries(["nightly", "never"]);

            expect(summaries.get("nightly")).toEqual({
                totalRuns: 12,
                totalFailures: 2,
                lastRunAt: "2026-09-20T03:00:00.000Z",
                lastDurationMs: 812,
                lastSuccess: false,
                lastError: "boom"
            });
            expect(summaries.get("never")).toEqual({ totalRuns: 0, totalFailures: 0 });

            const [sql, options] = exec.mock.calls[0]!;
            // Bounded per job: the job's own index range, never a GROUP BY over
            // every row the table has ever held.
            expect(sql).not.toContain("GROUP BY");
            expect(sql).toContain("ORDER BY l.started_at DESC");
            expect(sql).toContain("LIMIT 1");
            expect(sql).toContain("NOT l.success");
            expect(options?.params).toEqual(["nightly", "never"]);
        });

        it("asks nothing for no jobs", async () => {
            const exec = jest.fn<ExecuteSql>().mockResolvedValue([]);
            await expect(createCronStore(makeDriver(exec))!.fetchRunSummaries([])).resolves.toEqual(new Map());
            expect(exec).not.toHaveBeenCalled();
        });
    });
});
