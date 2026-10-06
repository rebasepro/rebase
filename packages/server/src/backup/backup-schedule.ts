/**
 * The scheduled backup job, as the Backups panel reports it.
 *
 * A backup that fails every night has to be visible where the backups are
 * listed. Before this the panel read the destination and nothing else, so a
 * cron that could not run `pg_dump` left an empty list under "wait for the next
 * scheduled run" — while each failure sat in `cron_logs`, one panel away.
 */
import type {
    BackupScheduleStatus,
    CronJobDefinition,
    CronJobLogEntry,
    CronJobStatus,
    RejectedCronJob
} from "@rebasepro/types";
import { isAlreadyExecutingSkip } from "../cron/cron-scheduler";
import { logger } from "../utils/logger";

/**
 * The mark `createBackupCron` (in `@rebasepro/server-postgres`) puts on the
 * definition it returns.
 *
 * A registry symbol, so it is the same value across two installed copies of
 * either package, and neither package has to import the other: `server` must
 * not depend on `server-postgres`. The job cannot be recognised any other way —
 * its id is the cron file's name and its display name is configurable.
 */
export const BACKUP_CRON_MARK: unique symbol = Symbol.for("rebase.backupCron");

/** Whether a cron definition is the scheduled backup. */
export function isBackupCronDefinition(definition: CronJobDefinition): boolean {
    return Reflect.get(definition, BACKUP_CRON_MARK) === true;
}

/** The part of the cron scheduler this reads. */
export interface BackupScheduleSource {
    jobIdsWhere(predicate: (definition: CronJobDefinition) => boolean): string[];
    rejectedJobsWhere(predicate: (definition: CronJobDefinition) => boolean): RejectedCronJob[];
    fetchJob(id: string): Promise<CronJobStatus | undefined>;
    getJobLogsFromDb(id: string, limit?: number): Promise<CronJobLogEntry[]>;
}

/**
 * How many recent log entries to look through for the last real run. A skip —
 * a slot that found the previous run still going — is logged as a success with
 * nothing done, and must not stand in for the run it skipped.
 */
const RECENT_RUNS = 20;

/**
 * The scheduled backup job and its last run, or `null` when the deployment
 * has none — registered or refused.
 */
export async function readBackupSchedule(source: BackupScheduleSource): Promise<BackupScheduleStatus | null> {
    const [jobId] = source.jobIdsWhere(isBackupCronDefinition);
    if (jobId === undefined) {
        // A refused job is not registered, and answered `null` here it read
        // as "no backup cron" under a hint to add the file the project has.
        const [refused] = source.rejectedJobsWhere(isBackupCronDefinition);
        return refused
            ? { jobId: refused.id, name: refused.name, schedule: refused.schedule, enabled: false, refused: refused.reason }
            : null;
    }

    const job = await source.fetchJob(jobId);
    if (!job) return null;

    let recent: CronJobLogEntry[];
    let historyError: string | undefined;
    try {
        recent = await source.getJobLogsFromDb(jobId, RECENT_RUNS);
    } catch (err) {
        // Said, not read as "has not run yet". The listing itself still
        // answers: the backups at the destination are worth showing.
        logger.error(`[backups] Could not read the run history of the backup job "${jobId}"`, { error: err });
        recent = [];
        historyError = "The backup job's run history could not be read. The server log has the reason.";
    }
    const last = recent.find(entry => !isAlreadyExecutingSkip(entry));

    return {
        jobId,
        name: job.name,
        schedule: job.schedule,
        enabled: job.enabled,
        ...(job.nextRunAt ? { nextRunAt: job.nextRunAt } : {}),
        ...(historyError ? { historyError } : {}),
        ...(last ? {
            lastRun: {
                startedAt: last.startedAt,
                finishedAt: last.finishedAt,
                success: last.success,
                ...(last.success || !last.error ? {} : { error: last.error }),
                manual: last.manual === true
            }
        } : {})
    };
}
