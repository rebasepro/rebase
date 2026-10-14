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
import { pgToolVariable, resolvePgBinary } from "./pg-binary";
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
    buildPgRestoreScriptArgs,
    buildPsqlScriptArgs,
    cleanRestorePrelude,
    checkToolServerCompatibility,
    type DumpObjects,
    globalsFileForDump,
    joinStorageKey,
    parsePgToolMajor,
    parseBackupTimestamp,
    parseDumpObjects,
    serverVersionNumToMajor,
    VersionCompatibility
} from "./pg-tools";
import { BackupObject, RetentionOptions, selectBackupsToPrune } from "./retention";
import { applyGlobalsWith, discardPartialDumpWith, pruneWith } from "./backup-logic";
import { splitPassword } from "../utils/connection-string";

/**
 * How a libpq tool is invoked for a connection string: the URL its command
 * line carries, and the environment it runs in.
 *
 * The password goes in `PGPASSWORD`, never on the command line, where every
 * process listing could read it and every failure printed it back (execa's
 * error repeats the command). See {@link splitPassword}.
 */
function libpqInvocation(
    connectionString: string,
    env: Record<string, string | undefined>
): { connectionString: string; env: Record<string, string> } {
    const split = splitPassword(connectionString);
    const toolEnv: Record<string, string> = {};
    for (const [key, value] of Object.entries(env)) {
        if (value !== undefined) toolEnv[key] = value;
    }
    if (split.password !== null) toolEnv.PGPASSWORD = split.password;
    return { connectionString: split.connectionString, env: toolEnv };
}

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

export { resolvePgBinary };

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

