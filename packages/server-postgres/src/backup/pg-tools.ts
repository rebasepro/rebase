/**
 * Pure helpers for the backup/restore commands.
 *
 * Everything in this file is side-effect free so it can be unit-tested
 * without a live Postgres server, matching the constraint that CI must
 * not require a database.
 */

import { forLibpq } from "../utils/connection-string";

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
 * The identity `pg_dump` reads rows as, when row security is left on.
 *
 * Not optional, and that is the whole design. `pg_dump --enable-row-security`
 * on its own is the dangerous command in this file: it turns the "query would
 * be affected by row-level security policy" *error* into a dump that exits 0
 * and is silently missing every row the dumping role's policies exclude. A
 * backup that looks fine and restores most of your data is worse than one that
 * refused to run.
 *
 * So the flag is unreachable without a subject to evaluate the policies
 * against. Rebase's generated policies read `app.uid` and `app.user_roles`;
 * supplying an admin role satisfies the `admin_full_access` rule and the dump
 * sees everything that rule sees.
 */
export interface RowSecurityIdentity {
    /** Written to `app.uid`. Any non-empty value — it is only an audit trail. */
    uid: string;
    /** Written to `app.user_roles`. Must include a role the policies admit. */
    roles: string[];
}

/**
 * `PGOPTIONS` carrying an identity, for a libpq tool that has no other way to
 * set a GUC.
 *
 * A backslash escape rather than quoting, which is what libpq's `-c` parsing
 * takes: a space inside a value ends the option otherwise, so a role list is
 * comma-joined and never spaced.
 */
export function buildRowSecurityPgOptions(identity: RowSecurityIdentity): string {
    const escape = (value: string) => value.replace(/([\\ ])/g, "\\$1");
    return [
        `-c app.uid=${escape(identity.uid)}`,
        `-c app.user_id=${escape(identity.uid)}`,
        `-c app.user_roles=${escape(identity.roles.join(","))}`
    ].join(" ");
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
    /**
     * Dump with row security on, as this identity. Omit — which is the default
     * — and `pg_dump` errors rather than skipping rows it cannot see.
     */
    rowSecurity?: RowSecurityIdentity;
}): string[] {
    const args = ["--format=custom", "--no-password", `--file=${opts.outFile}`];
    if (opts.noOwner) {
        args.push("--no-owner");
    }
    if (opts.rowSecurity) {
        args.push("--enable-row-security");
    }
    for (const schema of opts.excludeSchemas ?? []) {
        args.push(`--exclude-schema=${schema}`);
    }
    args.push(forLibpq(opts.connectionString));
    return args;
}

/**
 * Whether a `pg_dump` failure is the row-security one, and what to do about it.
 *
 * The error text names the table and nothing else, so the first read of it is
 * "why would a backup be affected by RLS at all?" — the answer being that the
 * dumping role is not the tables' owner and has no `BYPASSRLS`, which is the
 * normal state of the `postgres` user on Cloud SQL, RDS and every other managed
 * Postgres. Nothing about that is visible from the message.
 *
 * Returns `null` for any other failure, so the caller reports it unchanged.
 */
export function diagnoseRowSecurityDumpFailure(error: unknown): string | null {
    const text = [
        (error as { stderr?: unknown })?.stderr,
        (error as { message?: unknown })?.message
    ].map(part => (typeof part === "string" ? part : "")).join("\n");

    if (!/row-level security policy/i.test(text)) return null;

    const table = text.match(/for table "([^"]+)"/)?.[1];

    return [
        `pg_dump cannot read ${table ? `"${table}"` : "one of the tables"} because row-level security applies to it.`,
        "",
        "  The dumping role is neither the table's owner nor `BYPASSRLS`, which is the normal",
        "  state of the `postgres` user on Cloud SQL, RDS and other managed Postgres — there is",
        "  no superuser to hand out.",
        "",
        "  Two ways out:",
        "",
        "    • Grant the dumping role BYPASSRLS, or make it the owner, and run this again. The",
        "      dump then contains every row, which is what a backup should mean.",
        "",
        "    • Re-run with --enable-row-security to dump as an admin subject instead. Rebase",
        "      sets `app.uid`/`app.user_roles` so the generated `admin_full_access` policy",
        "      admits the dump. Read the warning it prints: the result contains exactly the",
        "      rows those policies admit, and any table whose policies do not include an",
        "      admin rule comes out short — with no error.",
        "",
        "  Do not reach for a bare `pg_dump --enable-row-security` by hand. Without the",
        "  settings above it succeeds and silently omits rows."
    ].join("\n");
}

/**
 * Assemble the `pg_restore` argument vector for a custom-format dump.
 */
