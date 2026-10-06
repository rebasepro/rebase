/**
 * The storage controller that reads a backup bucket.
 *
 * A backup destination is its own bucket, named by `BACKUP_DESTINATION`, and
 * the documented backup cron writes to it through a controller it builds from
 * the `S3_*` variables (GCS: application default credentials) — as
 * `rebase db backups list` does. The admin routes have to read it the same way.
 * The app's file storage is not that controller: it is configured for the
 * uploads bucket, it is a local directory in development, and in production
 * without an uploads bucket there is none at all.
 */
import { parseEnvBoolean } from "@rebasepro/types";
import { GCSStorageController } from "../storage/GCSStorageController";
import { S3StorageController } from "../storage/S3StorageController";
import type { StorageController } from "../storage/types";
import type { BackupDestination } from "./backup-common";

/** A destination in object storage — `s3://bucket/prefix` or `gs://bucket/prefix`. */
export type ObjectBackupDestination = Exclude<BackupDestination, { kind: "local" }>;

/** The destination as `BACKUP_DESTINATION` spells it. */
export function describeBackupDestination(dest: BackupDestination): string {
    if (dest.kind === "local") return dest.path;
    const scheme = dest.kind === "s3" ? "s3" : "gs";
    return `${scheme}://${dest.bucket}${dest.prefix ? `/${dest.prefix}` : ""}`;
}

/**
 * A controller for an object-storage destination's bucket, built from the
 * environment the way the backup cron and `rebase db backups list` build
 * theirs. Throws when an S3 destination has no credentials to read it with.
 */
export function backupStorageFromEnv(
    dest: ObjectBackupDestination,
    env: Record<string, string | undefined>
): StorageController {
    if (dest.kind === "gcs") {
        return new GCSStorageController({ type: "gcs", bucket: dest.bucket });
    }
    // s3 also covers R2, MinIO and the other S3-compatible stores, through S3_ENDPOINT.
    if (!env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) {
        throw new Error(
            "S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY are not set in this server's environment. " +
            "Set the same S3_* variables the backup cron uses."
        );
    }
    return new S3StorageController({
        type: "s3",
        bucket: dest.bucket,
        region: env.S3_REGION || "auto",
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
        endpoint: env.S3_ENDPOINT,
        // Unset stays unset, so the controller decides from the endpoint.
        forcePathStyle: parseEnvBoolean(env.S3_FORCE_PATH_STYLE)
    });
}
