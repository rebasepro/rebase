/**
 * Cron's fleet-wide job state against a real Postgres (PGlite), with two
 * schedulers sharing it the way two replicas share a database.
 *
 * Pausing a job, "already executing" and the Studio's run counters all used to
 * live in one process's memory. So a `PUT /api/admin/cron/:id {enabled:false}`
 * stopped only the replica that served it — nothing at all on the `api` role,
 * whose scheduler never starts — a manual trigger there could run beside the
 * worker's scheduled run, and the Studio showed 0 runs for a job the worker ran
 * every hour. `rebase.cron_job_state` is what they share now.
 *
 * The unit tests hand the scheduler an in-memory store; whether the lease's
 * conditional upsert excludes, whether a NULL override reads back as "follow
 * the code", and whether the per-job count parses and binds are the database's
 * answers, so they are asked of one here. Each scheduler gets a store of its
 * own over the one database — the store holds nothing but the SQL, so that is
 * the same as sharing one, and closer to what replicas do.
 */
import { describe, expect, it, beforeEach, afterEach, jest } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { Hono } from "hono";
import type { CronJobDefinition, DataDriver } from "@rebasepro/types";
import { REBASE_USER_ROLE } from "@rebasepro/common";
import { createCronStore } from "../../server/src/cron/cron-store";
import { CronScheduler } from "../../server/src/cron/cron-scheduler";
import { createCronRoutes } from "../../server/src/cron/cron-routes";
import type { LoadedCronJob } from "../../server/src/cron/cron-loader";
import { logger } from "../../server/src/utils/logger";

/**
 * A driver whose SQL escape hatch is a real database. Parameterised
 * statements go through the extended protocol; the store's parameterless DDL
 * includes multi-statement blocks, which only the simple protocol accepts.
 */
function pgliteDriver(db: PGlite): DataDriver {
    return {
        key: "postgres",
        admin: {
            async executeSql(sql: string, options?: { params?: unknown[] }) {
                if (options?.params) {
                    return (await db.query(sql, options.params)).rows as Record<string, unknown>[];
                }
                const results = await db.exec(sql);
                return (results[results.length - 1]?.rows ?? []) as Record<string, unknown>[];
            }
        }
    } as unknown as DataDriver;
}

const HOUR = 60 * 60 * 1000;

function job(id: string, overrides: Partial<CronJobDefinition> = {}): LoadedCronJob {
    return {
        id,
        definition: {
            schedule: "0 * * * *",
            name: id,
            timeoutSeconds: 7200,
            handler: () => undefined,
            ...overrides
        }
    };
}

let db: PGlite;

/** A replica: its own scheduler, its own store, the shared database. */
function replica(jobs: LoadedCronJob[]): CronScheduler {
    const scheduler = new CronScheduler();
    scheduler.setStore(createCronStore(pgliteDriver(db))!);
    scheduler.registerJobs(jobs);
    return scheduler;
}

async function stateRow(jobId: string) {
    const { rows } = await db.query<{ enabled: boolean | null; updated_by: string | null; running_by: string | null }>(
        "SELECT enabled, updated_by, running_by FROM rebase.cron_job_state WHERE job_id = $1",
        [jobId]
    );
    return rows[0];
}

async function logRows(jobId: string) {
    const { rows } = await db.query<{ manual: boolean; result: unknown; logs: string[] | null }>(
        "SELECT manual, result, logs FROM rebase.cron_logs WHERE job_id = $1 ORDER BY started_at",
        [jobId]
    );
    return rows;
}

