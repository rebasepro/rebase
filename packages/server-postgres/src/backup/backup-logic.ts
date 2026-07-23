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
