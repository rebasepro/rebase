/**
 * The Backups panel says how the last scheduled backup went.
 *
 * A backup cron that failed every night — the runtime image shipped no
 * `pg_dump`, so each run ended in "Could not find the 'pg_dump' binary" — was
 * invisible from the panel: `GET /admin/backups` returned the files at the
 * destination and nothing else, and with no files the panel said "wait for the
 * next scheduled run" forever. The failure was in `cron_logs` all along.
 *
 * The backup job is found by the mark `createBackupCron` puts on its
 * definition (`Symbol.for("rebase.backupCron")`), not by its file name or its
 * display name, both of which the project chooses.
 */
import fs from "fs";
import os from "os";
import path from "path";
import type { CronJobDefinition, CronJobLogEntry } from "@rebasepro/types";
import { CronScheduler } from "../src/cron/cron-scheduler";
import { createBackupRoutes } from "../src/backup/backup-routes";
import { readBackupSchedule, type BackupScheduleSource } from "../src/backup/backup-schedule";

const BACKUP_CRON_MARK = Symbol.for("rebase.backupCron");

function backupJob(handler: CronJobDefinition["handler"]): CronJobDefinition {
    const definition: CronJobDefinition = {
        name: "Nightly",
        schedule: "0 3 * * *",
        handler
    };
    Object.defineProperty(definition, BACKUP_CRON_MARK, { value: true });
    return definition;
}

describe("GET /admin/backups — the scheduled run", () => {
    let dir: string;
    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "backup-schedule-"));
    });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    async function list(scheduler: CronScheduler) {
        const router = createBackupRoutes({
            getDestination: () => ({ kind: "local", path: dir }),
            getSchedule: () => readBackupSchedule(scheduler)
        });
        const res = await router.request("/");
        expect(res.status).toBe(200);
        return res.json();
    }

    it("reports a failed last run, with its error", async () => {
        const scheduler = new CronScheduler();
        scheduler.registerJobs([
            { id: "backup", definition: backupJob(async () => { throw new Error("Could not find the 'pg_dump' binary."); }) },
            { id: "cleanup", definition: { schedule: "0 * * * *", handler: async () => undefined } }
        ]);
        await scheduler.triggerJob("backup");

        const body = await list(scheduler);

        expect(body.backups).toEqual([]);
        expect(body.schedule).toMatchObject({
            jobId: "backup",
            schedule: "0 3 * * *",
            enabled: true,
            lastRun: { success: false, error: expect.stringContaining("pg_dump") }
        });
    });

    it("reports a successful last run", async () => {
        const scheduler = new CronScheduler();
        scheduler.registerJobs([{ id: "nightly-db", definition: backupJob(async () => ({ backup: "x.dump" })) }]);
        await scheduler.triggerJob("nightly-db");

        const body = await list(scheduler);
        expect(body.schedule.lastRun).toMatchObject({ success: true, manual: true });
        expect(body.schedule.lastRun.error).toBeUndefined();
    });

    it("looks past a skipped overlap to the run it skipped", async () => {
        // `cron_logs` is read newest first by start time. A slot that found the
        // previous run still going is logged as a success that did nothing,
        // and it starts AFTER the run it skipped — so read naively, it would
        // stand in for that run and hide its failure.
        const failed: CronJobLogEntry = {
            jobId: "backup", startedAt: "2026-09-30T03:00:00.000Z", finishedAt: "2026-09-30T04:30:00.000Z",
            durationMs: 5_400_000, success: false, error: "pg_dump: error: connection lost", logs: [], manual: false
        };
        const skip: CronJobLogEntry = {
            jobId: "backup", startedAt: "2026-09-30T04:00:00.000Z", finishedAt: "2026-09-30T04:00:00.000Z",
            durationMs: 0, success: true, result: { skipped: true, reason: "already_executing" }, logs: [], manual: false
        };
        const source: BackupScheduleSource = {
            jobIdsWhere: () => ["backup"],
            rejectedJobsWhere: () => [],
            fetchJob: async () => ({
                id: "backup", name: "Backup", schedule: "0 * * * *", enabled: true,
                state: "error", totalRuns: 2, totalFailures: 1
            }),
            getJobLogsFromDb: async () => [skip, failed]
        };

        const schedule = await readBackupSchedule(source);
        expect(schedule?.lastRun).toMatchObject({ success: false, error: "pg_dump: error: connection lost" });
    });

    it("says the run history could not be read, rather than that the job never ran", async () => {
        const source: BackupScheduleSource = {
            jobIdsWhere: () => ["backup"],
            rejectedJobsWhere: () => [],
            fetchJob: async () => ({
                id: "backup", name: "Backup", schedule: "0 3 * * *", enabled: true,
                state: "idle", totalRuns: 0, totalFailures: 0
            }),
            getJobLogsFromDb: async () => { throw new Error("connection terminated unexpectedly"); }
        };

        const schedule = await readBackupSchedule(source);

        expect(schedule?.lastRun).toBeUndefined();
        expect(schedule?.historyError).toMatch(/could not be read/);
    });

    it("says a registered backup job has not run yet", async () => {
        const scheduler = new CronScheduler();
        scheduler.registerJobs([{ id: "backup", definition: backupJob(async () => undefined) }]);

        const body = await list(scheduler);
        expect(body.schedule).toMatchObject({ jobId: "backup", enabled: true });
        expect(body.schedule.lastRun).toBeUndefined();
    });

    it("reports a backup job the scheduler refused, with the reason", async () => {
        // A six-field BACKUP_SCHEDULE: the job is refused at boot and never
        // runs. The panel used to answer `schedule: null` — no backup job —
        // under a hint to add the cron file the project already has.
        const scheduler = new CronScheduler();
        const definition = backupJob(async () => undefined);
        definition.schedule = "0 0 3 * * *";
        scheduler.registerJobs([{ id: "backup", definition }]);

        const body = await list(scheduler);

        expect(body.schedule).toMatchObject({
            jobId: "backup",
            name: "Nightly",
            schedule: "0 0 3 * * *",
            enabled: false,
            refused: expect.stringContaining("Expected 5 fields")
        });
    });

    it("is null when no backup job is registered — an unmarked cron is not one", async () => {
        const scheduler = new CronScheduler();
        scheduler.registerJobs([{ id: "backup", definition: { schedule: "0 3 * * *", handler: async () => undefined } }]);
        await scheduler.triggerJob("backup");

        const body = await list(scheduler);
        expect(body.schedule).toBeNull();
    });

    it("still reports the schedule when no destination is configured", async () => {
        const scheduler = new CronScheduler();
        scheduler.registerJobs([{ id: "backup", definition: backupJob(async () => { throw new Error("no destination"); }) }]);
        await scheduler.triggerJob("backup");

        const router = createBackupRoutes({
            getDestination: () => null,
            getSchedule: () => readBackupSchedule(scheduler)
        });
        const body = await (await router.request("/")).json();
        expect(body.configured).toBe(false);
        expect(body.schedule.lastRun).toMatchObject({ success: false, error: "no destination" });
    });
});
