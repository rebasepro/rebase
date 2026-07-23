/**
 * Scheduled backups, wired into the server cron system.
 *
 * A backend enables nightly (or custom-schedule) backups by dropping a cron
 * file that default-exports {@link createBackupCron}. The heavy lifting —
 * dump, upload, prune — reuses the same primitives as the CLI so behaviour
 * is identical between a manual `rebase db backup` and an automated run.
 */
import fs from "fs";
import type { CronJobDefinition } from "@rebasepro/types";
import type { StorageController } from "@rebasepro/server";
import {
    BackupDestination,
    parseBackupDestination,
    parseDbNameFromUrl,
    resolveConnectionString
} from "./pg-tools";
// NOTE: `./backup-service` pulls in `execa` (ESM-only). It is imported
// lazily inside the handler so the pure `backupCronConfigFromEnv` parser can
// be unit-tested under CommonJS without loading it.

export interface BackupCronConfig {
    /** Cron expression, e.g. `"0 3 * * *"` for 03:00 daily. */
    schedule: string;
    /** Postgres connection string. Defaults to `DATABASE_URL`. */
    connectionString: string;
    /** Where backups are written: a local path or an `s3://` / `gs://` URL. */
    destination: BackupDestination;
    /**
     * Storage controller used for `s3`/`gcs` destinations. Reuse the one the
     * backend already configured (S3/GCS/Local StorageController). Not needed
     * for local destinations.
     */
    storage?: StorageController;
    /** Delete backups older than this many days. `0` disables pruning. */
    retentionDays?: number;
    /** Always keep at least this many recent backups regardless of age. */
    keepMinimum?: number;
    /** Schemas to exclude from the dump (defaults to Atlas revision schema). */
    excludeSchemas?: string[];
    /** Cron job display name. */
    name?: string;
    /** Whether the job is enabled. */
    enabled?: boolean;
}

export interface EnvResolution {
    /** Resolved config, present when a schedule is configured. */
    config?: Omit<BackupCronConfig, "storage">;
    /** True when `BACKUP_SCHEDULE` is unset — the cron should be a no-op. */
    disabled?: boolean;
    /** Human-readable reason the config could not be built. */
    error?: string;
}

/**
 * Build backup-cron config purely from environment variables.
 * Recognised keys:
 *   - `BACKUP_SCHEDULE`        cron expression (required to enable)
 *   - `BACKUP_DESTINATION`     local path or `s3://` / `gs://` URL (required)
 *   - `BACKUP_RETENTION_DAYS`  integer days (optional)
 *   - `BACKUP_KEEP_MINIMUM`    integer count (optional)
 *   - `DATABASE_URL`           connection string
 *
 * Pure and side-effect free so it can be unit-tested without a database.
 */
export function backupCronConfigFromEnv(env: Record<string, string | undefined>): EnvResolution {
    const schedule = env.BACKUP_SCHEDULE?.trim();
    if (!schedule) {
        return { disabled: true };
    }

    const connectionString = resolveConnectionString(env);
    if (!connectionString) {
        return { error: "BACKUP_SCHEDULE is set but DATABASE_URL is not configured." };
    }

    const destinationRaw = env.BACKUP_DESTINATION?.trim();
    if (!destinationRaw) {
        return { error: "BACKUP_SCHEDULE is set but BACKUP_DESTINATION is not configured." };
    }
    const destination = parseBackupDestination(destinationRaw);

    const retentionDays = parseOptionalInt(env.BACKUP_RETENTION_DAYS);
    if (retentionDays === "invalid") {
        return { error: `BACKUP_RETENTION_DAYS must be an integer, got "${env.BACKUP_RETENTION_DAYS}".` };
    }
    const keepMinimum = parseOptionalInt(env.BACKUP_KEEP_MINIMUM);
    if (keepMinimum === "invalid") {
        return { error: `BACKUP_KEEP_MINIMUM must be an integer, got "${env.BACKUP_KEEP_MINIMUM}".` };
    }

    return {
        config: {
            schedule,
            connectionString,
            destination,
            retentionDays: retentionDays ?? undefined,
            keepMinimum: keepMinimum ?? undefined
        }
    };
}

