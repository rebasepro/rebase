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
import type { StorageController } from "@rebasepro/server";
import { resolveLocalBin } from "../cli-helpers";
import {
    BackupDestination,
    buildBackupFilename,
    buildPgDumpArgs,
    buildPgDumpallGlobalsArgs,
    buildRowSecurityPgOptions,
    diagnoseRowSecurityDumpFailure,
    type RowSecurityIdentity,
    buildPgRestoreArgs,
    buildPgRestoreListArgs,
    checkToolServerCompatibility,
    globalsFileForDump,
    joinStorageKey,
    parsePgToolMajor,
    parseBackupTimestamp,
    serverVersionNumToMajor,
    VersionCompatibility
} from "./pg-tools";
import { BackupObject, RetentionOptions, selectBackupsToPrune } from "./retention";
import { applyGlobalsWith, discardPartialDumpWith, pruneWith } from "./backup-logic";

/**
 * Remove a dump artifact abandoned by a failed tool run. See
 * {@link discardPartialDumpWith} for why this exists and why the logic lives
 * in the execa-free module.
 */
export function discardPartialDump(file: string): void {
    discardPartialDumpWith(
        (f) => fs.existsSync(f),
        (f) => fs.unlinkSync(f),
        file
    );
}

export class BackupToolError extends Error {
    constructor(message: string, readonly hint?: string) {
        super(message);
        this.name = "BackupToolError";
    }
}

/** Locate `pg_dump` / `pg_restore` / `pg_dumpall`, honouring an env override. */
export function resolvePgBinary(
    tool: "pg_dump" | "pg_restore" | "pg_dumpall",
    env: Record<string, string | undefined> = process.env
): string | null {
    const overrideVar =
        tool === "pg_dump" ? env.PG_DUMP_PATH
        : tool === "pg_restore" ? env.PG_RESTORE_PATH
        : env.PG_DUMPALL_PATH;
    if (overrideVar && fs.existsSync(overrideVar)) return overrideVar;
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
    /**
     * Absolute path of the `.globals.sql` sidecar holding cluster-wide roles
     * (present unless globals capture was disabled or unavailable).
     */
    globalsFile?: string;
    globalsSizeBytes?: number;
}

/**
 * Produce a custom-format dump on local disk. When `outDir` is omitted the
 * file is written to the OS temp directory (used by the upload path, which
 * cleans it up afterwards).
 *
 * Alongside the `-Fc` dump it writes a `<name>.globals.sql` sidecar via
 * `pg_dumpall --globals-only` so the roles the dump's GRANT/RLS statements
 * depend on can be recreated on restore. Set `includeGlobals: false` to skip
 * it (e.g. when the caller has no privilege to read cluster globals).
 */
export async function createDump(opts: {
    connectionString: string;
    dbName: string;
    outDir?: string;
    fileName?: string;
    excludeSchemas?: string[];
    noOwner?: boolean;
    inheritStdio?: boolean;
    includeGlobals?: boolean;
    env?: Record<string, string | undefined>;
    /**
     * Dump with row security left on, reading as this identity.
     *
     * The escape hatch for a managed Postgres, where the dumping role owns
     * nothing and has no `BYPASSRLS`. Off by default, and deliberately so: with
     * row security on, `pg_dump` stops erroring on rows it cannot see and
     * simply omits them. See {@link RowSecurityIdentity}.
     */
    rowSecurity?: RowSecurityIdentity;
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
        noOwner: opts.noOwner,
        rowSecurity: opts.rowSecurity
    });

    // `PGOPTIONS` is the only way to set a GUC on a tool that takes no SQL.
    // Built from the same object that added `--enable-row-security`, so the
    // flag cannot travel without the identity that makes it safe.
    const dumpEnv: Record<string, string> = { ...(env as Record<string, string>) };
    if (opts.rowSecurity) {
        dumpEnv.PGOPTIONS = [env.PGOPTIONS, buildRowSecurityPgOptions(opts.rowSecurity)]
            .filter(Boolean).join(" ");
    }

    try {
        await execa(bin, args, {
            stdio: opts.inheritStdio ? "inherit" : "pipe",
            env: dumpEnv
        });
    } catch (error) {
        // pg_dump creates its `--file=` target before it finishes connecting,
        // so any failure here — a URL libpq rejects, a dropped connection, a
        // full disk — leaves a 0-byte file behind that nothing else removed.
        // That corpse is not inert: `rebase db backups list` shows it as an
        // ordinary entry, and `selectBackupsToPrune` ranks by timestamp alone,
        // so it occupies a protected `keepMinimum` slot and can push a real
        // backup out of retention. A missing backup is honest; an empty file
        // that reads as a backup is not.
        discardPartialDump(localFile);
        // The RLS failure names a table and no cause. Replace it with the
        // cause and the two ways out; anything else is re-thrown untouched.
        const diagnosis = diagnoseRowSecurityDumpFailure(error);
        if (!diagnosis) throw error;
        throw new BackupToolError(
            diagnosis,
            "Run `rebase db backup --help` for the flag, and read what it says about partial dumps."
        );
    }

    const sizeBytes = fs.existsSync(localFile) ? fs.statSync(localFile).size : 0;

    const result: BackupResult = { localFile, fileName, sizeBytes };

    if (opts.includeGlobals !== false) {
        const dumpallBin = resolvePgBinary("pg_dumpall", env);
        if (!dumpallBin) {
            throw new BackupToolError(
                "Could not find the 'pg_dumpall' binary needed to capture cluster roles.",
                "Install the PostgreSQL client tools or set PG_DUMPALL_PATH. " +
                "To take a role-incomplete backup anyway, pass includeGlobals: false."
            );
        }
        const globalsFile = globalsFileForDump(localFile);
        try {
            await execa(
                dumpallBin,
                buildPgDumpallGlobalsArgs({ connectionString: opts.connectionString, outFile: globalsFile }),
                { stdio: opts.inheritStdio ? "inherit" : "pipe", env: { ...(env as Record<string, string>) } }
            );
        } catch (error) {
            // Same reasoning as the pg_dump catch above, and the dump goes with
            // it: the pair is uploaded and pruned together, so a dump whose
            // roles sidecar is missing restores without the roles its GRANT and
            // RLS statements need — the exact failure the sidecar exists to
            // prevent. Leaving half a pair on disk would look like a backup.
            discardPartialDump(globalsFile);
            discardPartialDump(localFile);
            throw error;
        }
        result.globalsFile = globalsFile;
        result.globalsSizeBytes = fs.existsSync(globalsFile) ? fs.statSync(globalsFile).size : 0;
    }

    return result;
}

