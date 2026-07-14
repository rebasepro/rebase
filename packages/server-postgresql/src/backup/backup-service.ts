/**
 * Backup / restore orchestration: thin, well-typed wrappers around
 * `pg_dump` and `pg_restore`, plus binary detection, version pre-flight,
 * and upload/prune against a storage backend.
 *
 * The pure argument- and policy-logic lives in `pg-tools.ts` and
 * `retention.ts`; this module is the impure edge (spawns processes, talks
 * to Postgres and storage) and is intentionally kept small.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { execa } from "execa";
import type { StorageController } from "@rebasepro/server-core";
import { resolveLocalBin } from "../cli-helpers";
import {
    BackupDestination,
    buildBackupFilename,
    buildPgDumpArgs,
    buildPgRestoreArgs,
    checkToolServerCompatibility,
    joinStorageKey,
    parsePgToolMajor,
    parseBackupTimestamp,
    serverVersionNumToMajor,
    VersionCompatibility
} from "./pg-tools";
import { BackupObject, RetentionOptions, selectBackupsToPrune } from "./retention";

export class BackupToolError extends Error {
    constructor(message: string, readonly hint?: string) {
        super(message);
        this.name = "BackupToolError";
    }
}

/** Locate `pg_dump` / `pg_restore`, honouring an env override. */
export function resolvePgBinary(
    tool: "pg_dump" | "pg_restore",
    env: Record<string, string | undefined> = process.env
): string | null {
    const override = tool === "pg_dump" ? env.PG_DUMP_PATH : env.PG_RESTORE_PATH;
    if (override && fs.existsSync(override)) return override;
    return resolveLocalBin(tool);
}

/** Run `<bin> --version` and extract the major version. */
export async function detectToolMajor(bin: string): Promise<number | null> {
    try {
        const { stdout } = await execa(bin, ["--version"]);
        return parsePgToolMajor(stdout);
    } catch {
        return null;
    }
}

/** Query the server for its major version via `server_version_num`. */
export async function getServerVersionMajor(connectionString: string): Promise<number | null> {
    const { Client } = await import("pg");
    const client = new Client({ connectionString });
    await client.connect();
    try {
        const res = await client.query("SHOW server_version_num");
        const raw = res.rows?.[0]?.server_version_num;
        return serverVersionNumToMajor(raw);
    } finally {
        await client.end();
    }
}

export interface PreflightResult extends VersionCompatibility {
    bin: string;
    toolMajor: number | null;
    serverMajor: number | null;
}

/**
 * Verify the requested client tool exists and its major version is
 * compatible with the live server. Throws {@link BackupToolError} — with a
 * doctor-style hint — when the binary is missing.
 */
export async function preflight(
    tool: "pg_dump" | "pg_restore",
    connectionString: string,
    env: Record<string, string | undefined> = process.env
): Promise<PreflightResult> {
    const bin = resolvePgBinary(tool, env);
    if (!bin) {
        throw new BackupToolError(
            `Could not find the '${tool}' binary.`,
            `Install the PostgreSQL client tools (e.g. 'brew install libpq' or 'apt-get install postgresql-client'), ` +
            `or set ${tool === "pg_dump" ? "PG_DUMP_PATH" : "PG_RESTORE_PATH"} to its full path.`
        );
    }
    const [toolMajor, serverMajor] = await Promise.all([
        detectToolMajor(bin),
        getServerVersionMajor(connectionString)
    ]);
    const compat = checkToolServerCompatibility(toolMajor, serverMajor);
    return { bin, toolMajor, serverMajor, ...compat };
}

export interface BackupResult {
    /** Absolute path of the produced dump file on local disk. */
    localFile: string;
    fileName: string;
    sizeBytes: number;
}

/**
 * Produce a custom-format dump on local disk. When `outDir` is omitted the
 * file is written to the OS temp directory (used by the upload path, which
 * cleans it up afterwards).
 */
export async function createDump(opts: {
    connectionString: string;
    dbName: string;
    outDir?: string;
    fileName?: string;
    excludeSchemas?: string[];
    noOwner?: boolean;
    inheritStdio?: boolean;
    env?: Record<string, string | undefined>;
}): Promise<BackupResult> {
    const env = opts.env ?? process.env;
    const bin = resolvePgBinary("pg_dump", env);
    if (!bin) {
        throw new BackupToolError(
            "Could not find the 'pg_dump' binary.",
            "Install the PostgreSQL client tools or set PG_DUMP_PATH."
        );
    }

    const fileName = opts.fileName ?? buildBackupFilename(opts.dbName);
    const outDir = opts.outDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "rebase-backup-"));
    fs.mkdirSync(outDir, { recursive: true });
    const localFile = path.join(outDir, fileName);

    const args = buildPgDumpArgs({
        connectionString: opts.connectionString,
        outFile: localFile,
        excludeSchemas: opts.excludeSchemas,
        noOwner: opts.noOwner
    });

    await execa(bin, args, {
        stdio: opts.inheritStdio ? "inherit" : "pipe",
        env: { ...(env as Record<string, string>) }
    });

    const sizeBytes = fs.existsSync(localFile) ? fs.statSync(localFile).size : 0;
    return { localFile, fileName, sizeBytes };
}

