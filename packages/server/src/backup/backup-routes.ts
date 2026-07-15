import { Hono } from "hono";
import type { HonoEnv } from "../api/types";
import { ApiError, errorHandler } from "../api/errors";
import type { StorageController } from "../storage";
import { BackupDestination, listBackupObjects, readBackupBytes } from "./backup-common";

export interface BackupRoutesConfig {
    /**
     * Resolve the current backup destination, or `null` when backups are not
     * configured (`BACKUP_DESTINATION` unset). Read lazily so a restart isn't
     * required to pick up config.
     */
    getDestination: () => BackupDestination | null;
    /** Storage controller for object-storage destinations. */
    storage?: StorageController;
}

/**
 * Admin REST routes for the Backups panel.
 *
 * Routes (mounted under `/admin/backups`, admin-guarded by the caller):
 *   GET /            → list available backups
 *   GET /download    → download a backup's bytes (?key=…)
 */
export function createBackupRoutes(config: BackupRoutesConfig): Hono<HonoEnv> {
    const router = new Hono<HonoEnv>();
    router.onError(errorHandler);

    router.get("/", async (c) => {
        const dest = config.getDestination();
        if (!dest) {
            return c.json({ backups: [], destinationKind: "local" as const, configured: false });
        }
        const backups = await listBackupObjects(dest, config.storage);
        return c.json({ backups, destinationKind: dest.kind, configured: true });
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
        const result = await readBackupBytes(dest, key, config.storage);
        if (!result) {
            throw ApiError.notFound(`Backup not found: ${key}`);
        }
        c.header("Content-Type", "application/octet-stream");
        c.header("Content-Disposition", `attachment; filename="${result.name}"`);
        return c.body(result.bytes);
    });

    return router;
}
