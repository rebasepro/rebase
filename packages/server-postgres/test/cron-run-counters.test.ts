/**
 * Cron's run counters and run-history retention, against a real Postgres
 * (PGlite).
 *
 * Nothing ever deleted from `rebase.cron_logs`, and the Studio Cron panel's
 * run and failure counts were two `count(*)` over each job's whole history,
 * on every 15-second poll: twelve ordinary jobs wrote 1.5M rows a year, and
 * the listing took 64–132 ms and doubled every year. The counts are kept on
 * `rebase.cron_job_state` now, in the statement that logs each run, and the
 * history keeps 30 days.
 *
 * What has to hold, and is the database's answer rather than the SQL text's:
 *  - an existing history's counts come through the upgrade exactly — the
 *    skips counted as runs, as they always were;
 *  - a listing reads the counters, not the history;
 *  - retention deletes in batches and never takes a run out of the totals.
 */
import { describe, expect, it, beforeEach, afterEach } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import type { DataDriver } from "@rebasepro/types";
import { createCronStore } from "../../server/src/cron/cron-store";
import type { CronJobRunSummary } from "../../server/src/cron/cron-store";

/**
 * A driver whose SQL escape hatch is a real database, recording each statement.
 * Parameterised statements go through the extended protocol; the store's
 * parameterless DDL includes multi-statement blocks, which only the simple
 * protocol accepts.
 */
function pgliteDriver(db: PGlite, statements: string[] = []): DataDriver {
    return {
        key: "postgres",
        admin: {
            async executeSql(sql: string, options?: { params?: unknown[] }) {
                statements.push(sql);
                if (options?.params) {
                    return (await db.query(sql, options.params)).rows as Record<string, unknown>[];
                }
                const results = await db.exec(sql);
                return (results[results.length - 1]?.rows ?? []) as Record<string, unknown>[];
            }
        }
    } as unknown as DataDriver;
}

/** `cron_logs` as the store created it before the counters, with its old indexes. */
const OLD_SCHEMA = `
    CREATE SCHEMA rebase;
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
    CREATE INDEX idx_cron_logs_job_failures ON rebase.cron_logs(job_id) WHERE NOT success;
    CREATE TABLE rebase.cron_job_state (
        job_id TEXT PRIMARY KEY,
        enabled BOOLEAN,
        updated_at TIMESTAMPTZ,
        updated_by TEXT,
        running_until TIMESTAMPTZ,
        running_by TEXT
    );
`;

/**
 * Ninety days of history for three jobs, as the old store wrote it: hourly
 * runs with every 13th a failure, a skip every 50th (a row with
 * `result.skipped`, which counted as a run), and a paused job with a row in
 * `cron_job_state` already. Most of it is past the 30-day retention.
 */
const OLD_HISTORY = `
    INSERT INTO rebase.cron_logs (job_id, started_at, finished_at, duration_ms, success, error, result, logs)
    SELECT j.job_id, t, t + interval '1 second', (n % 900)::int,
           n % 13 <> 0,
           CASE WHEN n % 13 = 0 THEN 'boom ' || n END,
           CASE WHEN n % 50 = 0 THEN '{"skipped": true, "reason": "already_executing"}'::jsonb END,
           '["one line"]'::jsonb
    FROM (VALUES ('hourly-sync'), ('report'), ('paused-job')) AS j(job_id)
    CROSS JOIN LATERAL (
        SELECT t, row_number() OVER (ORDER BY t) AS n
        FROM generate_series(date_trunc('hour', now()) - interval '90 days', date_trunc('hour', now()) - interval '1 hour', interval '1 hour') AS t
    ) AS series;
    INSERT INTO rebase.cron_job_state (job_id, enabled, updated_at, updated_by) VALUES ('paused-job', false, now(), 'ops');
`;