/** PGlite names itself in `version()`: `PostgreSQL 18.3 (PGlite 0.5.6) on wasm32-…`. */
const SHARED_SESSION_ENGINE = /\(PGlite\b/i;

/**
 * Put back what a client tool left set on a database that is one session
 * every connection shares, and do nothing on any other.
 *
 * The managed development database is PGlite: one session behind a socket
 * server, so what `pg_dump` sets for itself — `search_path` emptied,
 * `row_security` off, `PREPARE dumpEnumType …` — stays set for every client
 * after it, a running `rebase dev` included. One `rebase db backup` there left
 * every API request answering 500 "table does not exist", a restart did not
 * help (the database outlives `rebase dev`), and the next backup failed on
 * `prepared statement "dumpenumtype" already exists`.
 *
 * `RESET ALL` and `DEALLOCATE ALL`, not `DISCARD ALL`: that would also drop
 * the `LISTEN` a running `rebase dev`'s realtime holds on the same session.
 * Best effort: it runs after the tool, whose own outcome is what the caller
 * reports.
 */
export async function resetSharedSession(connectionString: string): Promise<void> {
    const { Client } = await import("pg");
    const client = new Client({ connectionString, connectionTimeoutMillis: 10_000, query_timeout: 15_000 });
    client.on("error", () => undefined);
    try {
        await client.connect();
        const { rows } = await client.query<{ version: string }>("SELECT version() AS version");
        if (!SHARED_SESSION_ENGINE.test(rows[0]?.version ?? "")) return;
        await client.query("RESET ALL");
        await client.query("DEALLOCATE ALL");
    } catch {
        // Nothing to add to the tool's own result; see above.
    } finally {
        await client.end().catch(() => undefined);
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
    createOwnerOnly(localFile);

    const tool = libpqInvocation(opts.connectionString, env);
    const args = buildPgDumpArgs({
        connectionString: tool.connectionString,
        outFile: localFile,
        excludeSchemas: opts.excludeSchemas,
        noOwner: opts.noOwner,
        rowSecurity: opts.rowSecurity
    });

    // `PGOPTIONS` is the only way to set a GUC on a tool that takes no SQL.
    // Built from the same object that added `--enable-row-security`, so the
    // flag cannot travel without the identity that makes it safe.
    const dumpEnv: Record<string, string> = { ...tool.env };
    if (opts.rowSecurity) {
        dumpEnv.PGOPTIONS = [env.PGOPTIONS, buildRowSecurityPgOptions(opts.rowSecurity)]
            .filter(Boolean).join(" ");
    }

    try {
        try {
            await execa(bin, args, {
                stdio: opts.inheritStdio ? "inherit" : "pipe",
                env: dumpEnv
            });
        } finally {
            await resetSharedSession(opts.connectionString);
        }
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
        createOwnerOnly(globalsFile);
        try {
            try {
                await execa(
                    dumpallBin,
                    buildPgDumpallGlobalsArgs({ connectionString: tool.connectionString, outFile: globalsFile }),
                    { stdio: opts.inheritStdio ? "inherit" : "pipe", env: tool.env }
                );
            } finally {
                await resetSharedSession(opts.connectionString);
            }
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
 * Create `file` empty and readable by its owner only, before a tool writes it.
 *
 * A dump holds every row, and the `.globals.sql` sidecar every role's password
 * hash. pg_dump and pg_dumpall create their `--file=` target with the
 * process's umask — 0644 on most machines, readable by every user — and keep
 * the mode of a file that is already there. Created 0600 first, the file is
 * never readable by anyone else, not even while the dump runs; chmod-ing it
 * afterwards would leave it open for as long as that takes. A file that
 * already existed is narrowed too.
 */
function createOwnerOnly(file: string): void {
    fs.closeSync(fs.openSync(file, "w", 0o600));
    fs.chmodSync(file, 0o600);
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
    const tool = libpqInvocation(opts.connectionString, env);
    const args = buildPgRestoreArgs({
        connectionString: tool.connectionString,
        inputFile: opts.inputFile,
        clean: opts.clean,
        noOwner: opts.noOwner,
        exitOnError: opts.exitOnError
    });
    try {
        await execa(bin, args, {
            stdio: opts.inheritStdio ? "inherit" : "pipe",
            env: tool.env
        });
    } finally {
        await resetSharedSession(opts.connectionString);
    }
}

/**
 * A `restore --clean` that stopped, and so was rolled back whole.
 *
 * `tool` is the one that stopped it: `pg_restore`, writing the dump's script,
 * or `psql`, running it. `lockTimeout` when what `psql` stopped on was the
 * wait for a lock — `CLEAN_LOCK_TIMEOUT` in `pg-tools.ts`.
 */
export class CleanRestoreFailed extends Error {
    constructor(
        readonly tool: "pg_restore" | "psql",
        readonly exitCode: number | undefined,
        readonly lockTimeout: boolean
    ) {
        super(`${tool} exited with code ${exitCode ?? "unknown"}`);
        this.name = "CleanRestoreFailed";
    }
}

/**
 * Restore a dump over what the database holds, as one transaction:
 * {@link cleanRestorePrelude} first, then the dump as `pg_restore` writes it
 * for `psql`, and the `COMMIT` only after the last of it.
 *
 * One unit, so it either replaces what the dump holds or changes nothing:
 * `pg_restore --clean` runs each statement on its own, so the drops it starts
 * with had all happened when a later one failed — and its plain `DROP SCHEMA
 * rebase` fails on any table the backup lacks, which left a database with
 * every table dropped and nothing restored. Here a failure anywhere —
 * `pg_restore` cannot read the archive, a statement fails, the connection
 * drops — ends the transaction without a `COMMIT`, and Postgres rolls it back.
 *
 * Throws {@link CleanRestoreFailed} when it did not commit.
 */
export async function restoreDumpReplacing(opts: {
    connectionString: string;
    inputFile: string;
    objects: DumpObjects;
    noOwner?: boolean;
    inheritStdio?: boolean;
    env?: Record<string, string | undefined>;
}): Promise<void> {
    const env = opts.env ?? process.env;
    const restoreBin = resolvePgBinary("pg_restore", env);
    const psqlBin = resolvePgBinary("psql", env);
    if (!restoreBin || !psqlBin) {
        const tool = restoreBin ? "psql" : "pg_restore";
        throw new BackupToolError(
            `Could not find the '${tool}' binary${tool === "psql" ? ", which runs a --clean restore as one transaction" : ""}.`,
            `Install the PostgreSQL client tools or set ${pgToolVariable(tool)}.`
        );
    }
    const tool = libpqInvocation(opts.connectionString, env);

    const script = execa(restoreBin, buildPgRestoreScriptArgs({ inputFile: opts.inputFile, noOwner: opts.noOwner }), {
        stdin: "ignore",
        stdout: "pipe",
        stderr: opts.inheritStdio ? "inherit" : "ignore",
        buffer: false,
        reject: false,
        env: tool.env
    });
    // stdout is the rows of the script's own `SELECT`s (`set_config`,
    // `setval`), which say nothing. stderr is shown as it arrives and kept, to
    // tell a lock timeout from anything else.
    const apply = execa(psqlBin, buildPsqlScriptArgs(tool.connectionString), {
        stdin: "pipe",
        stdout: "ignore",
        stderr: opts.inheritStdio ? ["pipe", "inherit"] : "pipe",
        reject: false,
        env: tool.env
    });

    const sink = apply.stdin;
    const source = script.stdout;
    if (!sink || !source) throw new BackupToolError("Could not connect pg_restore to psql.");
    // psql stops reading at its first error, and the script behind it must not
    // wait on a pipe nobody drains.
    sink.on("error", () => undefined);
    apply.once("exit", () => {
        source.unpipe(sink);
        source.resume();
        script.kill();
    });

    sink.write(["BEGIN", ...cleanRestorePrelude(opts.objects)].map((statement) => `${statement};\n`).join(""));
    source.pipe(sink, { end: false });

    const written = await script;
    const committed = written.exitCode === 0 && sink.writable;
    sink.end(committed ? "COMMIT;\n" : undefined);
    const applied = await apply;
    await resetSharedSession(opts.connectionString);

    if (applied.exitCode !== 0) {
        const stderr = typeof applied.stderr === "string" ? applied.stderr : "";
        throw new CleanRestoreFailed("psql", applied.exitCode, /lock timeout/i.test(stderr));
    }
    if (!committed) throw new CleanRestoreFailed("pg_restore", written.exitCode, false);
}

/**
 * What `restore --clean` drops that the backup does not hold, so it can say
 * so before it runs: what a schema the backup replaces whole holds that it has
 * no copy of — tables, views, sequences, functions, procedures, aggregates,
 * types and domains — and the views and foreign keys elsewhere that reference
 * one of the relations it replaces. As `<kind> <name>`.
 *
 * A function is matched by its name, so an overload the backup lacks beside
 * one it holds is not named. Sequences a column owns go with their table,
 * and what an extension owns with the extension, so neither is named.
 *
 * None for a database that does not exist yet.
 */
export async function findCleanExtras(connectionString: string, objects: DumpObjects): Promise<string[]> {
    const schemas = objects.schemas.filter((schema) => schema !== "public");
    if (schemas.length === 0 && objects.relations.length === 0) return [];
    const { routines, types } = objects;
    const { Client } = await import("pg");
    const client = new Client({ connectionString });
    try {
        await client.connect();
    } catch (err) {
        // 3D000: the database does not exist yet, as `--create-db` finds it.
        if (err instanceof Error && "code" in err && err.code === "3D000") return [];
        throw err;
    }
    try {
        const { rows } = await client.query<{ kind: string; name: string }>(
            `WITH dumped AS (
                 SELECT c.oid
                   FROM pg_class c
                   JOIN pg_namespace n ON n.oid = c.relnamespace
                   JOIN unnest($2::text[], $3::text[]) AS d(schema_name, rel_name)
                     ON d.schema_name = n.nspname AND d.rel_name = c.relname
             )
             SELECT kind, name FROM (
                 SELECT CASE c.relkind WHEN 'v' THEN 'view' WHEN 'm' THEN 'materialized view'
                                       WHEN 'f' THEN 'foreign table' WHEN 'S' THEN 'sequence' ELSE 'table' END AS kind,
                        n.nspname || '.' || c.relname AS name
                   FROM pg_class c
                   JOIN pg_namespace n ON n.oid = c.relnamespace
                  WHERE n.nspname = ANY($1::text[])
                    AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
                    AND c.oid NOT IN (SELECT oid FROM dumped)
                    AND NOT (c.relkind = 'S' AND EXISTS (
                        SELECT 1 FROM pg_depend owner
                         WHERE owner.classid = 'pg_class'::regclass AND owner.objid = c.oid
                           AND owner.deptype IN ('a', 'i')))
                 UNION
                 SELECT CASE p.prokind WHEN 'p' THEN 'procedure' WHEN 'a' THEN 'aggregate' ELSE 'function' END,
                        n.nspname || '.' || p.proname
                   FROM pg_proc p
                   JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = ANY($1::text[])
                    AND (n.nspname, p.proname) NOT IN (SELECT * FROM unnest($4::text[], $5::text[]))
                    AND NOT EXISTS (
                        SELECT 1 FROM pg_depend owner
                         WHERE owner.classid = 'pg_proc'::regclass AND owner.objid = p.oid
                           AND owner.deptype IN ('e', 'i'))
                 UNION
                 SELECT CASE t.typtype WHEN 'd' THEN 'domain' ELSE 'type' END,
                        n.nspname || '.' || t.typname
                   FROM pg_type t
                   JOIN pg_namespace n ON n.oid = t.typnamespace
                  WHERE n.nspname = ANY($1::text[])
                    AND (t.typtype IN ('e', 'd', 'r')
                         OR (t.typtype = 'c' AND EXISTS (
                             SELECT 1 FROM pg_class tc WHERE tc.oid = t.typrelid AND tc.relkind = 'c')))
                    AND (n.nspname, t.typname) NOT IN (SELECT * FROM unnest($6::text[], $7::text[]))
                    AND NOT EXISTS (
                        SELECT 1 FROM pg_depend owner
                         WHERE owner.classid = 'pg_type'::regclass AND owner.objid = t.oid
                           AND owner.deptype = 'e')
                 UNION
                 SELECT 'view', vn.nspname || '.' || v.relname
                   FROM pg_depend dep
                   JOIN pg_rewrite r ON r.oid = dep.objid AND dep.classid = 'pg_rewrite'::regclass
                   JOIN pg_class v ON v.oid = r.ev_class
                   JOIN pg_namespace vn ON vn.oid = v.relnamespace
                  WHERE dep.refobjid IN (SELECT oid FROM dumped)
                    AND v.oid NOT IN (SELECT oid FROM dumped)
                    AND NOT vn.nspname = ANY($1::text[])
                 UNION
                 SELECT 'foreign key', con.conname || ' on ' || cn.nspname || '.' || cr.relname
                   FROM pg_constraint con
                   JOIN pg_class cr ON cr.oid = con.conrelid
                   JOIN pg_namespace cn ON cn.oid = cr.relnamespace
                  WHERE con.contype = 'f'
                    AND con.confrelid IN (SELECT oid FROM dumped)
                    AND con.conrelid NOT IN (SELECT oid FROM dumped)
                    AND NOT cn.nspname = ANY($1::text[])
             ) extra
             ORDER BY name`,
            [
                schemas,
                objects.relations.map((r) => r.schema), objects.relations.map((r) => r.name),
                routines.map((r) => r.schema), routines.map((r) => r.name),
                types.map((t) => t.schema), types.map((t) => t.name)
            ]
        );
        return rows.map((row) => `${row.kind} ${row.name}`);
    } finally {
        await client.end();
    }
}

/** The schemas and tables a dump creates, from `pg_restore --list`. See {@link parseDumpObjects}. */
export async function readDumpObjects(
    inputFile: string,
    env: Record<string, string | undefined> = process.env
): Promise<DumpObjects> {
    const bin = resolvePgBinary("pg_restore", env);
    if (!bin) {
        throw new BackupToolError(
            "Could not find the 'pg_restore' binary.",
            "Install the PostgreSQL client tools or set PG_RESTORE_PATH."
        );
    }
    const toolEnv = Object.fromEntries(
        Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined)
    );
    let listed: string;
    try {
        ({ stdout: listed } = await execa(bin, buildPgRestoreListArgs(inputFile), { stdio: "pipe", env: toolEnv }));
    } catch (err) {
        // execa's message is the command line and pg_restore's stderr, which
        // tells the reader neither what is wrong with the file nor that
        // nothing has happened yet.
        const stderr = err instanceof Error && "stderr" in err && typeof err.stderr === "string" ? err.stderr : "";
        const { message, hint } = describeUnreadableDump(path.basename(inputFile), stderr);
        throw new BackupToolError(message, hint);
    }
    return parseDumpObjects(listed);
}

/**
 * What `db restore` says of a file whose table of contents pg_restore cannot
 * read: before anything is restored, so nothing has changed.
 *
 * `pgRestoreStderr` is what `pg_restore --list` printed. Its first error line
 * is quoted, so the reader sees the tool's own words too.
 */
export function describeUnreadableDump(file: string, pgRestoreStderr: string): { message: string; hint: string } {
    const said = pgRestoreStderr.split("\n")
        .map(line => line.replace(/^pg_restore:\s*(?:error:\s*)?/, "").trim())
        .find(line => line.length > 0);
    const quoted = said ? ` (pg_restore: ${said})` : "";
    const unchanged = "Nothing was restored or changed.";
    const elsewhere = "Restore from another backup (`rebase db backups list` lists them), or copy this one again from where it came from.";

    if (said && /unsupported version \(([\d.]+)\) in file header/.test(said)) {
        return {
            message: `${file} was written by a newer pg_dump than this pg_restore reads${quoted}. ${unchanged}`,
            hint: "Install the PostgreSQL client tools of the version that wrote it, or set PG_RESTORE_PATH to that pg_restore."
        };
    }
    if (said && /does not appear to be a valid archive/.test(said)) {
        return {
            message: `${file} is not a backup pg_restore can read${quoted}. \`rebase db restore\` takes the .dump files \`rebase db backup\` writes. ${unchanged}`,
            hint: elsewhere
        };
    }
    if (said && /end of file|too short/.test(said)) {
        return {
            message: `${file} is truncated: it ends before pg_restore can read what it holds${quoted}. ` +
                "A copy or download that did not finish, or a disk that filled while it was written, leaves a file like this. " +
                unchanged,
            hint: elsewhere
        };
    }
    return {
        message: `${file} cannot be read as a backup${quoted}: it is damaged, or not a pg_dump archive. ${unchanged}`,
        hint: elsewhere
    };
}

/**
 * Which of a dump's schemas and tables the target database already holds,
 * as `schema <name>` / `table <schema>.<name>`: what a restore without
 * `--clean` would stop on. `public` is left out of the schemas — every
 * database has it, and pg_restore does not create it. None for a database
 * that does not exist yet.
 */
export async function findRestoreConflicts(connectionString: string, objects: DumpObjects): Promise<string[]> {
    const schemas = objects.schemas.filter((schema) => schema !== "public");
    if (schemas.length === 0 && objects.tables.length === 0) return [];
    const { Client } = await import("pg");
    const client = new Client({ connectionString });
    try {
        await client.connect();
    } catch (err) {
        // 3D000: the database does not exist yet, as `--create-db` finds it.
        if (err instanceof Error && "code" in err && err.code === "3D000") return [];
        throw err;
    }
    try {
        const existingSchemas = await client.query<{ nspname: string }>(
            "SELECT nspname FROM pg_namespace WHERE nspname = ANY($1::text[]) ORDER BY nspname",
            [schemas]
        );
        const existingTables = await client.query<{ nspname: string; relname: string }>(
            `SELECT n.nspname, c.relname
               FROM pg_class c
               JOIN pg_namespace n ON n.oid = c.relnamespace
               JOIN unnest($1::text[], $2::text[]) AS d(schema_name, table_name)
                 ON d.schema_name = n.nspname AND d.table_name = c.relname
              WHERE c.relkind IN ('r', 'p')
              ORDER BY n.nspname, c.relname`,
            [objects.tables.map((t) => t.schema), objects.tables.map((t) => t.table)]
        );
        return [
            ...existingSchemas.rows.map((row) => `schema ${row.nspname}`),
            ...existingTables.rows.map((row) => `table ${row.nspname}.${row.relname}`)
        ];
    } finally {
        await client.end();
    }
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
    // Backed by the dump on disk, not read into memory: the built-in
    // controllers write it a chunk (S3: a multipart part) at a time. Read with
    // `readFileSync` and copied into a `File`, a dump was held three or four
    // times over in the process running the cron, and one over 2 GiB could
    // not be read at all (`ERR_FS_FILE_TOO_LARGE`), so it never uploaded.
    const file = new File([await fs.openAsBlob(localFile)], fileName, { type: "application/octet-stream" });
    // Not held to the controller's upload limits: `maxFileSize` (50 MB unless
    // set) and `allowedMimeTypes` say what a user may upload, and the CLI and
    // the documented cron build their controller without either. Held to
    // them, every dump over 50 MB failed with PAYLOAD_TOO_LARGE.
    const result = await storage.putObject({
        file,
        key,
        bucket: dest.bucket,
        metadata: { "rebase-backup": "1" }
    }, { uploadLimits: false });
    return { key, storageUrl: result.storageUrl };
}

/** Stats in flight at once while listing a local backup folder. */
const LOCAL_STAT_CONCURRENCY = 32;

/** `fn` over `items`, at most `limit` at a time; results in input order. */
async function mapBounded<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
    const results = new Array<R>(items.length);
    let next = 0;
    const worker = async () => {
        while (next < items.length) {
            const i = next++;
            results[i] = await fn(items[i]);
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
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
        // Asynchronous throughout, a few stats at a time: retention lists the
        // folder after every scheduled backup, inside the server process, and
        // a year of hourly backups is 8,760 dumps stat'ed one by one.
        const stat = await fs.promises.stat(dest.path).catch(() => null);
        if (!stat) return [];
        const dir = stat.isDirectory() ? dest.path : path.dirname(dest.path);
        const dumps = (await fs.promises.readdir(dir)).filter((f) => f.endsWith(".dump"));
        const stats = await mapBounded(dumps, LOCAL_STAT_CONCURRENCY, (f) => fs.promises.stat(path.join(dir, f)));
        return dumps
            .map((f, i) => {
                const createdAt = parseBackupTimestamp(f) ?? stats[i].mtime;
                return { key: path.join(dir, f), createdAt, sizeBytes: stats[i].size };
            })
            .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
    }

    if (!storage) {
        throw new BackupToolError(
            `Listing ${dest.kind} backups requires a configured storage backend.`
        );
    }
    // The server's lister, not a second copy of it: a listing is paged, in
    // ascending key order, and this one read a single page of 1,000 — the
    // OLDEST backups — so `rebase db backups list` stopped showing new ones,
    // and retention ranked a page that held none of the newest. The two copies
    // had already drifted apart once (over the roles sidecar).
    const { listBackupObjects } = await import("@rebasepro/server");
    const listed = await listBackupObjects(dest, storage);
    return listed.map((info) => ({
        key: info.key,
        createdAt: info.createdAt ? new Date(info.createdAt) : undefined
    }));
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