/**
 * Cheap integrity check on a freshly written dump: it must be non-empty and
 * `pg_restore --list` must parse its table of contents without error. Used
 * before pruning older backups so a corrupt-but-exit-0 dump never becomes
 * the reason the last good backup is deleted.
 */
export async function validateDump(
    localFile: string,
    env: Record<string, string | undefined> = process.env
): Promise<{ ok: boolean; reason?: string }> {
    if (!fs.existsSync(localFile)) {
        return { ok: false, reason: `Dump file does not exist: ${localFile}` };
    }
    if (fs.statSync(localFile).size === 0) {
        return { ok: false, reason: "Dump file is empty (0 bytes)." };
    }
    const bin = resolvePgBinary("pg_restore", env);
    if (!bin) {
        // Can't verify without pg_restore; treat as inconclusive-but-fail so
        // pruning doesn't proceed on an unverified dump.
        return { ok: false, reason: "Could not find 'pg_restore' to verify the dump." };
    }
    try {
        await execa(bin, buildPgRestoreListArgs(localFile), {
            stdio: "pipe",
            env: { ...(env as Record<string, string>) }
        });
        return { ok: true };
    } catch (err) {
        return { ok: false, reason: `pg_restore --list failed: ${err instanceof Error ? err.message : String(err)}` };
    }
}

/**
 * Replay a `pg_dumpall --globals-only` script to recreate cluster roles
 * before a restore, so the dump's GRANT/RLS statements (which reference
 * `rebase_user` and any owner roles) actually apply. Runs statement by
 * statement and tolerates per-statement failures — on a same-cluster restore
 * the roles usually already exist (`CREATE ROLE` → "already exists"), and on
 * a managed provider an `ALTER ROLE <superuser>` may be refused; neither
 * should abort role recreation. Returns how many statements applied vs were
 * skipped.
 */
export async function applyGlobals(
    connectionString: string,
    globalsSql: string,
    log: (message: string) => void = () => {}
): Promise<{ applied: number; skipped: number }> {
    const { Client } = await import("pg");
    const client = new Client({ connectionString });
    await client.connect();
    try {
        return await applyGlobalsWith(
            async (sql) => { await client.query(sql); },
            globalsSql,
            log
        );
    } finally {
        await client.end();
    }
}

/**
 * Restore a custom-format dump into the database named by
 * `connectionString`. Destructive when `clean` is set (drops objects
 * first). Never called automatically — the CLI gates it behind explicit
 * confirmation.
 *
 * Runs with `--exit-on-error` by default: a restore that logs-and-continues
 * past a failed GRANT (because a role was missing) reports success with RLS
 * un-enforced. Callers should recreate roles first (see {@link applyGlobals})
 * and only set `exitOnError: false` deliberately.
 */
export async function restoreDump(opts: {
    connectionString: string;
    inputFile: string;
    clean?: boolean;
    noOwner?: boolean;
    exitOnError?: boolean;
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
        noOwner: opts.noOwner,
        exitOnError: opts.exitOnError
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
                const stats = fs.statSync(full);
                const createdAt = parseBackupTimestamp(f) ?? stats.mtime;
                return { key: full, createdAt, sizeBytes: stats.size };
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

    // Delete each dump together with its `.globals.sql` sidecar (pruneWith
    // handles the pairing + best-effort sidecar). The deleter rejects on a
    // missing key so pruneWith can swallow an absent sidecar.
    const deleteObject =
        dest.kind === "local"
            ? async (key: string) => {
                if (!fs.existsSync(key)) throw new Error(`not found: ${key}`);
                fs.unlinkSync(key);
            }
            : async (key: string) => {
                if (!storage) throw new BackupToolError("Storage backend required to prune object backups.");
                await storage.deleteObject(key, dest.bucket);
            };

    await pruneWith(toDelete, deleteObject);
    return toDelete;
}
