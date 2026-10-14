/**
 * `rebase db pull` — copy a database's contents into local development.
 *
 * The common case is production into local, and the reason it exists is that
 * the alternative is worse: without it people hand-roll a `pg_dump | psql` and
 * get the flags wrong in ways that either fail loudly at 2am or, more often,
 * quietly restore half a schema.
 *
 * Three things this command insists on, because copying a production database
 * onto a laptop is a data-protection event whether or not anyone calls it one:
 *
 * 1. **It says what it is about to do, in full, before doing it** — which
 *    database it will read, which one it will overwrite, and where the data will
 *    come to rest on disk. The target path matters: people forget that
 *    `.rebase/pgdata` is a directory their backup software may be indexing.
 *
 * 2. **It refuses to run unattended without being told to.** The target is
 *    destroyed, so a mistyped `--from` with no confirmation would take the
 *    developer's working database with it.
 *
 * 3. **It will not write to a remote database.** The target is always the local
 *    development database; there is no flag that makes this push. A tool that
 *    can copy in both directions eventually copies in the wrong one.
 *
 * Anonymization is opt-in (`--anonymize`), which is a deliberate choice and not
 * an obviously safe one — the flag nobody types is the flag nobody gets. It is
 * a best-effort pass over columns whose *names* look like personal data, and
 * {@link ANONYMIZE_PATTERNS} says exactly which. It cannot find personal data in
 * a column called `notes`, and this file says so rather than implying a
 * guarantee it cannot keep.
 *
 * What it does guarantee is that it never half-happens: {@link anonymizeCopy}
 * runs the pass in one transaction, and when the pass fails it empties the
 * tables it would have rewritten rather than leave their real values behind.
 */

import { execa } from "execa";
import fs from "fs";
import type { Client } from "pg";

import { banner, connectionErrorText, hostOf } from "./connection-banner";
import { PGLITE_EXTENSIONS } from "./constraints";

/**
 * How one kind of personal-looking column is overwritten.
 *
 * Two forms, because a constant is the most readable replacement and is wrong
 * for exactly one kind of column: a unique one. Every `token_hash` becoming
 * `'REDACTED'` is what `UNIQUE(token_hash)` refused on the second row of
 * `rebase.refresh_tokens` — so on any project where someone had signed in twice.
 */
export interface AnonymizeRule {
    pattern: RegExp;
    /**
     * Only on tables whose name matches, when set. For a column name that is
     * personal on one table and not on another: a user's `name` is a person's,
     * a tag's is not.
     */
    tables?: RegExp;
    /** The value for a column no unique index covers, or null to always use the unique form. */
    value: string | null;
    /** The unique form is `prefix` + random hex + `suffix`, cut to fit the column. */
    prefix: string;
    suffix: string;
}

/**
 * Tables whose rows are people, by name: `rebase.users` and the usual spellings
 * of a project's own. Singular or plural.
 */
const PERSON_TABLES = /^(users?|user_profiles?|profiles?|people|persons?|members?|customers?|contacts?|employees?)$/i;

/**
 * Column-name patterns the anonymizer overwrites.
 *
 * Names, not contents: inspecting values would be slower, and would still miss
 * the same things. This is a reasonable-effort measure for making a local copy
 * less dangerous, and it is not a compliance control.
 */
export const ANONYMIZE_PATTERNS: readonly AnonymizeRule[] = [
    // Emails are unique in practice even where nothing enforces it, so they
    // always get a value of their own.
    { pattern: /^(.*_)?e?mail(_.*)?$/i, value: null, prefix: "user-", suffix: "@example.invalid" },
    { pattern: /^(.*_)?(phone|mobile|tel|telephone)(_.*)?$/i, value: "+10000000000", prefix: "+1-", suffix: "" },
    // `display_name` is how `rebase.users` holds every user's name.
    {
        pattern: /^(.*_)?(display_name|first_name|last_name|full_name|middle_name|family_name|surname|given_name)(_.*)?$/i,
        value: "Redacted",
        prefix: "Redacted-",
        suffix: ""
    },
    // A bare `name` is a person's only on a table of people.
    { pattern: /^name$/i, tables: PERSON_TABLES, value: "Redacted", prefix: "Redacted-", suffix: "" },
    { pattern: /^(.*_)?(address|street|postcode|zip|zipcode)(_.*)?$/i, value: "Redacted", prefix: "Redacted-", suffix: "" },
    { pattern: /^(.*_)?(ssn|tax_id|national_id|passport)(_.*)?$/i, value: "REDACTED", prefix: "REDACTED-", suffix: "" },
    { pattern: /^(.*_)?(password|password_hash|secret|token|api_key|access_token|refresh_token)(_.*)?$/i, value: "REDACTED", prefix: "REDACTED-", suffix: "" },
    { pattern: /^(.*_)?(ip|ip_address|user_agent)(_.*)?$/i, value: "REDACTED", prefix: "REDACTED-", suffix: "" }
];

