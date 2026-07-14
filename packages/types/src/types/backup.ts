/**
 * Backup type definitions shared across server-core, client, and studio.
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
}
