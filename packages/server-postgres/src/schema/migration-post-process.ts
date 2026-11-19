import fs from "fs";
import { REBASE_ADMIN_ROLE } from "@rebasepro/types";
import { ADMIN_POLICY_ROLE_SQL } from "./rls-bootstrap-sql";

/**
 * Make generated Rebase helpers replayable after auth bootstrap. Leave other
 * functions' CREATE semantics intact. The admin role is cluster-wide, so it
 * must be created conditionally even when the scratch server lacked it.
 */
export function preparePtahMigration(migration: string, needsAdminRole: boolean): string {
    let prepared = migration
        .replace(/CREATE SCHEMA (?!IF NOT EXISTS)("[^"]+");/g, "CREATE SCHEMA IF NOT EXISTS $1;")
        .replace(
            /^CREATE FUNCTION ("?rebase"?\."?(?:uid|jwt|roles|is_anonymous|is_request_role|set_updated_at)"?\()/gm,
            "CREATE OR REPLACE FUNCTION $1"
        );
    if (needsAdminRole) {
        prepared = prepared.replace(
            new RegExp(`^CREATE ROLE "${REBASE_ADMIN_ROLE}"(?: WITH [^;\\n]+)?;\\n?`, "gm"),
            ""
        );
        prepared = `${ADMIN_POLICY_ROLE_SQL};\n\n${prepared}`;
    }
    return prepared;
}

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
 * Run the steps that finish a migration Ptah wrote and take the migration
 * back out when any of them fails.
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
