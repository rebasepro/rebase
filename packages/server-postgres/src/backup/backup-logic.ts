/**
 * Pure-ish orchestration for the backup/restore paths, kept free of `execa`
 * and `pg` value imports so it can be unit-tested under jest (the impure
 * edges — spawning processes, opening connections — live in
 * `backup-service.ts`, which is vitest/runtime only).
 *
 * The functions here take their side-effecting dependency as an argument
 * (a statement runner, an object deleter) so tests can inject fakes.
 */
import { globalsFileForDump, splitGlobalsStatements } from "./pg-tools";

/**
 * Replay a `pg_dumpall --globals-only` script one statement at a time,
 * tolerating per-statement failures. On a same-cluster restore the roles
 * usually already exist (`CREATE ROLE` → "already exists") and on a managed
 * provider an `ALTER ROLE <superuser>` may be refused; neither should abort
 * recreation of the roles that *are* missing. Returns how many statements
 * applied vs were skipped.
 *
 * `runStatement` executes one SQL statement and rejects on error.
 */
export async function applyGlobalsWith(
    runStatement: (sql: string) => Promise<void>,
    globalsSql: string,
    log: (message: string) => void = () => {}
): Promise<{ applied: number; skipped: number }> {
    let applied = 0;
    let skipped = 0;
    for (const statement of splitGlobalsStatements(globalsSql)) {
        try {
            await runStatement(statement);
            applied++;
        } catch (err) {
            skipped++;
            const firstLine = statement.split("\n")[0].slice(0, 80);
            log(`  • Skipped global: ${firstLine} (${err instanceof Error ? err.message : String(err)})`);
        }
    }
    return { applied, skipped };
}

/**
 * Delete each pruned dump together with its `.globals.sql` roles sidecar, so
 * pruning never orphans the roles file. The sidecar is best-effort — older
 * backups predate it, so a missing-sidecar failure is swallowed while a
 * failure deleting the dump itself propagates.
 *
 * `deleteObject` removes one key and rejects if it cannot (e.g. not found).
 */
export async function pruneWith(
    keys: string[],
    deleteObject: (key: string) => Promise<void>
): Promise<void> {
    for (const key of keys) {
        await deleteObject(key);
        try {
            await deleteObject(globalsFileForDump(key));
        } catch {
            // Sidecar may not exist for older backups — ignore.
        }
    }
}

/**
 * Remove a dump artifact abandoned by a failed tool run.
 *
 * `pg_dump` creates its `--file=` target before it finishes connecting, so any
 * failure — a URL libpq rejects, a dropped connection, a full disk — leaves a
 * 0-byte file behind. That corpse is not inert: `rebase db backups list` used
 * to show it as an ordinary entry, and `selectBackupsToPrune` ranks by
 * timestamp alone, so it occupies a protected `keepMinimum` slot and can push
 * a real backup out of retention.
 *
 * Best-effort on purpose: the caller is already throwing, and a failed unlink
 * must not replace the real diagnosis with an ENOENT/EPERM from the cleanup.
 *
 * Lives here rather than in `backup-service.ts` for the reason at the top of
 * this file — that module's top-level `execa` import makes it unloadable under
 * jest, so anything placed there cannot be unit-tested.
 *
 * `remove` deletes one file and throws if it cannot; `exists` reports presence.
 */
export function discardPartialDumpWith(
    exists: (file: string) => boolean,
    remove: (file: string) => void,
    file: string
): void {
    try {
        if (exists(file)) remove(file);
    } catch {
        // Ignored: see above.
    }
}