/**
 * Restore a custom-format dump into the database named by
 * `connectionString`. Destructive when `clean` is set (drops objects
 * first). Never called automatically — the CLI gates it behind explicit
 * confirmation.
 */
export async function restoreDump(opts: {
    connectionString: string;
    inputFile: string;
    clean?: boolean;
    noOwner?: boolean;
    inheritStdio?: boolean;
    env?: Record<string, string | undefined>;
}): Promise<void> {
    const env = opts.env ?? process.env;
    const bin = resolvePgBinary("pg_restore", env);
    if (!bin) {
        throw new BackupToolError(
            "Could not find the 'pg_restore' binary.",
            "Install the PostgreSQL client tools or set PG_RESTORE_PATH."
        );
    }
    const args = buildPgRestoreArgs({
        connectionString: opts.connectionString,
        inputFile: opts.inputFile,
        clean: opts.clean,
        noOwner: opts.noOwner
    });
    await execa(bin, args, {
        stdio: opts.inheritStdio ? "inherit" : "pipe",
        env: { ...(env as Record<string, string>) }
    });
}

/**
 * Create a database (if absent) by connecting to the maintenance
 * `postgres` database. Used by `restore --create-db`.
 */
export async function ensureDatabaseExists(
    adminConnectionString: string,
    dbName: string
): Promise<boolean> {
    const { Client } = await import("pg");
    const parsed = new URL(adminConnectionString);
    parsed.pathname = "/postgres";
    const client = new Client({ connectionString: parsed.toString() });
    await client.connect();
    try {
        const existing = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
        if (existing.rowCount && existing.rowCount > 0) {
            return false;
        }
        // Identifier can't be parameterised; guard against injection.
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(dbName)) {
            throw new BackupToolError(`Invalid database name: "${dbName}"`);
        }
        await client.query(`CREATE DATABASE "${dbName}"`);
        return true;
    } finally {
        await client.end();
    }
}

/**
 * Upload a local dump to object storage under the destination's prefix.
 * Backups may contain secrets/PII, so the object is written with a
 * private/octet-stream content type; bucket-level ACLs must stay private.
 */
export async function uploadBackup(
    storage: StorageController,
    localFile: string,
    dest: Extract<BackupDestination, { kind: "s3" | "gcs" }>
): Promise<{ key: string; storageUrl: string }> {
    const fileName = path.basename(localFile);
    const key = joinStorageKey(dest.prefix, fileName);
    const buffer = fs.readFileSync(localFile);
    const file = new File([buffer], fileName, { type: "application/octet-stream" });
    const result = await storage.putObject({
        file,
        key,
        bucket: dest.bucket,
        metadata: { "rebase-backup": "1" }
    });
    return { key, storageUrl: result.storageUrl ?? `${dest.kind}://${dest.bucket}/${key}` };
}

/**
 * List existing backups at a destination. For local destinations reads the
 * directory; for object storage lists the prefix via the controller.
 */
export async function listBackups(
    dest: BackupDestination,
    storage?: StorageController
): Promise<BackupObject[]> {
    if (dest.kind === "local") {
        if (!fs.existsSync(dest.path)) return [];
        const stat = fs.statSync(dest.path);
        const dir = stat.isDirectory() ? dest.path : path.dirname(dest.path);
        return fs
            .readdirSync(dir)
            .filter((f) => f.endsWith(".dump"))
            .map((f) => {
                const full = path.join(dir, f);
                const createdAt = parseBackupTimestamp(f) ?? fs.statSync(full).mtime;
                return { key: full, createdAt };
            })
            .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
    }

    if (!storage) {
        throw new BackupToolError(
            `Listing ${dest.kind} backups requires a configured storage backend.`
        );
    }
    const result = await storage.listObjects(dest.prefix ? `${dest.prefix}/` : "", {
        bucket: dest.bucket,
        maxResults: 1000
    });
    return result.items
        .map((item) => item.fullPath)
        .filter((key) => key.endsWith(".dump"))
        .map((key) => ({ key, createdAt: parseBackupTimestamp(key) ?? undefined }))
        .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
}

/**
 * Apply a retention policy to a destination, deleting the backups selected
 * by {@link selectBackupsToPrune}. Returns the keys that were removed.
 */
export async function pruneBackups(
    dest: BackupDestination,
    options: RetentionOptions,
    storage?: StorageController
): Promise<string[]> {
    const backups = await listBackups(dest, storage);
    const toDelete = selectBackupsToPrune(backups, options);
    for (const key of toDelete) {
        if (dest.kind === "local") {
            if (fs.existsSync(key)) fs.unlinkSync(key);
        } else if (storage) {
            await storage.deleteObject(key, dest.bucket);
        }
    }
    return toDelete;
}