export function buildPgRestoreArgs(opts: {
    connectionString: string;
    inputFile: string;
    /** Drop objects before recreating them (destructive but idempotent). */
    clean?: boolean;
    /**
     * Abort on the first error instead of logging and continuing. Defaults
     * ON: a restore that silently skips failed GRANT/RLS statements (because
     * a role is missing) "succeeds" with RLS un-enforced — a security hole.
     * Fail loudly instead so the operator knows the restore is incomplete.
     */
    exitOnError?: boolean;
    noOwner?: boolean;
}): string[] {
    const args = ["--format=custom", "--no-password", `--dbname=${forLibpq(opts.connectionString)}`];
    if (opts.clean) {
        args.push("--clean", "--if-exists");
    }
    if (opts.noOwner) {
        args.push("--no-owner");
    }
    // Default to --exit-on-error unless explicitly disabled.
    if (opts.exitOnError !== false) {
        args.push("--exit-on-error");
    }
    args.push(opts.inputFile);
    return args;
}

/**
 * Assemble the `pg_restore --list` argument vector. Reading a dump's table
 * of contents parses the whole archive without touching a database, so it is
 * a cheap integrity check that the file isn't truncated or corrupt.
 */
export function buildPgRestoreListArgs(inputFile: string): string[] {
    return ["--list", inputFile];
}

/** The schemas and tables a dump creates, read off its table of contents. */
export interface DumpObjects {
    schemas: string[];
    tables: { schema: string; table: string }[];
    /**
     * Every relation it creates — tables, views, materialized views, foreign
     * tables and sequences — by schema and name: what `restore --clean` can
     * tell apart from what the target holds besides.
     */
    relations: { schema: string; name: string }[];
    /** Every function, procedure and aggregate it creates, by schema and name: an overloaded name once for each. */
    routines: { schema: string; name: string }[];
    /** Every type it creates — enum, composite, range — and every domain, by schema and name. */
    types: { schema: string; name: string }[];
}

/** `<id>; <catalog oid> <oid> <description> <namespace> <tag…> <owner>`, the shape of a TOC entry. */
const TOC_ENTRY = /^\d+;\s+\d+\s+\d+\s+(SCHEMA|TABLE)\s+(?!DATA\s)(\S+)\s+(.+)\s+(\S+)$/;

/** A TOC entry for a relation of any kind. `TABLE DATA`, `SEQUENCE SET` and `SEQUENCE OWNED BY` are not relations. */
const TOC_RELATION = /^\d+;\s+\d+\s+\d+\s+(?:FOREIGN TABLE|MATERIALIZED VIEW|TABLE|VIEW|SEQUENCE)\s+(?!DATA\s|SET\s|OWNED BY\s)(\S+)\s+(.+)\s+(\S+)$/;

/** A function's TOC entry: its tag is the name and the argument types, `two(integer, text)`. */
const TOC_ROUTINE = /^\d+;\s+\d+\s+\d+\s+(?:FUNCTION|PROCEDURE|AGGREGATE)\s+(\S+)\s+(.+?)\(.*\)\s+\S+$/;

/** A type's or a domain's TOC entry. */
const TOC_TYPE = /^\d+;\s+\d+\s+\d+\s+(?:TYPE|DOMAIN)\s+(\S+)\s+(.+)\s+(\S+)$/;

/**
 * The schemas and tables in `pg_restore --list` output: the objects a
 * restore without `--clean` fails on when the target already has them.
 *
 * A TOC line ends in the object's owner, after its namespace and its name;
 * a schema's namespace is `-`. The name is what lies between the two, so a
 * name with a space in it (`Odd Name`) reads whole. `TABLE DATA` and every
 * other kind of entry are not objects of their own here. Its relations,
 * functions and types are read too, for what `restore --clean` would drop
 * that the dump does not hold (`findCleanExtras`).
 */
export function parseDumpObjects(list: string): DumpObjects {
    const objects: DumpObjects = { schemas: [], tables: [], relations: [], routines: [], types: [] };
    for (const line of list.split("\n")) {
        const trimmed = line.trim();
        const relation = TOC_RELATION.exec(trimmed);
        if (relation) objects.relations.push({ schema: relation[1], name: relation[2] });
        const routine = TOC_ROUTINE.exec(trimmed);
        if (routine) objects.routines.push({ schema: routine[1], name: routine[2] });
        const type = TOC_TYPE.exec(trimmed);
        if (type) objects.types.push({ schema: type[1], name: type[2] });
        const entry = TOC_ENTRY.exec(trimmed);
        if (!entry) continue;
        const [, kind, namespace, name] = entry;
        if (kind === "SCHEMA") objects.schemas.push(name);
        else objects.tables.push({ schema: namespace, table: name });
    }
    return objects;
}

/** A Postgres identifier, double-quoted. */
function quoteIdentifier(name: string): string {
    return `"${name.replace(/"/g, "\"\"")}"`;
}

/**
 * How long `restore --clean` waits for a lock before it gives up.
 *
 * A `rebase dev` serving from the database holds connections, and one inside a
 * transaction would otherwise make the restore wait without a word. The dump's
 * own script sets `lock_timeout = 0` after this, for the objects it creates.
 */
