/**
 * Where the PostgreSQL client tools are, without spawning them.
 *
 * Kept apart from `backup-service.ts`, which pulls in `execa` (ESM-only), so
 * `createBackupCron` can check for the tools when it is registered.
 */
import fs from "fs";
import { resolveLocalBin } from "../cli-helpers";

export type PgTool = "pg_dump" | "pg_restore" | "pg_dumpall" | "psql";

const OVERRIDE_VARIABLE: Record<PgTool, string> = {
    pg_dump: "PG_DUMP_PATH",
    pg_restore: "PG_RESTORE_PATH",
    pg_dumpall: "PG_DUMPALL_PATH",
    psql: "PSQL_PATH"
};

/** The variable that points at `tool` when it is not on the PATH. */
export function pgToolVariable(tool: PgTool): string {
    return OVERRIDE_VARIABLE[tool];
}

/** Locate `pg_dump` / `pg_restore` / `pg_dumpall` / `psql`, honouring an env override. */
export function resolvePgBinary(
    tool: PgTool,
    env: Record<string, string | undefined> = process.env
): string | null {
    const override = env[OVERRIDE_VARIABLE[tool]];
    if (override && fs.existsSync(override)) return override;
    return resolveLocalBin(tool);
}