/** The listing as the store answered it before the counters, verbatim. */
async function oldListing(db: PGlite, jobIds: string[]): Promise<Map<string, CronJobRunSummary>> {
    const { rows } = await db.query<{
        job_id: string; total_runs: number; total_failures: number;
        started_at: Date | null; duration_ms: number | null; success: boolean | null; error: string | null;
    }>(
        `SELECT j.job_id,
                (SELECT count(*)::int FROM rebase.cron_logs l WHERE l.job_id = j.job_id) AS total_runs,
                (SELECT count(*)::int FROM rebase.cron_logs l WHERE l.job_id = j.job_id AND NOT l.success) AS total_failures,
                last.started_at, last.duration_ms, last.success, last.error
         FROM (VALUES ${jobIds.map((_, i) => `($${i + 1}::text)`).join(", ")}) AS j(job_id)
         LEFT JOIN LATERAL (
             SELECT l.started_at, l.duration_ms, l.success, l.error
             FROM rebase.cron_logs l WHERE l.job_id = j.job_id
             ORDER BY l.started_at DESC LIMIT 1
         ) AS last ON true`,
        jobIds
    );
    return new Map(rows.map(row => {
        const summary: CronJobRunSummary = { totalRuns: row.total_runs, totalFailures: row.total_failures };
        if (row.started_at) {
            summary.lastRunAt = new Date(row.started_at).toISOString();
            summary.lastDurationMs = Number(row.duration_ms);
            summary.lastSuccess = row.success === true;
            if (row.error !== null) summary.lastError = row.error;
        }
        return [row.job_id, summary];
    }));
}

