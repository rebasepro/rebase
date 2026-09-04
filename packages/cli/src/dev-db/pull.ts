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
 */

import { execa } from "execa";

/**
 * Column-name patterns the anonymizer overwrites.
 *
 * Names, not contents: inspecting values would be slower, and would still miss
 * the same things. This is a reasonable-effort measure for making a local copy
 * less dangerous, and it is not a compliance control.
 */
export const ANONYMIZE_PATTERNS: readonly { pattern: RegExp; replacement: string }[] = [
    { pattern: /^(.*_)?e?mail(_.*)?$/i, replacement: "concat('user', id::text, '@example.invalid')" },
    { pattern: /^(.*_)?(phone|mobile|tel|telephone)(_.*)?$/i, replacement: "'+10000000000'" },
    { pattern: /^(.*_)?(first_name|last_name|full_name|surname|given_name)(_.*)?$/i, replacement: "'Redacted'" },
    { pattern: /^(.*_)?(address|street|postcode|zip|zipcode)(_.*)?$/i, replacement: "'Redacted'" },
    { pattern: /^(.*_)?(ssn|tax_id|national_id|passport)(_.*)?$/i, replacement: "'REDACTED'" },
    { pattern: /^(.*_)?(password|password_hash|secret|token|api_key|access_token|refresh_token)(_.*)?$/i, replacement: "'REDACTED'" },
    { pattern: /^(.*_)?(ip|ip_address|user_agent)(_.*)?$/i, replacement: "'REDACTED'" }
];

export function shouldAnonymize(columnName: string): boolean {
    return ANONYMIZE_PATTERNS.some((rule) => rule.pattern.test(columnName));
}

export function replacementFor(columnName: string): string | null {
    return ANONYMIZE_PATTERNS.find((rule) => rule.pattern.test(columnName))?.replacement ?? null;
}

/** A text-ish column the anonymizer can overwrite without a type error. */
export interface ColumnRef {
    schema: string;
    table: string;
    column: string;
    dataType: string;
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

/** `UPDATE` statements for one anonymization pass, in a stable order. */
export function anonymizeStatements(columns: readonly ColumnRef[]): string[] {
    const byTable = new Map<string, ColumnRef[]>();
    for (const column of anonymizableColumns(columns)) {
        const key = `${column.schema}.${column.table}`;
        byTable.set(key, [...(byTable.get(key) ?? []), column]);
    }

    return [...byTable.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([table, cols]) => {
            const assignments = [...cols]
                .sort((a, b) => a.column.localeCompare(b.column))
                .map((column) => `"${column.column}" = ${replacementFor(column.column)}`)
                .join(", ");

            return `UPDATE ${table.split(".").map((part) => `"${part}"`).join(".")} SET ${assignments};`;
        });
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
    args.push("--dbname", plan.source);

    return args;
}

/**
 * `pg_restore` arguments for the target.
 *
 * `--clean --if-exists` because a pull replaces what is there: restoring into a
 * database that already has the tables would otherwise fail on every one of
 * them. `--no-owner` for the same reason as the dump.
 */
export function restoreArgs(plan: PullPlan, dumpFile: string): string[] {
    return ["--clean", "--if-exists", "--no-owner", "--no-privileges", "--dbname", plan.target, dumpFile];
}

/** Is `pg_dump` on PATH, and what version? Checked before anything destructive. */
export async function findPgDump(): Promise<string | null> {
    try {
        const { stdout } = await execa("pg_dump", ["--version"]);

        return stdout.trim();
    } catch {
        return null;
    }
}