function parseOptionalInt(value: string | undefined): number | null | "invalid" {
    if (value === undefined || value.trim() === "") return null;
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0) return "invalid";
    return n;
}

/**
 * Create a {@link CronJobDefinition} that dumps the database, uploads the
 * result to the configured destination, and prunes old backups. Object
 * destinations require {@link BackupCronConfig.storage}.
 */
export function createBackupCron(config: BackupCronConfig): CronJobDefinition {
    const dbName = parseDbNameFromUrl(config.connectionString) ?? "database";
    const excludeSchemas = config.excludeSchemas ?? ["rebase"];

    return {
        name: config.name ?? "Scheduled database backup",
        schedule: config.schedule,
        description: "Dumps the Postgres database and uploads it to the configured backup destination.",
        enabled: config.enabled ?? true,
        // Backups of a large database can take a while; allow up to an hour.
        timeoutSeconds: 3600,
        async handler({ log }) {
            const { createDump, pruneBackups, uploadBackup, validateDump } = await import("./backup-service");
            const { destination } = config;

            if (destination.kind !== "local" && !config.storage) {
                throw new Error(
                    `Backup destination is ${destination.kind} but no storage controller was provided. ` +
                    "Pass the backend's configured StorageController to createBackupCron({ storage })."
                );
            }

            log(`Starting backup of "${dbName}"…`);
            const outDir = destination.kind === "local" ? destination.path : undefined;
            const dump = await createDump({
                connectionString: config.connectionString,
                dbName,
                outDir,
                excludeSchemas
            });
            log(`Dump created: ${dump.fileName} (${formatBytes(dump.sizeBytes)})`);

            // Validate BEFORE pruning: a corrupt-but-exit-0 dump must never be
            // the reason the last good backup gets deleted.
            const check = await validateDump(dump.localFile);
            if (!check.ok) {
                // Clean up the bad temp file for object destinations.
                if (destination.kind !== "local" && fs.existsSync(dump.localFile)) {
                    fs.unlinkSync(dump.localFile);
                }
                if (dump.globalsFile && destination.kind !== "local" && fs.existsSync(dump.globalsFile)) {
                    fs.unlinkSync(dump.globalsFile);
                }
                throw new Error(`New backup failed validation — skipping upload and pruning to protect existing backups. ${check.reason}`);
            }

            let storedKey = dump.localFile;
            try {
                if (destination.kind !== "local") {
                    const uploaded = await uploadBackup(config.storage!, dump.localFile, destination);
                    storedKey = uploaded.storageUrl;
                    log(`Uploaded to ${uploaded.storageUrl}`);
                    // Upload the roles sidecar so a restore can recreate the
                    // roles the dump's GRANT/RLS statements depend on.
                    if (dump.globalsFile && fs.existsSync(dump.globalsFile)) {
                        const g = await uploadBackup(config.storage!, dump.globalsFile, destination);
                        log(`Uploaded roles sidecar to ${g.storageUrl}`);
                    }
                }
            } finally {
                // For object-storage destinations the local dump was a temp
                // file — remove it once uploaded (or on failure).
                if (destination.kind !== "local" && fs.existsSync(dump.localFile)) {
                    fs.unlinkSync(dump.localFile);
                }
                if (dump.globalsFile && destination.kind !== "local" && fs.existsSync(dump.globalsFile)) {
                    fs.unlinkSync(dump.globalsFile);
                }
            }

            let pruned: string[] = [];
            if (config.retentionDays && config.retentionDays > 0) {
                pruned = await pruneBackups(
                    destination,
                    { retentionDays: config.retentionDays, keepMinimum: config.keepMinimum },
                    config.storage
                );
                if (pruned.length > 0) {
                    log(`Pruned ${pruned.length} backup(s) older than ${config.retentionDays} day(s).`);
                }
            }

            return {
                backup: storedKey,
                sizeBytes: dump.sizeBytes,
                pruned: pruned.length
            };
        }
    };
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
