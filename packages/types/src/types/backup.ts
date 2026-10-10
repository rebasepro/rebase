/**
 * Backup type definitions shared across server, client, and studio.
 */

/** Where a backup lives — a local path or an object-storage bucket. */
export type BackupDestinationKind = "local" | "s3" | "gcs";

/**
 * A single backup as surfaced by the admin API / Studio Backups panel.
 */
export interface BackupInfo {
    /** Storage key (object storage) or absolute file path (local). */
    key: string;

    /** Display name — the file's basename. */
    name: string;

    /** Size in bytes, when known. */
    sizeBytes?: number;

    /** ISO timestamp the backup was created, when recoverable. */
    createdAt?: string;

    /** The kind of destination this backup was read from. */
    destinationKind: BackupDestinationKind;

    /**
     * Key of the `.globals.sql` sidecar written beside this dump, when there is
     * one. It holds the database roles the dump's GRANTs and RLS policies name,
     * and `rebase db restore` looks for it next to the `.dump` — so a copy of the
     * backup needs both files. Absent when the dump was taken without it.
     */
    globalsKey?: string;
}

/**
 * How one run of the scheduled backup went, read from the cron's run history.
 */
export interface BackupRunOutcome {
    /** ISO timestamp the run started. */
    startedAt: string;

    /** ISO timestamp the run ended. */
    finishedAt: string;

    /** Whether the run produced a backup. */
    success: boolean;

    /** Why it did not, when it failed — e.g. `Could not find the 'pg_dump' binary.` */
    error?: string;

    /** True when someone triggered the run by hand rather than the schedule. */
    manual: boolean;
}

/**
 * The deployment's scheduled backup job — the cron that default-exports
 * `createBackupCron` — and the outcome of its last run.
 *
 * Shown by the Backups panel so a backup that fails every night is visible
 * where the backups are listed, rather than only in the cron history.
 */
export interface BackupScheduleStatus {
    /** The cron job's id, which is its file's name. */
    jobId: string;

    /** The job's display name. */
    name: string;

    /** Its cron expression. */
    schedule: string;

    /** False when the job is paused (or declared `enabled: false`), or refused. */
    enabled: boolean;

    /**
     * True when the job is off because its own definition says
     * `enabled: false` — the documented backup cron file exports it that way
     * while `BACKUP_SCHEDULE` is unset — and not because someone paused it.
     * Resuming it in Cron Jobs would run that definition as written.
     */
    disabledInCode?: boolean;

    /**
     * Why the scheduler refused the job — an invalid schedule, timezone or
     * timeout. A refused job is not registered and never runs; the cron file
     * has to change.
     */
    refused?: string;

    /** ISO timestamp of the next scheduled run, when one is armed. */
    nextRunAt?: string;

    /**
     * The most recent scheduled run, absent when the schedule has never run
     * it — or when its run history could not be read, which
     * {@link historyError} says. A run someone started by hand is not one:
     * see {@link lastManualRun}.
     */
    lastRun?: BackupRunOutcome;

    /** A run started by hand ("Run Now") since {@link lastRun}, when there is one. */
    lastManualRun?: BackupRunOutcome;

    /**
     * Why the job's run history could not be read. Whether it ran, and how it
     * went, is then unknown: `lastRun` is absent for that reason, not because
     * the job never ran.
     */
    historyError?: string;
}

/**
 * A short-lived link to one backup's bytes, from `POST /admin/backups/download-url`.
 *
 * The URL needs no `Authorization` header — the token in it stands in for one,
 * for this backup only — so a browser can be sent to it and stream the dump to
 * disk instead of holding it in the page.
 */
export interface BackupDownloadLink {
    /**
     * `…/admin/backups/download?key=…&token=…`. The server answers it as a
     * path on itself; the SDK's `downloadUrl()` answers it absolute, on the
     * client's own base URL.
     */
    url: string;
    /** The token in {@link url}, on its own. */
    token: string;
    /** Seconds until the link stops working (60). */
    expiresIn: number;
}

/** What the backup listing (`GET /admin/backups`) answers. */
export interface BackupListing {
    /** Backups at the destination, newest first. */
    backups: BackupInfo[];

    /** The kind of destination they were read from. */
    destinationKind: BackupDestinationKind;

    /** False when `BACKUP_DESTINATION` is unset. */
    configured: boolean;

    /**
     * The scheduled backup job, or `null` when the deployment registers none.
     * Absent from a server that predates the field.
     */
    schedule?: BackupScheduleStatus | null;

    /**
     * True when the destination is a local path and the scheduled backup runs
     * in another process (the worker of a split deployment). The backups
     * listed are the ones on this process's disk; the scheduled runs write to
     * theirs, which is the same directory only when both mount it.
     */
    localDiskOfThisProcess?: boolean;
}