async function historyRows(db: PGlite, where = "true"): Promise<number> {
    const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM rebase.cron_logs WHERE ${where}`);
    return rows[0].n;
}

const JOBS = ["hourly-sync", "report", "paused-job", "never-ran"];

let db: PGlite;

beforeEach(async () => {
    db = new PGlite();
    await db.waitReady;
});

afterEach(async () => {
    await db.close();
});

describe("a history written before the counters", () => {
    beforeEach(async () => {
        await db.exec(OLD_SCHEMA);
        await db.exec(OLD_HISTORY);
    });

    it("keeps every job's counts and last run through the upgrade and the first sweep", async () => {
        const before = await oldListing(db, JOBS);
        expect(before.get("hourly-sync")?.totalRuns).toBe(90 * 24);

        const store = createCronStore(pgliteDriver(db))!;
        await store.ensureTable();

        // Before any sweep: nothing counted yet, and the listing still exact.
        expect(await store.fetchRunSummaries(JOBS)).toEqual(before);

        const expired = await historyRows(db, "started_at < now() - interval '30 days'");
        const kept = await historyRows(db) - expired;
        expect(expired).toBeGreaterThan(kept);

        const swept = await store.sweepLogs();
        expect(swept).toEqual({ deleted: expired, counted: kept });
        expect(await historyRows(db, "started_at < now() - interval '30 days'")).toBe(0);
        expect(await historyRows(db, "counted IS NULL")).toBe(0);

        // 90 days of counts, from 30 days of history.
        expect(await store.fetchRunSummaries(JOBS)).toEqual(before);
        // And what a scheduler seeds itself with at start.
        const stats = await store.fetchJobStats();
        expect(stats.get("report")).toEqual({
            totalRuns: before.get("report")!.totalRuns,
            totalFailures: before.get("report")!.totalFailures,
            lastRunAt: before.get("report")!.lastRunAt
        });

        // The pause made before the upgrade is still there.
        const { rows } = await db.query<{ enabled: boolean | null }>(
            "SELECT enabled FROM rebase.cron_job_state WHERE job_id = 'paused-job'"
        );
        expect(rows[0].enabled).toBe(false);
    });

    it("counts a run an older server logs mid-deploy, once", async () => {
        const store = createCronStore(pgliteDriver(db))!;
        await store.ensureTable();
        await store.sweepLogs();

        const counted = (await store.fetchRunSummaries(["report"])).get("report")!;

        // A server still on the previous version writes the row, not the count.
        const { rows } = await db.query<{ started_at: Date }>(
            `INSERT INTO rebase.cron_logs (job_id, started_at, finished_at, duration_ms, success, error)
             VALUES ('report', now(), now(), 7, false, 'from the old pod')
             RETURNING started_at`
        );
        const withIt = {
            totalRuns: counted.totalRuns + 1,
            totalFailures: counted.totalFailures + 1,
            lastRunAt: new Date(rows[0].started_at).toISOString(),
            lastDurationMs: 7,
            lastSuccess: false,
            lastError: "from the old pod"
        };
        // In the listing at once, before any sweep has counted it…
        expect((await store.fetchRunSummaries(["report"])).get("report")).toEqual(withIt);

        // …and counted by the next sweep, and by that one only.
        expect((await store.sweepLogs()).counted).toBe(1);
        expect((await store.sweepLogs()).counted).toBe(0);
        expect((await store.fetchRunSummaries(["report"])).get("report")).toEqual(withIt);
    });
});

describe("the counters", () => {
    it("are what a listing reads — not a count of the history", async () => {
        const store = createCronStore(pgliteDriver(db))!;
        await store.ensureTable();
        for (let i = 0; i < 3; i++) {
            await store.insertLog({
                jobId: "nightly",
                startedAt: new Date(Date.now() - (3 - i) * 60_000).toISOString(),
                finishedAt: new Date().toISOString(),
                durationMs: 5,
                success: i !== 1,
                error: i === 1 ? "upstream 502" : undefined,
                logs: [],
                manual: false
            });
        }
        expect((await store.fetchRunSummaries(["nightly"])).get("nightly")).toMatchObject({
            totalRuns: 3, totalFailures: 1, lastSuccess: true
        });

        // Counted when logged: there is nothing for a sweep to count.
        expect(await historyRows(db, "counted IS NULL")).toBe(0);

        // Moved by hand, the counter is the answer. Counting the history
        // would still say 3.
        await db.exec("UPDATE rebase.cron_job_state SET total_runs = 999 WHERE job_id = 'nightly'");
        expect((await store.fetchRunSummaries(["nightly"])).get("nightly")?.totalRuns).toBe(999);
    });

    it("keep the latest run as the last one when an earlier-started run is logged after it", async () => {
        // A long run is logged when it ends — after the skip that started
        // while it was still going.
        const store = createCronStore(pgliteDriver(db))!;
        await store.ensureTable();
        const started = Date.now() - 600_000;
        await store.insertLog({
            jobId: "slow", startedAt: new Date(started + 60_000).toISOString(), finishedAt: new Date(started + 60_000).toISOString(),
            durationMs: 0, success: true, result: { skipped: true, reason: "already_executing" }, logs: [], manual: false
        });
        await store.insertLog({
            jobId: "slow", startedAt: new Date(started).toISOString(), finishedAt: new Date().toISOString(),
            durationMs: 600_000, success: false, error: "timed out", logs: [], manual: false
        });

        expect((await store.fetchRunSummaries(["slow"])).get("slow")).toEqual({
            totalRuns: 2,
            totalFailures: 1,
            lastRunAt: new Date(started + 60_000).toISOString(),
            lastDurationMs: 0,
            lastSuccess: true
        });
    });
});

describe("the retention sweep", () => {
    it("deletes in batches, and the counts outlive the rows", async () => {
        const statements: string[] = [];
        const store = createCronStore(pgliteDriver(db, statements))!;
        await store.ensureTable();
        // 12,000 counted runs past retention: more than two batches.
        await db.exec(`
            INSERT INTO rebase.cron_logs (job_id, started_at, finished_at, duration_ms, success, counted)
            SELECT 'every-minute', t, t, 1, true, true
            FROM generate_series(now() - interval '40 days', now() - interval '40 days' + interval '11999 minutes', interval '1 minute') AS t;
            INSERT INTO rebase.cron_job_state (job_id, total_runs, total_failures, last_run_at, last_duration_ms, last_success)
            VALUES ('every-minute', 12000, 0, now() - interval '32 days', 1, true);
        `);

        statements.length = 0;
        const swept = await store.sweepLogs();

        expect(swept).toEqual({ deleted: 12_000, counted: 0 });
        const deletes = statements.filter(s => s.includes("DELETE FROM rebase.cron_logs"));
        expect(deletes).toHaveLength(3);
        for (const sql of deletes) expect(sql).toMatch(/LIMIT \$2/);
        expect(await historyRows(db)).toBe(0);
        expect((await store.fetchRunSummaries(["every-minute"])).get("every-minute")?.totalRuns).toBe(12_000);
    });

    it("keeps the last 30 days", async () => {
        const store = createCronStore(pgliteDriver(db))!;
        await store.ensureTable();
        await db.exec(`
            INSERT INTO rebase.cron_logs (job_id, started_at, finished_at, duration_ms, success, counted)
            VALUES ('daily', now() - interval '29 days', now(), 1, true, true),
                   ('daily', now() - interval '31 days', now(), 1, true, true);
        `);
        expect((await store.sweepLogs()).deleted).toBe(1);
        expect(await historyRows(db, "started_at > now() - interval '30 days'")).toBe(1);
    });
});

describe("booting", () => {
    it("adds the counters without an exclusive lock on a table that has them", async () => {
        const first = createCronStore(pgliteDriver(db))!;
        await first.ensureTable();

        const statements: string[] = [];
        await createCronStore(pgliteDriver(db, statements))!.ensureTable();
        expect(statements.filter(s => /ALTER TABLE/.test(s))).toEqual([]);
    });
});
