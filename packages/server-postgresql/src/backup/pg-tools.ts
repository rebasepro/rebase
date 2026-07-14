/**
 * Pure helpers for the backup/restore commands.
 *
 * Everything in this file is side-effect free so it can be unit-tested
 * without a live Postgres server, matching the constraint that CI must
 * not require a database.
 */

/**
 * A parsed backup destination. `--out` (and the scheduled-backup config)
 * accepts either a local filesystem path or an object-storage URL.
 */
export type BackupDestination =
    | { kind: "local"; path: string }
    | { kind: "s3"; bucket: string; prefix: string }
    | { kind: "gcs"; bucket: string; prefix: string };

/**
 * Extract the database name from a Postgres connection string.
 * Returns `null` when the URL has no database path (e.g. bare host).
 */
export function parseDbNameFromUrl(connectionString: string): string | null {
    try {
        const parsed = new URL(connectionString);
        const name = parsed.pathname.replace(/^\//, "").trim();
        return name.length > 0 ? name : null;
    } catch {
        // Fall back to a permissive regex for non-URL DSNs.
        const match = connectionString.match(/\/([^/?]+)(\?|$)/);
        return match && match[1] ? match[1] : null;
    }
}

/**
 * Swap the database name in a connection string, preserving credentials,
 * host, port and query params. Used by `--target-db` / `--create-db` so a
 * restore can target a fresh database instead of clobbering the live one.
 */
export function withDatabaseName(connectionString: string, dbName: string): string {
    try {
        const parsed = new URL(connectionString);
        parsed.pathname = `/${dbName}`;
        return parsed.toString();
    } catch {
        return connectionString.replace(/\/([^/?]+)(\?|$)/, `/${dbName}$2`);
    }
}

/**
 * Parse the major version out of `pg_dump --version` / `pg_restore --version`
 * output, e.g. `"pg_dump (PostgreSQL) 16.2"` → `16`. Handles the pre-10
 * `9.6.x` scheme (returns `9`) and beta strings like `"17beta1"`.
 */
export function parsePgToolMajor(versionOutput: string): number | null {
    const match = versionOutput.match(/(\d+)(?:\.(\d+))?/);
    if (!match) return null;
    const major = Number(match[1]);
    if (!Number.isFinite(major)) return null;
    // Postgres 9.x used the first two numbers as the major (9.6, 9.4…).
    if (major === 9 && match[2] !== undefined) {
        return 9;
    }
    return major;
}

/**
 * Convert `SELECT current_setting('server_version_num')` (e.g. `160002`)
 * into a major version (`16`). Also accepts pre-10 encodings like `90603`
 * → `9`.
 */
export function serverVersionNumToMajor(versionNum: number | string): number | null {
    const num = typeof versionNum === "string" ? Number(versionNum) : versionNum;
    if (!Number.isFinite(num) || num <= 0) return null;
    if (num < 100000) {
        // 9.x scheme: 90603 = 9.6.3
        return Math.floor(num / 10000);
    }
    return Math.floor(num / 10000);
}

export interface VersionCompatibility {
    compatible: boolean;
    reason?: string;
}

/**
 * pg_dump / pg_restore must be **at least** as new as the server they talk
 * to. A newer client against an older server is supported; an older client
 * against a newer server is not and produces corrupt or rejected output.
 */
export function checkToolServerCompatibility(
    toolMajor: number | null,
    serverMajor: number | null
): VersionCompatibility {
    if (toolMajor === null) {
        return { compatible: false, reason: "Could not determine the client tool version." };
    }
    if (serverMajor === null) {
        return { compatible: false, reason: "Could not determine the Postgres server version." };
    }
    if (toolMajor < serverMajor) {
        return {
            compatible: false,
            reason:
                `Client tool is Postgres ${toolMajor} but the server is Postgres ${serverMajor}. ` +
                `pg_dump/pg_restore must be the same major version as the server or newer. ` +
                `Install Postgres ${serverMajor} client tools.`
        };
    }
    return { compatible: true };
}

/**
 * Build a deterministic, sortable backup file name:
 *   `rebase-<db>-<YYYYMMDD>T<HHMMSS>Z.dump`
 *
 * The UTC timestamp is embedded so retention pruning can recover the
 * creation time from the object key alone, without extra metadata.
 */
export function buildBackupFilename(dbName: string, date: Date = new Date()): string {
    const iso = date.toISOString(); // 2026-07-14T09:12:03.123Z
    const stamp = iso.replace(/\.\d+Z$/, "Z").replace(/[-:]/g, "");
    const safeDb = dbName.replace(/[^a-zA-Z0-9_-]/g, "_");
    return `rebase-${safeDb}-${stamp}.dump`;
}

/**
 * Recover the creation timestamp encoded in a backup file name by
 * {@link buildBackupFilename}. Returns `null` for names that don't match,
 * so foreign objects in a shared prefix are never pruned.
 */
export function parseBackupTimestamp(fileName: string): Date | null {
    const base = fileName.split("/").pop() ?? fileName;
    const match = base.match(/-(\d{8})T(\d{6})Z\.dump$/);
    if (!match) return null;
    const [, ymd, hms] = match;
    const iso =
        `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}` +
        `T${hms.slice(0, 2)}:${hms.slice(2, 4)}:${hms.slice(4, 6)}Z`;
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Parse a destination string into a structured {@link BackupDestination}.
 * `s3://bucket/prefix` and `gs://bucket/prefix` map to object storage;
 * anything else is treated as a local path.
 */
export function parseBackupDestination(out: string): BackupDestination {
    const s3 = out.match(/^s3:\/\/([^/]+)\/?(.*)$/);
    if (s3) {
        return { kind: "s3", bucket: s3[1], prefix: stripTrailingSlash(s3[2]) };
    }
    const gcs = out.match(/^gs:\/\/([^/]+)\/?(.*)$/);
    if (gcs) {
        return { kind: "gcs", bucket: gcs[1], prefix: stripTrailingSlash(gcs[2]) };
    }
    return { kind: "local", path: out };
}

function stripTrailingSlash(s: string): string {
    return s.replace(/\/+$/, "");
}

/**
 * Join a storage prefix and a file name without producing a leading or
 * doubled slash.
 */
export function joinStorageKey(prefix: string, fileName: string): string {
    const clean = prefix.replace(/^\/+|\/+$/g, "");
    return clean.length > 0 ? `${clean}/${fileName}` : fileName;
}

/**
 * Assemble the `pg_dump` argument vector. Uses the custom format (`-Fc`),
 * which is compressed and restorable selectively via `pg_restore`.
 */
export function buildPgDumpArgs(opts: {
    connectionString: string;
    outFile: string;
    /** Extra schemas/tables to exclude, e.g. Atlas revision tables. */
    excludeSchemas?: string[];
    /** Number of parallel jobs (directory format only; ignored for -Fc). */
    noOwner?: boolean;
}): string[] {
    const args = ["--format=custom", "--no-password", `--file=${opts.outFile}`];
    if (opts.noOwner) {
        args.push("--no-owner");
    }
    for (const schema of opts.excludeSchemas ?? []) {
        args.push(`--exclude-schema=${schema}`);
    }
    args.push(opts.connectionString);
    return args;
}

/**
 * Assemble the `pg_restore` argument vector for a custom-format dump.
 */
export function buildPgRestoreArgs(opts: {
    connectionString: string;
    inputFile: string;
    /** Drop objects before recreating them (destructive but idempotent). */
    clean?: boolean;
    /** Continue past individual errors instead of aborting. */
    exitOnError?: boolean;
    noOwner?: boolean;
}): string[] {
    const args = ["--format=custom", "--no-password", `--dbname=${opts.connectionString}`];
    if (opts.clean) {
        args.push("--clean", "--if-exists");
    }
    if (opts.noOwner) {
        args.push("--no-owner");
    }
    if (opts.exitOnError) {
        args.push("--exit-on-error");
    }
    args.push(opts.inputFile);
    return args;
}

/**
 * Resolve the Postgres connection string the backup commands should use,
 * mirroring the precedence the branch command already relies on.
 */
export function resolveConnectionString(
    env: Record<string, string | undefined>
): string | null {
    return env.DATABASE_URL || env.ADMIN_CONNECTION_STRING || null;
}
