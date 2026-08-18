/**
 * Retention pruning for scheduled backups. Pure logic — no I/O — so it can
 * be exhaustively unit-tested without touching a storage backend.
 */
import { parseBackupTimestamp } from "./pg-tools";

export interface BackupObject {
    /** Storage key / file name. */
    key: string;
    /**
     * Creation time. Optional — when absent it is recovered from the
     * timestamp encoded in the key by `buildBackupFilename`.
     */
    createdAt?: Date;
    /**
     * Size on disk, when the lister knows it (local destinations always do).
     *
     * Reported so an empty artifact cannot masquerade as a backup in
     * `rebase db backups list`. Deliberately NOT consulted by
     * {@link selectBackupsToPrune}: retention decides by age, and a rule that
     * silently skipped small files would make a genuinely tiny dump immortal.
     * Visibility is the fix here; the artifacts themselves are now removed at
     * the point of failure by `discardPartialDump`.
     */
    sizeBytes?: number;
}

export interface RetentionOptions {
    /** Delete backups older than this many days. `0`/negative disables age pruning. */
    retentionDays?: number;
    /**
     * Always keep at least this many of the most recent backups, even if
     * they are older than `retentionDays`. Guards against wiping every
     * backup after a long outage. Default: 0 (no minimum).
     */
    keepMinimum?: number;
    /** Reference "now" — injectable for deterministic tests. */
    now?: Date;
}

/**
 * Decide which backups to delete under the given retention policy.
 *
 * Rules, applied in order:
 *  1. Objects whose key isn't a recognised rebase backup (no parseable
 *     timestamp and no `createdAt`) are never selected — foreign files in a
 *     shared bucket are left untouched.
 *  2. The `keepMinimum` newest backups are always retained.
 *  3. Of the remainder, any older than `retentionDays` are selected for
 *     deletion.
 *
 * Returns the keys to delete, oldest first.
 */
export function selectBackupsToPrune(
    backups: BackupObject[],
    options: RetentionOptions
): string[] {
    const retentionDays = options.retentionDays ?? 0;
    const keepMinimum = Math.max(0, options.keepMinimum ?? 0);
    const now = options.now ?? new Date();

    if (retentionDays <= 0) {
        return [];
    }

    // Resolve a timestamp for every object; drop the ones we can't date.
    const dated = backups
        .map((b) => {
            const createdAt = b.createdAt ?? parseBackupTimestamp(b.key);
            return createdAt ? { key: b.key, createdAt } : null;
        })
        .filter((b): b is { key: string; createdAt: Date } => b !== null);

    // Newest first so the first `keepMinimum` are the protected ones.
    dated.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;

    const toDelete = dated
        .slice(keepMinimum)
        .filter((b) => b.createdAt.getTime() < cutoff);

    // Return oldest first for predictable, readable logs.
    toDelete.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    return toDelete.map((b) => b.key);
}
