import fs from "fs";

/**
 * What became of a migration `db generate` was finishing.
 *
 * `removed` says whether the half-finished file is gone; `rehashError` is set
 * when it is gone but `atlas.sum` could not be brought back in line with the
 * directory, which `atlas migrate` then refuses with a checksum error — loud,
 * which is the point.
 */
export type MigrationPostProcessOutcome =
    | { ok: true }
    | { ok: false; error: string; removed: boolean; rehashError?: string };

/**
 * Run the steps that finish a migration Atlas just wrote — the search, vector
 * and trigger DDL, the RLS bootstrap and policies, the re-hash — and take the
 * migration back out when any of them fails.
 *
 * Atlas's own file creates the tables and nothing else: no `ENABLE ROW LEVEL
 * SECURITY`, no policy. Those arrive in the append. A failure here used to be a
 * yellow warning followed by "You can now run rebase db migrate", and when it
 * struck before the file was rewritten the checksum still matched — so the
 * migration applied cleanly and created every new table with RLS off while
 * the schema's default privileges handed `rebase_user` full DML on it. On a
 * deployment that runs migrations and never provisions at boot
 * (`REBASE_MIGRATE_ON_BOOT=none`), nothing closed it again.
 *
 * Deleting the file is safe because it is the one this run created: running
 * `db generate` again, once the cause is fixed, writes the same diff.
 */
export async function finishNewMigration(
    file: string,
    steps: () => Promise<void>,
    rehash: () => Promise<void>
): Promise<MigrationPostProcessOutcome> {
    try {
        await steps();
        return { ok: true };
    } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        let removed = false;
        try {
            if (fs.existsSync(file)) fs.unlinkSync(file);
            removed = !fs.existsSync(file);
        } catch {
            removed = false;
        }
        if (!removed) return { ok: false, error, removed };
        try {
            await rehash();
            return { ok: false, error, removed };
        } catch (hashErr) {
            return { ok: false, error, removed, rehashError: hashErr instanceof Error ? hashErr.message : String(hashErr) };
        }
    }
}
