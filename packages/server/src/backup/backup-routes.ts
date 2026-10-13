import { Hono, type Context } from "hono";
import type { BackupDownloadLink, BackupListing, BackupScheduleStatus } from "@rebasepro/types";
import type { HonoEnv } from "../api/types";
import { ApiError, errorHandler } from "../api/errors";
import { jwtOf, type JwtService } from "../auth/jwt";
import type { StorageController } from "../storage/types";
import { BackupDestination, findBackup, listBackupObjects, openBackupStream } from "./backup-common";
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

// ─── Download links ──────────────────────────────────────────────────

/**
 * The `purpose` of a download link's token. `verifyAccessToken` refuses
 * any token with a purpose, and the storage, MFA and MCP verifiers each demand
 * their own, so a link is never a session or any other credential, and none of
 * those is a link.
 */
const BACKUP_DOWNLOAD_PURPOSE = "backup-download";
/** The token's audience: the one route that redeems it. */
const BACKUP_DOWNLOAD_AUDIENCE = "rebase:admin/backups/download";
/** How long a link works. Long enough to start the download, not to pass around. */
export const BACKUP_DOWNLOAD_LINK_TTL_SECONDS = 60;

/** What a link grants: one backup, at one destination. */
function linkScope(dest: BackupDestination, key: string): string {
    return `backup:${describeBackupDestination(dest)}:${key}`;
}

/**
 * Whether `token` is a live link for `key` at `dest`, signed by `jwt` — the
 * backend answering. Never throws: anything else is a no.
 */
async function linkGrants(jwt: JwtService, token: string, dest: BackupDestination, key: string): Promise<boolean> {
    if (!jwt.isConfigured()) return false;
    const claims = await jwt.verifyPurposeToken<{ aud?: unknown; scope?: unknown }>(BACKUP_DOWNLOAD_PURPOSE, token)
        .catch(() => null);
    return claims?.aud === BACKUP_DOWNLOAD_AUDIENCE && claims.scope === linkScope(dest, key);
}

/** The configured destination, or the 400 every backup route answers without one. */
function destinationOf(config: Pick<BackupRoutesConfig, "getDestination">): BackupDestination {
    const dest = config.getDestination();
    if (!dest) throw ApiError.badRequest("Backups are not configured (set BACKUP_DESTINATION).");
    return dest;
}

/** {@link BackupRoutesConfig.storageFor}, with its default, for a destination that has a controller. */
function storageResolver(config: Pick<BackupRoutesConfig, "storageFor">): (dest: BackupDestination) => StorageController | undefined {
    const storageFor = config.storageFor ?? ((dest: ObjectBackupDestination) => backupStorageFromEnv(dest, process.env));
    /** The controller for `dest`, or none for a local one. A destination it cannot read is an error, never `[]`. */
    return (dest) => {
        if (dest.kind === "local") return undefined;
        try {
            return storageFor(dest);
        } catch (err) {
            throw unreadable(dest, err);
        }
    };
}

/** One backup's bytes as the response, streamed: a dump is the size of the database. See `openBackupStream`. */
async function serveBackup(c: Context<HonoEnv>, dest: BackupDestination, key: string, storage: StorageController | undefined): Promise<Response> {
    const result = await openBackupStream(dest, key, storage);
    if (!result) {
        throw ApiError.notFound(`Backup not found: ${key}`);
    }
    c.header("Content-Type", "application/octet-stream");
    c.header("Content-Length", String(result.size));
    c.header("Content-Disposition", `attachment; filename="${result.name}"`);
    // A whole database, and on a link a URL that grants it: nothing in between keeps a copy.
    c.header("Cache-Control", "no-store");
    return c.body(result.stream);
}

/**
 * `GET /download?key=…&token=…`: a download link spent in place of the bearer
 * header, for the one backup it names.
 *
 * Mount it at the backups prefix AHEAD of every gate on the admin prefix: the
 * auth adapter's own admin routers authenticate everything under `/admin`
 * before the Backups gate is reached. A request with no `token` passes
 * through untouched; one with a token is answered here — the backup, or a
 * 401 — and never falls through to the header: a bad link is a bad link.
 *
 * A browser cannot put a header on a navigation, so before links the SDK
 * fetched the dump and held it whole in the tab as a Blob. With a link the
 * browser streams it to disk.
 */
export function createBackupLinkRoutes(config: Pick<BackupRoutesConfig, "getDestination" | "storageFor">): Hono<HonoEnv> {
    const router = new Hono<HonoEnv>();
    router.onError(errorHandler);
    const storageOf = storageResolver(config);
    router.get("/download", async (c, next) => {
        const token = c.req.query("token");
        if (token === undefined) return next();
        const dest = destinationOf(config);
        const key = c.req.query("key") ?? "";
        if (!(await linkGrants(jwtOf(c), token, dest, key))) {
            throw ApiError.unauthenticated(
                "This download link is not valid for this backup, or it has expired. Links last " +
                `${BACKUP_DOWNLOAD_LINK_TTL_SECONDS} seconds: ask for a new one.`
            );
        }
        return serveBackup(c, dest, key, storageOf(dest));
    });
    return router;
}

/**
 * Admin REST routes for the Backups panel.
 *
 * Routes (mounted under `/admin/backups`, admin-guarded by the caller):
 *   GET  /              → list available backups, and the scheduled job's last run
 *   GET  /download      → download a backup's bytes (?key=…)
 *   POST /download-url  → a 60-second link to one backup, `{ key }` → {@link BackupDownloadLink}
 *
 * The link is spent at `GET /download?key=…&token=…`, which
 * {@link createBackupLinkRoutes} answers ahead of the gate.
 */
export function createBackupRoutes(config: BackupRoutesConfig): Hono<HonoEnv> {
    const router = new Hono<HonoEnv>();
    router.onError(errorHandler);

    const storageOf = storageResolver(config);

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
        const dest = destinationOf(config);
        const key = c.req.query("key");
        if (!key) {
            throw ApiError.badRequest("Missing 'key' query parameter.");
        }
        return serveBackup(c, dest, key, storageOf(dest));
    });

    router.post("/download-url", async (c) => {
        const dest = destinationOf(config);
        const body: unknown = await c.req.json().catch(() => null);
        const key = typeof body === "object" && body !== null && "key" in body ? body.key : undefined;
        if (typeof key !== "string" || !key) {
            throw ApiError.badRequest("Send the backup's key: { \"key\": \"…\" }.");
        }
        // The download route's own guards, so a link is never minted for a
        // key it would refuse; and the backup is there, so the browser is not
        // sent to a 404 in place of a file.
        if (!(await findBackup(dest, key, storageOf(dest)))) {
            throw ApiError.notFound(`Backup not found: ${key}`);
        }
        const jwt = jwtOf(c);
        if (!jwt.isConfigured()) {
            throw ApiError.serviceUnavailable(
                "Download links are signed with the JWT secret, and this server has none (auth.jwtSecret). " +
                "Download through GET /download with the Authorization header instead."
            );
        }
        const token = await jwt.signPurposeToken(
            BACKUP_DOWNLOAD_PURPOSE,
            { aud: BACKUP_DOWNLOAD_AUDIENCE, scope: linkScope(dest, key) },
            BACKUP_DOWNLOAD_LINK_TTL_SECONDS
        );
        const download = new URL("download", c.req.url).pathname;
        return c.json({
            url: `${download}?key=${encodeURIComponent(key)}&token=${encodeURIComponent(token)}`,
            token,
            expiresIn: BACKUP_DOWNLOAD_LINK_TTL_SECONDS
        } satisfies BackupDownloadLink);
    });

    return router;
}