/** The rule that overwrites this column, if any. Without a table, a table-bound rule never applies. */
function ruleFor(columnName: string, table?: string): AnonymizeRule | undefined {
    return ANONYMIZE_PATTERNS.find((rule) =>
        rule.pattern.test(columnName) && (!rule.tables || (table !== undefined && rule.tables.test(table))));
}

export function shouldAnonymize(columnName: string, table?: string): boolean {
    return ruleFor(columnName, table) !== undefined;
}

/** A text-ish column the anonymizer can overwrite without a type error. */
export interface ColumnRef {
    schema: string;
    table: string;
    column: string;
    dataType: string;
    /** `character_maximum_length`: null or absent for an unbounded type. */
    maxLength?: number | null;
    /** Covered by a unique index — a primary key, a UNIQUE constraint, or a unique expression index. */
    unique?: boolean;
}

/** Random hex of this length, per row. `gen_random_uuid()` is core since PostgreSQL 13. */
function randomHex(length: number): string {
    return `left(replace(gen_random_uuid()::text, '-', ''), ${length})`;
}

function sqlLiteral(value: string): string {
    return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Fewest random hex digits a unique replacement keeps. Twelve is 16^12 values:
 * a collision needs millions of rows, where eight would need tens of thousands.
 */
const MIN_UNIQUE_HEX = 12;

/**
 * The SQL expression that overwrites one column, or null when no rule names it.
 *
 * Unique per row when an index makes the column unique, and always cut to the
 * column's declared length — `zip char(5)` refused `'Redacted'` outright, and a
 * failed statement now empties the tables rather than skip one. To fit a short
 * unique column the prefix goes first, then the suffix, and the random part is
 * kept to at least {@link MIN_UNIQUE_HEX} digits while there is room for them.
 * A NULL stays NULL: an empty optional field is not personal data.
 */
export function replacementFor(column: ColumnRef): string | null {
    const rule = ruleFor(column.column, column.table);
    if (!rule) return null;
    const limit = typeof column.maxLength === "number" && column.maxLength > 0 ? column.maxLength : null;

    let value: string;
    if (rule.value !== null && !column.unique) {
        value = sqlLiteral(limit === null ? rule.value : rule.value.slice(0, limit));
    } else {
        const shapes = [[rule.prefix, rule.suffix], ["", rule.suffix], ["", ""]];
        const fitting = shapes.find(([prefix, suffix]) =>
            limit === null || limit - prefix.length - suffix.length >= MIN_UNIQUE_HEX);
        const [prefix, suffix] = fitting ?? ["", ""];
        const hex = Math.min(32, limit === null ? 32 : limit - prefix.length - suffix.length);
        value = `concat(${sqlLiteral(prefix)}, ${randomHex(Math.max(1, hex))}, ${sqlLiteral(suffix)})`;
    }

    const name = quoteIdentifier(column.column);
    return `CASE WHEN ${name} IS NULL THEN NULL ELSE ${value} END`;
}

/** A double-quoted identifier, with any `"` in it doubled — a table called `order` or `a"b` still works. */
export function quoteIdentifier(name: string): string {
    return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Anonymizable columns: name looks personal, and the type can hold the
 * replacement.
 *
 * The type check is what stops this generating `UPDATE … SET user_id =
 * 'Redacted'` for an integer column called `user_id_email_seq` and failing the
 * whole pass on a technicality.
 */
export function anonymizableColumns(columns: readonly ColumnRef[]): ColumnRef[] {
    const textual = new Set(["text", "character varying", "varchar", "character", "char", "citext"]);

    return columns.filter((column) =>
        shouldAnonymize(column.column, column.table) && textual.has(column.dataType.toLowerCase()));
}

/** `"schema"."table"` for each table the pass rewrites, sorted. */
export function anonymizedTables(columns: readonly ColumnRef[]): string[] {
    return [...new Set(anonymizableColumns(columns).map((column) =>
        `${quoteIdentifier(column.schema)}.${quoteIdentifier(column.table)}`))].sort();
}

/** `UPDATE` statements for one anonymization pass, in a stable order. */
export function anonymizeStatements(columns: readonly ColumnRef[]): string[] {
    const byTable = new Map<string, ColumnRef[]>();
    for (const column of anonymizableColumns(columns)) {
        const key = `${quoteIdentifier(column.schema)}.${quoteIdentifier(column.table)}`;
        byTable.set(key, [...(byTable.get(key) ?? []), column]);
    }

    return [...byTable.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([table, cols]) => {
            const assignments = [...cols]
                .sort((a, b) => a.column.localeCompare(b.column))
                .map((column) => `${quoteIdentifier(column.column)} = ${replacementFor(column)}`)
                .join(", ");

            return `UPDATE ${table} SET ${assignments};`;
        });
}

/**
 * Every column the pass could overwrite, with what decides how.
 *
 * Base tables only — a view has an `email` column too, and is not something to
 * UPDATE. Generated columns are skipped for the same reason: `email_domain
 * GENERATED ALWAYS AS (…)` matches by name and refuses any value but DEFAULT,
 * and it follows the column it is generated from anyway. An extension type such
 * as `citext` reports `USER-DEFINED`, so its own name is what is compared.
 *
 * `unique` comes from the indexes, through `pg_depend` as well as `indkey`: a
 * unique index on `lower(email)` names no column in `indkey`, and is exactly
 * what a constant replacement would violate.
 */
export const ANONYMIZE_COLUMNS_SQL = `
WITH unique_columns AS (
    SELECT DISTINCT i.indrelid AS relid, a.attname AS column_name
      FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum > 0 AND NOT a.attisdropped
     WHERE i.indisunique
       AND (a.attnum = ANY (i.indkey)
            OR EXISTS (SELECT 1 FROM pg_depend d
                        WHERE d.classid = 'pg_class'::regclass AND d.objid = i.indexrelid
                          AND d.refclassid = 'pg_class'::regclass AND d.refobjid = i.indrelid
                          AND d.refobjsubid = a.attnum))
)
SELECT c.table_schema AS "schema",
       c.table_name AS "table",
       c.column_name AS "column",
       CASE WHEN c.data_type = 'USER-DEFINED' THEN c.udt_name ELSE c.data_type END AS "dataType",
       c.character_maximum_length AS "maxLength",
       (u.column_name IS NOT NULL) AS "unique"
  FROM information_schema.columns c
  JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
  LEFT JOIN unique_columns u
         ON u.relid = format('%I.%I', c.table_schema, c.table_name)::regclass AND u.column_name = c.column_name
 WHERE t.table_type = 'BASE TABLE'
   AND c.is_generated = 'NEVER'
   AND c.table_schema NOT IN ('pg_catalog', 'information_schema')`;

/** How {@link anonymizeCopy} ended. */
export type AnonymizeOutcome =
    | { ok: true; tables: string[] }
    | {
        ok: false;
        /** Why the pass failed. Nothing it wrote was kept. */
        error: string;
        /** The tables emptied instead, so none of their real values are left. */
        emptied: string[];
        /** Why they could not be emptied, when they could not: the copy then holds real data. */
        emptyError: string | null;
    };

function errorText(error: unknown): string {
    return error instanceof Error && error.message ? error.message : String(error);
}

/**
 * Overwrite the personal-looking columns of a restored copy, all or nothing.
 *
 * One transaction, so a failure part-way leaves no table half done — the old
 * pass ran its UPDATEs one by one, so a failure on `rebase.refresh_tokens` left
 * `public.authors` anonymized and `rebase.users` holding every real email.
 *
 * A rollback alone would be worse than that, though: it puts back the real
 * value of every column, in a copy the developer asked to be anonymized. So on
 * failure the tables the pass would have rewritten are emptied (`TRUNCATE …
 * CASCADE`, which takes the rows that reference them too), and the outcome
 * says which — or, if even that failed, says the copy holds real data, so the
 * caller can say it louder.
 *
 * `row_security = off` makes a role that RLS would filter fail the pass instead
 * of rewriting only the rows its policies show it, which looked like success.
 */
export async function anonymizeCopy(client: Client): Promise<AnonymizeOutcome> {
    let listed = false;
    let tables: string[] = [];
    try {
        const { rows } = await client.query<ColumnRef>(ANONYMIZE_COLUMNS_SQL);
        tables = anonymizedTables(rows);
        listed = true;
        await client.query("BEGIN");
        await client.query("SET LOCAL row_security = off");
        for (const statement of anonymizeStatements(rows)) await client.query(statement);
        await client.query("COMMIT");

        return { ok: true, tables };
    } catch (error) {
        const reason = errorText(error);
        await client.query("ROLLBACK").catch(() => undefined);
        if (!listed) {
            return { ok: false, error: reason, emptied: [], emptyError: "the tables to empty could not be listed" };
        }
        if (tables.length === 0) return { ok: false, error: reason, emptied: [], emptyError: null };
        try {
            await client.query(`TRUNCATE TABLE ${tables.join(", ")} CASCADE`);

            return { ok: false, error: reason, emptied: tables, emptyError: null };
        } catch (emptyError) {
            return { ok: false, error: reason, emptied: [], emptyError: errorText(emptyError) };
        }
    }
}

/**
 * Schemas the restored copy needs the app role provisioned on.
 *
 * `pg_dump --no-privileges` strips every GRANT, so a pulled database arrives
 * with its RLS policies and its `FORCE ROW LEVEL SECURITY` intact and no
 * privileges behind them. Measured on a 30-table project: 68 policies restored,
 * 14 tables with RLS on, and **0** grants to `rebase_user` — where the source
 * had 60. Reading one table as the role Rebase serves every request through:
 *
 *     source:  6
 *     copy:    ERROR: permission denied for table leads
 *
 * The dump flags are right and stay: without `--no-owner`/`--no-privileges`
 * every `ALTER … OWNER TO` and `GRANT … TO <prod role>` in the dump fails
 * against roles that do not exist on a laptop, and buries the real output. The
 * repair belongs after the restore, and belongs to `ensureAppRole` — the same
 * routine boot and `rebase db push` call — rather than to a second list of
 * grants written here.
 *
 * Which schemas: every non-system schema the restored database actually has.
 * Boot knows its `managedSchemas` from the collections; a restore knows only
 * what arrived, and a source may carry schemas this project does not declare.
 * `pg_catalog`, `information_schema` and the `pg_*` internals are never ours to
 * grant on and PostgreSQL would refuse anyway.
 */
export function provisionableSchemas(rows: readonly { schema: string }[]): string[] {
    const skip = (name: string) => name === "information_schema" || name.startsWith("pg_");

    return [...new Set(rows.map((row) => row.schema))].filter((name) => !skip(name)).sort();
}

/** Host and database of a connection string, with no credentials in it. */
export function describeTarget(connectionString: string): string {
    try {
        const url = new URL(connectionString);
        const database = url.pathname.replace(/^\//, "") || "(default)";

        return `${url.hostname}${url.port ? `:${url.port}` : ""}/${database}`;
    } catch {
        // Never echo the raw string: it carries a password, and this line is
        // printed to a terminal people paste into issues.
        return "(unparseable connection string)";
    }
}

/**
 * What the local database runs on.
 *
 * `pglite` is the managed development database: one PGlite session behind a
 * socket server. Two things a restore relies on are not there. The server runs
 * each protocol message on its own, so the `CopyData` that follows a `COPY …
 * FROM stdin` never reaches the backend waiting for it: the COPY fails on
 * "unexpected EOF", and the session stops answering anyone until the daemon
 * is killed. And every connection shares that one session, so what pg_restore
 * `SET`s for itself stays set for everyone after it disconnects.
 */
export type PullTargetEngine = "postgres" | "pglite";

export interface PullPlan {
    /** Where the data comes from. */
    source: string;
    /** Where it lands. Always local. */
    target: string;
    anonymize: boolean;
    /** Schemas to copy. Empty means every non-system schema. */
    schemas: string[];
    /**
     * What the target runs on, which decides how the dump carries its rows.
     * Absent means `postgres`. {@link dumpSource} reads it off the target.
     */
    targetEngine?: PullTargetEngine;
}

/**
 * Rows per `INSERT` in a dump for the managed database.
 *
 * One per statement restored 100k rows in 8s; a hundred took 0.8s. A hundred
 * 512KB rows, a 100MB statement, still went in.
 */
const ROWS_PER_INSERT = 100;

/**
 * `pg_dump` arguments for the source.
 *
 * `--no-owner` and `--no-acl` because the roles on a production server do not
 * exist locally, and without them every `ALTER … OWNER TO` in the dump fails and
 * buries the real output in noise. `--format=custom` so `pg_restore` can be told
 * to continue past errors selectively rather than all-or-nothing.
 *
 * For the managed database the rows travel as `INSERT`s, which PGlite takes
 * like any other statement, instead of `COPY` data, which it cannot take at
 * all — see {@link PullTargetEngine}. The copy is the same; only how the rows
 * are written in the dump differs.
 */
export function dumpArgs(plan: PullPlan): string[] {
    const args = ["--format=custom", "--no-owner", "--no-acl", "--no-privileges"];
    if (plan.targetEngine === "pglite") args.push(`--rows-per-insert=${ROWS_PER_INSERT}`);
    for (const schema of plan.schemas) args.push("--schema", schema);
    args.push("--dbname", splitPassword(plan.source).connectionString);

    return args;
}

/** The environment `pg_dump` runs with: the source's password, if it has one. */
export function dumpEnv(plan: PullPlan): Record<string, string> {
    return passwordEnv(plan.source);
}

/** The environment `pg_restore` runs with: the target's password, if it has one. */
export function restoreEnv(plan: PullPlan): Record<string, string> {
    return passwordEnv(plan.target);
}

function passwordEnv(connectionString: string): Record<string, string> {
    const { password } = splitPassword(connectionString);
    return password === null ? {} : { PGPASSWORD: password };
}

/**
 * A libpq connection string without its password, and the password.
 *
 * The password goes in `PGPASSWORD`, never on a command line, where every
 * process listing can read it and every failure prints it back (execa's error
 * repeats the command). The same rule `db backup` follows; this mirrors
 * `splitPassword` in `@rebasepro/server-postgres`'s connection-string utils,
 * which is not exported. Covers the user-info password and a `password=`
 * parameter; anything that does not parse as a postgres URL is left alone.
 */
function splitPassword(connectionString: string): { connectionString: string; password: string | null } {
    let url: URL;
    try {
        url = new URL(connectionString);
    } catch {
        return { connectionString, password: null };
    }
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") return { connectionString, password: null };

    const fromUserInfo = url.password ? decodePercent(url.password) : null;
    const fromParameter = url.searchParams.get("password");
    if (fromUserInfo === null && fromParameter === null) return { connectionString, password: null };

    url.password = "";
    if (fromParameter !== null) {
        url.searchParams.delete("password");
        // By hand: URLSearchParams writes a space as `+`, which libpq reads literally.
        url.search = Array.from(url.searchParams.entries())
            .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
            .join("&");
    }
    return { connectionString: url.toString(), password: fromUserInfo ?? fromParameter };
}

function decodePercent(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

/**
 * `pg_restore` arguments for the target.
 *
 * It restores into schemas {@link restoreCopy} has already emptied, so
 * `--clean --if-exists` drops nothing that is there; it stays for whatever a
 * dump holds outside them — an extension, say — which would otherwise fail as
 * already existing. `--no-owner` for the same reason as the dump.
 */
export function restoreArgs(plan: PullPlan, dumpFile: string): string[] {
    return ["--clean", "--if-exists", "--no-owner", "--no-privileges", "--dbname", splitPassword(plan.target).connectionString, dumpFile];
}

/**
 * Is this PostgreSQL client tool on PATH, and what version? Both are checked
 * before anything destructive: discovering `pg_restore` is missing after the
 * dump has been taken — or after `--clean` has emptied the target — is the
 * worst possible ordering.
 */
export async function findPgTool(tool: "pg_dump" | "pg_restore"): Promise<string | null> {
    try {
        const { stdout } = await execa(tool, ["--version"]);

        return stdout.trim();
    } catch {
        return null;
    }
}

/** PGlite names itself in `version()`: `PostgreSQL 18.3 (PGlite 0.5.6) on wasm32-…`. */
function engineOf(version: string): PullTargetEngine {
    return /\bPGlite\b/i.test(version) ? "pglite" : "postgres";
}

const NOTHING_CHANGED = "Nothing was changed: the local database is as it was.";

/** What the target database runs on, or why it could not be asked. */
async function readTargetEngine(target: string): Promise<{ engine: PullTargetEngine } | { error: unknown }> {
    const { Client } = await import("pg");
    const client = new Client({ connectionString: target, connectionTimeoutMillis: 10_000 });
    client.on("error", () => undefined);
    try {
        await client.connect();
        const { rows } = await client.query<{ version: string }>("SELECT version() AS version");

        return { engine: engineOf(rows[0]?.version ?? "") };
    } catch (error) {
        return { error };
    } finally {
        await client.end().catch(() => undefined);
    }
}

/** How {@link dumpSource} ended. */
export type DumpOutcome =
    | {
        ok: true;
        /** The plan the dump was taken for, with its target's engine read: what {@link restoreCopy} takes. */
        plan: PullPlan;
    }
    | {
        ok: false;
        /** What failed and what to do, as plain lines for the caller to print. Nothing was changed. */
        lines: string[];
    };

/**
 * `pg_dump` the source into `dumpFile`, in the form the target can restore.
 *
 * It asks the target what it runs on first — the managed database cannot take
 * `COPY` data, see {@link PullTargetEngine} — which also finds a local
 * database that is not there before anything is read from the source.
 *
 * pg_dump's stderr is kept rather than shown as it arrives, so a failure is
 * reported once, in the reader's terms: an unreachable source, or credentials
 * it refused, get the banner every database command prints for a connection
 * that failed, and anything else is pg_dump's own words with a line saying
 * nothing was changed. A dump that succeeds with warnings still shows them.
 * A dump that fails leaves no file behind.
 */
export async function dumpSource(plan: PullPlan, dumpFile: string): Promise<DumpOutcome> {
    try {
        const outcome = await dumpInto(plan, dumpFile);
        if (!outcome.ok) fs.rmSync(dumpFile, { force: true });

        return outcome;
    } catch (error) {
        fs.rmSync(dumpFile, { force: true });
        throw error;
    }
}

async function dumpInto(plan: PullPlan, dumpFile: string): Promise<DumpOutcome> {
    let targetEngine = plan.targetEngine;
    if (!targetEngine) {
        const read = await readTargetEngine(plan.target);
        if ("error" in read) {
            return {
                ok: false,
                lines: banner(`Cannot connect to PostgreSQL at ${hostOf(plan.target)}`,
                    `The driver said: ${connectionErrorText(read.error)}`, [
                        "That is the local database the pull would replace, and nothing",
                        "was read from the source.",
                        "Start it — `rebase dev` starts the managed one, `rebase dev --docker`",
                        "Postgres in Docker — or check DATABASE_URL in .env, then pull again."
                    ])
            };
        }
        targetEngine = read.engine;
    }

    const planned: PullPlan = { ...plan, targetEngine };
    const run = await execa("pg_dump", [...dumpArgs(planned), "--file", dumpFile], {
        env: dumpEnv(planned),
        stdin: "ignore",
        stdout: "inherit",
        stderr: "pipe",
        reject: false
    });
    if (run.exitCode === 0) {
        if (run.stderr.trim()) process.stderr.write(`${run.stderr.trimEnd()}\n`);

        return { ok: true, plan: planned };
    }

    return { ok: false, lines: describeDumpFailure(plan.source, run) };
}

/**
 * Why `pg_dump` could not read the source, as plain lines for the caller to
 * print. The dump is taken before anything local is touched, so every one of
 * them ends the same way: nothing was changed.
 */
export function describeDumpFailure(source: string, run: RestoreRun): string[] {
    if (run.signal) return [`✗ pg_dump was stopped by ${run.signal} before it finished.`, NOTHING_CHANGED];
    if (run.exitCode === undefined) {
        return [
            `✗ pg_dump could not be started (${run.code ?? "unknown error"}).`,
            NOTHING_CHANGED,
            "Check that the PostgreSQL client tools are installed (`pg_dump --version`)."
        ];
    }

    const stderr = (run.stderr ?? "").trim();
    const host = hostOf(source);
    const error = /pg_dump: error: (.+)/.exec(stderr)?.[1]?.trim() ?? null;
    const said = error ? `pg_dump said: ${error}` : null;

    if (/could not translate host name|could not connect to server|connection to server .* failed: (?:Connection refused|timeout expired|No route to host|Network is unreachable|Operation timed out|Host is down)/i.test(stderr)) {
        return banner(`Cannot connect to PostgreSQL at ${host}`, said, [
            "That is the database --from names, which the pull reads.",
            NOTHING_CHANGED,
            "Check the host and port in --from, and that this machine can reach",
            "that server: a VPN, an allow-list, or an SSH tunnel."
        ]);
    }
    if (/password authentication failed|no pg_hba\.conf entry|role "[^"]+" does not exist/i.test(stderr)) {
        let user = "unknown";
        try {
            user = decodePercent(new URL(source).username) || "unknown";
        } catch { /* named as unknown */ }
        return banner(`Authentication failed for user "${user}" at ${host}`, said, [
            "PostgreSQL rejected the credentials --from carries.",
            NOTHING_CHANGED,
            "Check the user and password in --from."
        ]);
    }
    // The server answered and has no database of that name: a typo in
    // --from, usually, or a database not created yet.
    const missing = /database "([^"]+)" does not exist/i.exec(stderr)?.[1];
    if (missing) {
        return banner(`Database "${missing}" does not exist at ${host}`, said, [
            "That is the database --from names, which the pull reads.",
            NOTHING_CHANGED,
            "Check the database name in --from."
        ]);
    }

    const versions = /server version mismatch/i.test(stderr)
        ? ["pg_dump is older than the server: install client tools at least as new as it (`brew install libpq`)."]
        : [];
    return [
        ...(stderr ? stderr.split("\n") : []),
        `✗ pg_dump could not dump ${describeTarget(source)} (exit code ${run.exitCode}).`,
        NOTHING_CHANGED,
        ...versions
    ];
}

/** The fields of a finished `pg_restore` (or `pg_dump`) run that decide {@link restoreOutcome}. */
export interface RestoreRun {
    exitCode?: number;
    signal?: string;
    /** A spawn failure's code — `ENOENT` when the binary vanished. */
    code?: string;
    stderr?: string;
}

/** What a `pg_restore` run says about the copy. */
export interface RestoreRunOutcome {
    /** Whether anything can have arrived — what decides whether an anonymization pass has data to redact. */
    started: boolean;
    /** Null when the copy is complete. */
    failure: string | null;
    /**
     * What to do about the failure. "Pull again" only where a second pull is
     * what finishes the job: everything else repeats until its cause is fixed.
     */
    advice: string | null;
}

/**
 * What a finished `pg_restore` says about the copy.
 *
 * The target was emptied before anything was written, so every way this can
 * end short of exit 0 leaves a partial or empty local database, and none of
 * them may be reported as a copy. A non-zero exit is pg_restore saying it
 * skipped statements — "errors ignored on restore: N" — and whatever those
 * statements created (a table, its rows, an RLS policy) is missing locally.
 *
 * Restoring into an emptied database, those errors come from what the source
 * holds that this Postgres cannot create — an extension it does not have, a
 * feature of a newer server — and a second pull meets them again. So the
 * advice names that, rather than "pull again", which sent people in a loop.
 * On the managed database an extension cannot be installed at all, so the
 * advice there is Postgres in Docker.
 */
export function restoreOutcome(run: RestoreRun, engine: PullTargetEngine = "postgres"): RestoreRunOutcome {
    if (run.signal) {
        return {
            started: true,
            failure: `pg_restore was stopped by ${run.signal} before it finished.`,
            advice: "It was interrupted, not refused: pull again to finish the copy."
        };
    }
    if (run.exitCode === undefined) {
        return {
            started: false,
            failure: `pg_restore could not be started (${run.code ?? "unknown error"}).`,
            advice: "Check that the PostgreSQL client tools are installed (`pg_restore --version`), then pull again."
        };
    }
    if (run.exitCode === 0) return { started: true, failure: null, advice: null };

    const ignored = /errors ignored on restore: (\d+)/.exec(run.stderr ?? "");
    const repeats = engine === "pglite"
        ? "Pulling again repeats these errors until what they name is fixed — most often an extension the "
            + `source uses that the managed database does not have (it has ${PGLITE_EXTENSIONS.map(extension => extension.name).join(", ")}). `
            + "Pull into Postgres in Docker instead (`rebase db pull --docker`), or pull only the schemas that do "
            + "not need it (--schema)."
        : "Pulling again repeats these errors until what they name is fixed — most often an extension "
            + "the source uses that this Postgres does not have installed. Install it here, or pull only the schemas "
            + "that do not need it (--schema).";

    return {
        started: true,
        failure: ignored
            ? `pg_restore could not restore ${ignored[1]} object(s) — the errors are above.`
            : `pg_restore exited with code ${run.exitCode} — the errors are above.`,
        advice: repeats
    };
}

/** How {@link restoreCopy} ended. */
export interface RestoreOutcome extends RestoreRunOutcome {
    /** Whether the local database was emptied first. False means it is exactly as it was. */
    cleared: boolean;
}

/**
 * The local schemas a pull empties before it restores: every one of the local
 * database's own for a whole-database pull, and those it copies for a
 * `--schema` pull. `pg_catalog`, `information_schema` and the `pg_*` internals
 * never — see {@link provisionableSchemas}.
 */
export function schemasToClear(present: readonly { schema: string }[], planned: readonly string[]): string[] {
    const local = provisionableSchemas(present);

    return planned.length === 0 ? local : local.filter((schema) => planned.includes(schema));
}

/**
 * The statements that empty those schemas, in one transaction.
 *
 * `CASCADE`, which `pg_restore --clean` never uses: a table the source lacks —
 * `rebase.atlas_schema_revisions` from `rebase db migrate`, a collection added
 * locally that references a pulled table — is exactly what blocked its plain
 * `DROP SCHEMA` and `DROP TABLE`. `public` is put back empty, with the access
 * every role has to it by default, because a dump does not create a default
 * `public` and every table in it would otherwise have nowhere to go.
 */
export function clearStatements(schemas: readonly string[]): string[] {
    const statements = schemas.map((schema) => `DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`);
    if (schemas.includes("public")) statements.push("CREATE SCHEMA public", "GRANT USAGE ON SCHEMA public TO PUBLIC");

    return statements;
}

/**
 * How long emptying the local database waits for a lock before giving up.
 *
 * A `rebase dev` serving from the database holds connections, and one inside
 * a transaction would otherwise make the pull hang without a word.
 */
const CLEAR_LOCK_TIMEOUT = "15s";

/** Why emptying the local database failed, in the reader's terms, and what fixes it. */
function clearFailure(error: unknown): RestoreOutcome {
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
    const reason = errorText(error);
    const advice = code === "55P03"
        ? "Something holds a lock on it — usually `rebase dev` serving from it. Stop that, then pull again."
        : code === "42501"
            ? "This connection may not drop those schemas. Connect as the role that owns them — the one "
                + "that created them — and pull with that."
            : "Fix what the error names; pulling again before that repeats it.";

    return {
        cleared: false,
        started: false,
        failure: `Could not empty the local database before restoring: ${reason}`,
        advice
    };
}

/**
 * Replace the local database's contents with a dump: empty the schemas it
 * holds, then `pg_restore` into them.
 *
 * Only ever `plan.target`, the local development database the command
 * resolved — the pull's one destination, which no flag can change. Emptying it
 * is one transaction: if any schema cannot be dropped, none is, nothing is
 * restored, and the database is as it was.
 *
 * On the managed database the dump must be one {@link dumpSource} took for it,
 * with its rows as INSERTs: a COPY would leave the daemon answering nobody, so
 * one is refused before anything is emptied. And afterwards its one session —
 * every connection's — is given back its own settings: pg_restore leaves
 * `search_path` empty and `row_security` off behind it, which a running
 * `rebase dev` would otherwise query under.
 */
export async function restoreCopy(plan: PullPlan, dumpFile: string): Promise<RestoreOutcome> {
    const { Client } = await import("pg");
    const client = new Client({ connectionString: plan.target });
    client.on("error", () => undefined);
    let engine: PullTargetEngine;
    try {
        await client.connect();
        engine = engineOf((await client.query<{ version: string }>("SELECT version() AS version")).rows[0]?.version ?? "");
        if (engine === "pglite" && plan.targetEngine !== "pglite") {
            return {
                cleared: false,
                started: false,
                failure: "The managed development database cannot take this dump: its rows are COPY data, which PGlite's socket server cannot receive.",
                advice: "Pull into Postgres in Docker instead: `rebase db pull --docker`."
            };
        }
        const { rows } = await client.query<{ schema: string }>("SELECT nspname AS \"schema\" FROM pg_namespace");
        await client.query("BEGIN");
        await client.query(`SET LOCAL lock_timeout = '${CLEAR_LOCK_TIMEOUT}'`);
        for (const statement of clearStatements(schemasToClear(rows, plan.schemas))) await client.query(statement);
        await client.query("COMMIT");
    } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        return clearFailure(error);
    } finally {
        await client.end().catch(() => undefined);
    }

    // stderr is shown as it arrives and kept, for the count in its summary
    // line. Not rejected: every way this ends is judged by `restoreOutcome`.
    const run = await execa("pg_restore", restoreArgs(plan, dumpFile), {
        env: restoreEnv(plan),
        stdin: "ignore",
        stdout: "inherit",
        stderr: ["pipe", "inherit"],
        reject: false
    });

    if (engine === "pglite") await resetSharedSession(plan.target);

    return { cleared: true, ...restoreOutcome(run, engine) };
}

