import { Hono } from "hono";
import type { BackupListing, BackupScheduleStatus } from "@rebasepro/types";
import type { HonoEnv } from "../api/types";
import { ApiError, errorHandler } from "../api/errors";
import type { StorageController } from "../storage/types";
import { BackupDestination, listBackupObjects, openBackupStream } from "./backup-common";
import { backupStorageFromEnv, describeBackupDestination, type ObjectBackupDestination } from "./backup-storage";

export interface BackupRoutesConfig {
    /**
     * Resolve the current backup destination, or `null` when backups are not
     * configured (`BACKUP_DESTINATION` unset). Read lazily so a restart isn't
     * required to pick up config.
     */
    getDestination: () => BackupDestination | null;
    /**
     * The controller that reads an object-storage destination. It has to
     * address the destination's own bucket — never the app's file storage,
     * which is another bucket, a local directory, or nothing. Defaults to
     * {@link backupStorageFromEnv} over `process.env`, which is how the backup
     * cron builds the one it writes with.
     */
    storageFor?: (dest: ObjectBackupDestination) => StorageController;
    /**
     * The scheduled backup job and its last run — see `readBackupSchedule`.
     * Omitted where this process has no cron scheduler; the listing then
     * answers `schedule: null`.
     */
    getSchedule?: () => Promise<BackupScheduleStatus | null>;
    /**
     * True when this process does not run the scheduled jobs (the `api` role
     * of a split deployment). A local destination read here is then this
     * process's disk, not the one the scheduled backup writes to.
     */
    scheduledElsewhere?: boolean;
}

/** Why a destination could not be read, as the answer says it. */
function unreadable(dest: BackupDestination, err: unknown): ApiError {
    const reason = err instanceof Error ? err.message : String(err);
    return ApiError.serviceUnavailable(`Cannot read the backups at ${describeBackupDestination(dest)}: ${reason}`);
}

/**
 * Admin REST routes for the Backups panel.
 *
 * Routes (mounted under `/admin/backups`, admin-guarded by the caller):
 *   GET /            → list available backups, and the scheduled job's last run
 *   GET /download    → download a backup's bytes (?key=…)
 */
export function createBackupRoutes(config: BackupRoutesConfig): Hono<HonoEnv> {
    const router = new Hono<HonoEnv>();
    router.onError(errorHandler);

    const storageFor = config.storageFor ?? ((dest: ObjectBackupDestination) => backupStorageFromEnv(dest, process.env));
    /** The controller for `dest`, or none for a local one. A destination it cannot read is an error, never `[]`. */
    const storageOf = (dest: BackupDestination): StorageController | undefined => {
        if (dest.kind === "local") return undefined;
        try {
            return storageFor(dest);
        } catch (err) {
            throw unreadable(dest, err);
        }
    };

    router.get("/", async (c) => {
        // Read whether or not a destination is configured: a backup cron with
        // no BACKUP_DESTINATION fails every run, and that is exactly what the
        // panel has to be able to say.
        const schedule = config.getSchedule ? await config.getSchedule() : null;
        const dest = config.getDestination();
        if (!dest) {
            return c.json({ backups: [], destinationKind: "local", configured: false, schedule } satisfies BackupListing);
        }
        const backups = await listBackupObjects(dest, storageOf(dest)).catch((err: unknown) => {
            throw unreadable(dest, err);
        });
        // Only where there is a scheduled backup to write elsewhere.
        const localDiskOfThisProcess = dest.kind === "local" && config.scheduledElsewhere === true && schedule !== null;
        return c.json({
            backups,
            destinationKind: dest.kind,
            configured: true,
            schedule,
            ...(localDiskOfThisProcess ? { localDiskOfThisProcess } : {})
        } satisfies BackupListing);
    });

    router.get("/download", async (c) => {
        const dest = config.getDestination();
        if (!dest) {
            throw ApiError.badRequest("Backups are not configured (set BACKUP_DESTINATION).");
        }
        const key = c.req.query("key");
        if (!key) {
            throw ApiError.badRequest("Missing 'key' query parameter.");
        }
        // Streamed: a dump is the size of the database. See `openBackupStream`.
        const result = await openBackupStream(dest, key, storageOf(dest));
        if (!result) {
            throw ApiError.notFound(`Backup not found: ${key}`);
        }
        c.header("Content-Type", "application/octet-stream");
        c.header("Content-Length", String(result.size));
        c.header("Content-Disposition", `attachment; filename="${result.name}"`);
        return c.body(result.stream);
    });

    return router;
}
