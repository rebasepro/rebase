import { Hono } from "hono";
import type { BackupListing, BackupScheduleStatus } from "@rebasepro/types";
import type { HonoEnv } from "../api/types";
import { ApiError, errorHandler } from "../api/errors";
import type { StorageController } from "../storage";
import { BackupDestination, listBackupObjects, openBackupStream } from "./backup-common";

export interface BackupRoutesConfig {
    /**
     * Resolve the current backup destination, or `null` when backups are not
     * configured (`BACKUP_DESTINATION` unset). Read lazily so a restart isn't
     * required to pick up config.
     */
    getDestination: () => BackupDestination | null;
    /** Storage controller for object-storage destinations. */
    storage?: StorageController;
    /**
     * The scheduled backup job and its last run — see `readBackupSchedule`.
     * Omitted where this process has no cron scheduler; the listing then
     * answers `schedule: null`.
     */
    getSchedule?: () => Promise<BackupScheduleStatus | null>;
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

    router.get("/", async (c) => {
        // Read whether or not a destination is configured: a backup cron with
        // no BACKUP_DESTINATION fails every run, and that is exactly what the
        // panel has to be able to say.
        const schedule = config.getSchedule ? await config.getSchedule() : null;
        const dest = config.getDestination();
        if (!dest) {
            return c.json({ backups: [], destinationKind: "local", configured: false, schedule } satisfies BackupListing);
        }
        const backups = await listBackupObjects(dest, config.storage);
        return c.json({ backups, destinationKind: dest.kind, configured: true, schedule } satisfies BackupListing);
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
        const result = await openBackupStream(dest, key, config.storage);
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