export const CLEAN_LOCK_TIMEOUT = "15s";

/**
 * What `restore --clean` runs first, in the transaction the restore runs in:
 * every schema the dump creates, dropped with `CASCADE`, and every table it
 * creates in a schema it does not (`public`), the same.
 *
 * `CASCADE`, which `pg_restore --clean` never uses: a table the backup lacks
 * in one of its schemas — `rebase.atlas_schema_revisions` from `rebase db
 * migrate`, a table a newer runtime added — is exactly what stopped its plain
 * `DROP SCHEMA rebase`, and a table that references one of the backup's is what
 * stops a plain `DROP TABLE`. The dump's script follows, with its own `DROP …
 * IF EXISTS` for everything else it creates.
 */
export function cleanRestorePrelude(objects: DumpObjects): string[] {
    const schemas = objects.schemas.filter((schema) => schema !== "public");
    const dropped = new Set(schemas);
    const tables = objects.tables.filter((table) => !dropped.has(table.schema));
    return [
        "SET client_min_messages = warning",
        `SET lock_timeout = '${CLEAN_LOCK_TIMEOUT}'`,
        ...schemas.map((schema) => `DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`),
        ...tables.map((table) => `DROP TABLE IF EXISTS ${quoteIdentifier(table.schema)}.${quoteIdentifier(table.table)} CASCADE`)
    ];
}

/**
 * `pg_restore` writing the dump as a SQL script on stdout, with the `DROP …
 * IF EXISTS` that `--clean` adds, for `psql` to run. See {@link buildPsqlScriptArgs}.
 */
export function buildPgRestoreScriptArgs(opts: { inputFile: string; noOwner?: boolean }): string[] {
    return [
        "--format=custom",
        "--clean",
        "--if-exists",
        ...(opts.noOwner ? ["--no-owner"] : []),
        "--file=-",
        opts.inputFile
    ];
}

/**
 * `psql` running a script read from stdin, stopping at its first error.
 *
 * `-X`, so no `.psqlrc` changes what runs; `-q`, so it prints errors and
 * warnings, not a command tag per statement. The transaction is the script's
 * own: `restore --clean` writes the `BEGIN`, and the `COMMIT` only once
 * `pg_restore` has written the whole dump.
 */
export function buildPsqlScriptArgs(connectionString: string): string[] {
    return ["-X", "-q", "--no-password", "-v", "ON_ERROR_STOP=1", `--dbname=${forLibpq(connectionString)}`, "--file=-"];
}

/**
 * Assemble the `pg_dumpall --globals-only` argument vector. Roles (and other
 * cluster-wide objects) live outside any single database, so a per-database
 * `pg_dump` omits them. Without the `rebase_user` role the RLS GRANT
 * statements in the main dump fail on restore and RLS is silently lost — so
 * every backup captures the globals into a sidecar `.globals.sql`.
 *
 * `--no-role-passwords` keeps role secrets out of the artifact (backups may
 * be shipped off-box); roles are recreated password-less and re-secured by
 * the operator.
 */
export function buildPgDumpallGlobalsArgs(opts: {
    connectionString: string;
    outFile: string;
}): string[] {
    return [
        "--globals-only",
        "--no-role-passwords",
        "--no-password",
        `--file=${opts.outFile}`,
        `--dbname=${forLibpq(opts.connectionString)}`
    ];
}

/**
 * Derive the globals sidecar path/key for a given `.dump` file. Keeps the
 * two artifacts adjacent so listing, uploading and pruning can find one from
 * the other. A name that doesn't end in `.dump` is returned unchanged with a
 * `.globals.sql` suffix appended.
 */
export function globalsFileForDump(dumpPath: string): string {
    return dumpPath.endsWith(".dump")
        ? dumpPath.slice(0, -".dump".length) + ".globals.sql"
        : dumpPath + ".globals.sql";
}

/**
 * Split a `pg_dumpall --globals-only` script into individual statements.
 * Used when replaying globals on restore so each `CREATE ROLE` / `GRANT`
 * can run independently and a benign "role already exists" on one doesn't
 * abort the rest. Drops `--` comment lines and blank statements.
 */
export function splitGlobalsStatements(sql: string): string[] {
    const withoutComments = sql
        .split("\n")
        // `--` comments, and psql meta-commands. pg_dumpall 15+ wraps its output
        // in `\restrict <token>` / `\unrestrict <token>`, which are instructions
        // to psql, not SQL. This replay sends statements over a connection
        // instead, so they arrived at the server as `\restrict …` and came back
        // as `syntax error at or near "\"` — reported to the user as two skipped
        // globals per restore, which reads like roles failed to apply when
        // nothing did. They carry no state worth replaying: dropping them is
        // exactly what a SQL-level consumer should do.
        .filter((line) => {
            const trimmed = line.trim();
            return !trimmed.startsWith("--") && !trimmed.startsWith("\\");
        })
        .join("\n");
    return withoutComments
        .split(";")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
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