describe("two schedulers sharing one database", () => {
    let a: CronScheduler;
    let b: CronScheduler;

    beforeEach(async () => {
        db = new PGlite();
        await db.waitReady;
        await createCronStore(pgliteDriver(db))!.ensureTable();
        // The slots are reached by moving the clock, not by waiting an hour;
        // PGlite's own ticks — nextTick, setImmediate, microtasks — stay real.
        // The database's `now()` does not move, so a lease taken here lasts.
        jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate", "queueMicrotask"] });
    });

    afterEach(async () => {
        await a?.stop();
        await b?.stop();
        jest.useRealTimers();
        jest.restoreAllMocks();
        await db.close();
    });

    it("does not run B's next slot after A paused the job, and runs it once the pause is lifted", async () => {
        const runs: string[] = [];
        a = replica([job("report", { handler: () => { runs.push("a"); } })]);
        b = replica([job("report", { handler: () => { runs.push("b"); } })]);
        // A is the api role: it serves the admin API and never starts.
        b.start();

        await a.persistJobEnabled("report", false, "admin-1");
        expect(await stateRow("report")).toMatchObject({ enabled: false, updated_by: "admin-1" });

        await jest.advanceTimersByTimeAsync(HOUR + 60_000);
        expect(runs).toEqual([]);
        // Read before the claim: the paused slot was not spent.
        const { rows: claims } = await db.query("SELECT 1 FROM rebase.cron_claims WHERE job_id = 'report'");
        expect(claims).toHaveLength(0);

        await a.persistJobEnabled("report", null);
        await jest.advanceTimersByTimeAsync(HOUR);
        expect(runs).toEqual(["b"]);
    });

    it("answers 409 to a manual trigger on A while B runs the job, and runs it after", async () => {
        let release!: () => void;
        const gate = new Promise<void>(r => { release = r; });
        const started: string[] = [];
        a = replica([job("sync", { handler: () => { started.push("a"); } })]);
        b = replica([job("sync", { handler: async () => { started.push("b"); await gate; } })]);
        b.start();
        const api = new Hono();
        api.route("/cron", createCronRoutes(a));

        await jest.advanceTimersByTimeAsync(HOUR + 60_000);
        expect(started).toEqual(["b"]);
        expect((await stateRow("sync"))?.running_by).toEqual(expect.stringContaining(":"));

        const refused = await api.request("/cron/sync/trigger", { method: "POST" });
        expect(refused.status).toBe(409);
        const body = await refused.json() as { error: { code: string } };
        expect(body.error.code).toBe("CRON_JOB_ALREADY_EXECUTING");
        expect(started).toEqual(["b"]);
        // In the history, as a manual skip that names B.
        const skip = (await logRows("sync")).find(r => r.manual);
        expect(skip?.result).toEqual({ skipped: true, reason: "already_executing" });
        expect(skip?.logs?.[0]).toMatch(/running on .+:\d+#/);

        // The Studio, reading through A, sees B's run.
        expect((await a.fetchJob("sync"))?.state).toBe("running");

        release();
        await jest.advanceTimersByTimeAsync(1);
        await b.stop();
        expect((await stateRow("sync"))?.running_by).toBeNull();

        const accepted = await api.request("/cron/sync/trigger", { method: "POST" });
        expect(accepted.status).toBe(200);
        expect(started).toEqual(["b", "a"]);
    });

    it("skips B's slot while A's manual run holds the lease", async () => {
        let release!: () => void;
        const gate = new Promise<void>(r => { release = r; });
        const started: string[] = [];
        a = replica([job("sync", { handler: async () => { started.push("a"); await gate; } })]);
        b = replica([job("sync", { handler: () => { started.push("b"); } })]);
        b.start();

        const manual = a.triggerJob("sync");
        await jest.advanceTimersByTimeAsync(HOUR + 60_000);

        expect(started).toEqual(["a"]);
        const scheduledSkip = (await logRows("sync")).find(r => !r.manual);
        expect(scheduledSkip?.result).toEqual({ skipped: true, reason: "already_executing" });

        release();
        await manual;
    });

    it("falls back to the code's enabled when the state cannot be read", async () => {
        const warnings: string[] = [];
        jest.spyOn(logger, "warn").mockImplementation((message: string) => { warnings.push(message); });
        const runs: string[] = [];
        a = replica([job("report", { handler: () => { runs.push("a"); } })]);
        b = replica([job("report", { handler: () => { runs.push("b"); } })]);
        b.start();
        await a.persistJobEnabled("report", false);

        // The table goes away under a running fleet — a restore that predates
        // it, a botched manual migration. The pause is unreadable, not "off".
        await db.exec("ALTER TABLE rebase.cron_job_state RENAME TO cron_job_state_gone");
        await jest.advanceTimersByTimeAsync(HOUR + 60_000);

        expect(runs).toEqual(["b"]);
        expect(warnings.some(m => /enabled state of "report" — falling back to the code/.test(m))).toBe(true);
    });

    it("reads the counts on a scheduler that is not started from cron_logs", async () => {
        const runs: string[] = [];
        a = replica([job("nightly", { handler: () => { runs.push("a"); } })]);
        b = replica([
            job("nightly", {
                handler: () => {
                    runs.push("b");
                    if (runs.length === 2) throw new Error("upstream 502");
                }
            })
        ]);
        b.start();

        await jest.advanceTimersByTimeAsync(2 * HOUR + 60_000);
        await b.stop();
        expect(runs).toEqual(["b", "b"]);

        const status = await a.fetchJob("nightly");
        expect(status).toMatchObject({ totalRuns: 2, totalFailures: 1, state: "error", lastError: "upstream 502" });
        expect(status?.lastRunAt).toBeDefined();
        expect(status?.nextRunAt).toBeDefined();
    });
});

describe("the run lease, in SQL", () => {
    beforeEach(async () => {
        db = new PGlite();
        await db.waitReady;
        await createCronStore(pgliteDriver(db))!.ensureTable();
    });

    afterEach(async () => {
        await db.close();
    });

    it("lets one holder in, names it to the next, and frees it only for its holder", async () => {
        const store = createCronStore(pgliteDriver(db))!;

        await expect(store.tryAcquireRunLease("sync", "worker:1#aa", 60)).resolves.toEqual({ acquired: true });
        await expect(store.tryAcquireRunLease("sync", "api:2#bb", 60))
            .resolves.toEqual({ acquired: false, holder: "worker:1#aa" });

        // A release by anyone else — a run that outlived its own lease — is
        // a no-op.
        await store.releaseRunLease("sync", "api:2#bb");
        await expect(store.tryAcquireRunLease("sync", "api:2#bb", 60)).resolves.toMatchObject({ acquired: false });

        await store.releaseRunLease("sync", "worker:1#aa");
        await expect(store.tryAcquireRunLease("sync", "api:2#bb", 60)).resolves.toEqual({ acquired: true });
    });

    it("lapses on its own, which is what frees a job whose holder crashed", async () => {
        const store = createCronStore(pgliteDriver(db))!;
        await store.tryAcquireRunLease("sync", "crashed:1#aa", 60);
        await db.query("UPDATE rebase.cron_job_state SET running_until = now() - interval '1 second' WHERE job_id = 'sync'");

        await expect(store.tryAcquireRunLease("sync", "worker:2#bb", 60)).resolves.toEqual({ acquired: true });
    });

    it("does not disturb the override on the same row", async () => {
        const store = createCronStore(pgliteDriver(db))!;
        await store.saveEnabledOverride("sync", false, "admin-1");
        await store.tryAcquireRunLease("sync", "worker:1#aa", 60);
        await store.releaseRunLease("sync", "worker:1#aa");

        expect((await store.fetchJobStates(["sync"])).get("sync")).toEqual({ enabled: false, runningBy: undefined });
    });

    it("reads a NULL override back as no override", async () => {
        const store = createCronStore(pgliteDriver(db))!;
        await store.saveEnabledOverride("sync", null);

        expect((await store.fetchJobStates(["sync"])).get("sync")?.enabled).toBeNull();
    });
});

describe("an aged database", () => {
    beforeEach(async () => {
        db = new PGlite();
        await db.waitReady;
    });

    afterEach(async () => {
        await db.close();
    });

    it("gains the job state table on its first boot, locked away from end users", async () => {
        // The database as the store left it before `cron_job_state` existed,
        // with a history, and the schema-wide grant the driver hands the
        // end-user role — which a new table in `rebase` inherits.
        await db.exec(`
            CREATE ROLE ${REBASE_USER_ROLE};
            CREATE SCHEMA rebase;
            ALTER DEFAULT PRIVILEGES IN SCHEMA rebase GRANT ALL ON TABLES TO ${REBASE_USER_ROLE};
            CREATE TABLE rebase.cron_logs (
                id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
                job_id TEXT NOT NULL,
                started_at TIMESTAMPTZ NOT NULL,
                finished_at TIMESTAMPTZ NOT NULL,
                duration_ms INTEGER NOT NULL,
                success BOOLEAN NOT NULL DEFAULT true,
                error TEXT,
                result JSONB,
                logs JSONB,
                manual BOOLEAN NOT NULL DEFAULT false
            );
            CREATE INDEX idx_cron_logs_job ON rebase.cron_logs(job_id, started_at DESC);
            CREATE TABLE rebase.cron_claims (
                job_id TEXT NOT NULL,
                slot TIMESTAMPTZ NOT NULL,
                claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                PRIMARY KEY (job_id, slot)
            );
            INSERT INTO rebase.cron_logs (job_id, started_at, finished_at, duration_ms, success, error)
            VALUES ('nightly', now() - interval '1 day', now() - interval '1 day', 40, false, 'old failure');
        `);
        const before = await db.query<{ present: boolean }>("SELECT to_regclass('rebase.cron_job_state') IS NOT NULL AS present");
        expect(before.rows[0].present).toBe(false);

        const store = createCronStore(pgliteDriver(db))!;
        await store.ensureTable();

        const { rows: columns } = await db.query<{ column_name: string }>(
            `SELECT column_name FROM information_schema.columns
             WHERE table_schema = 'rebase' AND table_name = 'cron_job_state' ORDER BY ordinal_position`
        );
        expect(columns.map(c => c.column_name)).toEqual([
            "job_id", "enabled", "updated_at", "updated_by", "running_until", "running_by"
        ]);
        // Writable by end users, it would let any of them pause a job for the
        // whole fleet or hold its lease so that nothing runs it.
        const { rows: privileges } = await db.query<{ can_write: boolean; can_read: boolean }>(
            `SELECT has_table_privilege($1, 'rebase.cron_job_state', 'UPDATE') AS can_write,
                    has_table_privilege($1, 'rebase.cron_job_state', 'SELECT') AS can_read`,
            [REBASE_USER_ROLE]
        );
        expect(privileges[0]).toEqual({ can_write: false, can_read: false });
        const { rows: index } = await db.query("SELECT 1 FROM pg_indexes WHERE indexname = 'idx_cron_logs_job_failures'");
        expect(index).toHaveLength(1);

        // The history it had is still there, and read through the new query.
        const summary = (await store.fetchRunSummaries(["nightly"])).get("nightly");
        expect(summary).toMatchObject({ totalRuns: 1, totalFailures: 1, lastSuccess: false, lastError: "old failure" });

        // And a pause works on the boot that created the table.
        await store.saveEnabledOverride("nightly", false);
        expect((await store.fetchJobStates(["nightly"])).get("nightly")?.enabled).toBe(false);
    });
});