/**
 * Put the managed database's one session back to its own settings.
 *
 * `RESET ALL`, not `DISCARD ALL`: the session is every connection's, and
 * `DISCARD` would also drop the `LISTEN` a running `rebase dev`'s realtime
 * holds on it. Best effort: a daemon that cannot take this cannot take the
 * re-grant that follows either, and that step reports it.
 */
async function resetSharedSession(target: string): Promise<void> {
    const { Client } = await import("pg");
    const client = new Client({ connectionString: target, connectionTimeoutMillis: 10_000, query_timeout: 15_000 });
    client.on("error", () => undefined);
    try {
        await client.connect();
        await client.query("RESET ALL");
    } catch {
        // Reported by the next step that connects; see above.
    } finally {
        await client.end().catch(() => undefined);
    }
}

/**
 * The lines that report a failed restore: what failed, what state the local
 * database is in now, and what to do. Plain text, for the caller to colour.
 */
export function describeRestoreFailure(outcome: RestoreOutcome, source: string): string[] {
    const state = outcome.started
        ? `The local database holds an incomplete copy of ${source}.`
        : outcome.cleared
            ? "The local database was emptied, and nothing was restored into it."
            : "Nothing was restored, and the local database is as it was.";

    return [outcome.failure ?? "The restore did not complete.", state, ...(outcome.advice ? [outcome.advice] : [])];
}
