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
import type { Client } from "pg";

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
    /** The value for a column no unique index covers, or null to always use the unique form. */
    value: string | null;
    /** The unique form is `prefix` + random hex + `suffix`, cut to fit the column. */
    prefix: string;
    suffix: string;
}

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
    { pattern: /^(.*_)?(first_name|last_name|full_name|surname|given_name)(_.*)?$/i, value: "Redacted", prefix: "Redacted-", suffix: "" },
    { pattern: /^(.*_)?(address|street|postcode|zip|zipcode)(_.*)?$/i, value: "Redacted", prefix: "Redacted-", suffix: "" },
    { pattern: /^(.*_)?(ssn|tax_id|national_id|passport)(_.*)?$/i, value: "REDACTED", prefix: "REDACTED-", suffix: "" },
    { pattern: /^(.*_)?(password|password_hash|secret|token|api_key|access_token|refresh_token)(_.*)?$/i, value: "REDACTED", prefix: "REDACTED-", suffix: "" },
    { pattern: /^(.*_)?(ip|ip_address|user_agent)(_.*)?$/i, value: "REDACTED", prefix: "REDACTED-", suffix: "" }
];

export function shouldAnonymize(columnName: string): boolean {
    return ANONYMIZE_PATTERNS.some((rule) => rule.pattern.test(columnName));
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
    const rule = ANONYMIZE_PATTERNS.find((candidate) => candidate.pattern.test(column.column));
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

    return columns.filter((column) => shouldAnonymize(column.column) && textual.has(column.dataType.toLowerCase()));
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

export interface PullPlan {
    /** Where the data comes from. */
    source: string;
    /** Where it lands. Always local. */
    target: string;
    anonymize: boolean;
    /** Schemas to copy. Empty means every non-system schema. */
    schemas: string[];
}

/**
 * `pg_dump` arguments for the source.
 *
 * `--no-owner` and `--no-acl` because the roles on a production server do not
 * exist locally, and without them every `ALTER … OWNER TO` in the dump fails and
 * buries the real output in noise. `--format=custom` so `pg_restore` can be told
 * to continue past errors selectively rather than all-or-nothing.
 */
export function dumpArgs(plan: PullPlan): string[] {
    const args = ["--format=custom", "--no-owner", "--no-acl", "--no-privileges"];
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
 * `--clean --if-exists` because a pull replaces what is there: restoring into a
 * database that already has the tables would otherwise fail on every one of
 * them. `--no-owner` for the same reason as the dump.
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

/** The fields of a finished `pg_restore` run that decide {@link restoreOutcome}. */
export interface RestoreRun {
    exitCode?: number;
    signal?: string;
    /** A spawn failure's code — `ENOENT` when the binary vanished. */
    code?: string;
    stderr?: string;
}

/**
 * What a finished `pg_restore` says about the copy.
 *
 * `--clean` empties the target before anything is written, so every way this
 * can end short of exit 0 leaves a partial or empty local database, and none of
 * them may be reported as a copy. A non-zero exit is pg_restore saying it
 * skipped statements — "errors ignored on restore: N" — and whatever those
 * statements created (a table, its rows, an RLS policy) is missing locally.
 *
 * `started` says whether anything can have arrived, which is what decides
 * whether an anonymization pass still has data to redact.
 */
export function restoreOutcome(run: RestoreRun): { started: boolean; failure: string | null } {
    if (run.signal) {
        return { started: true, failure: `pg_restore was stopped by ${run.signal} before it finished.` };
    }
    if (run.exitCode === undefined) {
        return { started: false, failure: `pg_restore could not be started (${run.code ?? "unknown error"}).` };
    }
    if (run.exitCode === 0) return { started: true, failure: null };

    const ignored = /errors ignored on restore: (\d+)/.exec(run.stderr ?? "");

    return {
        started: true,
        failure: ignored
            ? `pg_restore could not restore ${ignored[1]} object(s) — the errors are above.`
            : `pg_restore exited with code ${run.exitCode}.`
    };
}
