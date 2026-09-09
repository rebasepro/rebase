/**
 * Which columns an Atlas plan cannot touch, because a generated column reads
 * them.
 *
 * PostgreSQL refuses `ALTER COLUMN … TYPE` and `DROP COLUMN` on any column a
 * `GENERATED ALWAYS AS … STORED` expression depends on:
 *
 *     cannot alter type of a column used by a generated column
 *
 * Atlas cannot see that coming. A search block's `tsvector` is *deliberately*
 * hidden from it (`searchExcludePatterns`) — Rebase owns that column, and an
 * Atlas that could see it would plan a `DROP COLUMN` for it on every push,
 * since the desired state it is given never mentions one. So Atlas plans an
 * alter against a column whose dependant is invisible to it, PostgreSQL
 * refuses, and because `schema apply` runs its plan in a single transaction
 * **every unrelated statement rolls back with it**. One `varchar(255)` → `text`
 * widening on a searched column is enough to make `rebase db push` a no-op
 * forever, with an error that names neither the generated column nor the reason.
 *
 * The fix is the same one the search column's own stamp guard already
 * prescribes when a `search` block changes: drop the generated column, let the
 * apply through, and rebuild it from `search.sql` afterwards. It is cheap to
 * rebuild (one table rewrite, which the `ALTER … TYPE` was going to cost
 * anyway) and there is no other order that works — the expression cannot be
 * altered in place at all.
 *
 * Everything here is side-effect free: the plan is text and the dependencies
 * are rows someone else read. Unit-tested in
 * `generated-column-conflicts.test.ts`.
 */
import { splitSqlStatements } from "./destructive-sql";

/** An operation on a column that PostgreSQL refuses while a dependant exists. */
export type ColumnMutationKind = "type" | "drop";

export interface ColumnMutation {
    /** Absent when the plan did not qualify the table; matched loosely then. */
    schema?: string;
    table: string;
    column: string;
    kind: ColumnMutationKind;
}

/** One `generated column → column it reads` edge, as read from the catalogue. */
export interface GeneratedColumnDependency {
    schema: string;
    table: string;
    /** The generated column. */
    column: string;
    /** A column its expression reads. */
    dependsOn: string;
}

/** A generated column standing in the way of the plan, and why. */
export interface GeneratedColumnConflict {
    schema: string;
    table: string;
    /** The generated column that has to go before the apply. */
    column: string;
    /** The mutated columns it reads, deduplicated and sorted. */
    blocking: { column: string; kind: ColumnMutationKind }[];
}

/** `"public"."posts"` / `public.posts` / `posts` → its parts. */
const IDENT = String.raw`(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)`;
const TABLE_RE = new RegExp(String.raw`^ALTER\s+TABLE\s+(?:ONLY\s+)?(${IDENT})(?:\.(${IDENT}))?`, "i");
const ALTER_COLUMN_RE = new RegExp(
    String.raw`\bALTER\s+(?:COLUMN\s+)?(${IDENT})\s+(?:SET\s+DATA\s+)?TYPE\b`, "gi"
);
const DROP_COLUMN_RE = new RegExp(
    String.raw`\bDROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?(${IDENT})`, "gi"
);

const unquote = (ident: string): string =>
    ident.startsWith("\"") ? ident.slice(1, -1) : ident;

/**
 * Strip Atlas's plan rendering from a statement.
 *
 * What `schema apply --dry-run` prints is not a SQL file: each statement is
 * indented under a `-- modify "posts" table` heading and prefixed with `-> `,
 * with an `-- ok (12µs)` line after it. `splitSqlStatements` drops the comment
 * lines, and this drops the arrow — without it an anchored `^ALTER TABLE`
 * matches nothing at all, which is a silent no-op rather than an error.
 */
const stripPlanMarker = (statement: string): string =>
    statement.replace(/^\s*->\s*/, "").trim();

/**
 * Every column an Atlas plan retypes or drops, with the table it belongs to.
 *
 * One statement carries many clauses — Atlas emits `ALTER TABLE "public"."posts"
 * ALTER COLUMN "title" TYPE text, ALTER COLUMN "slug" TYPE text, …` — so the
 * table is read once per statement and the clauses are scanned within it.
 */
export function parseColumnMutations(planSql: string): ColumnMutation[] {
    const mutations: ColumnMutation[] = [];

    for (const raw of splitSqlStatements(planSql)) {
        const statement = stripPlanMarker(raw);
        const table = TABLE_RE.exec(statement);
        if (!table) continue;
        // With both groups present the first is the schema; with one, the
        // statement named a bare table and the schema is whatever search_path
        // resolves to — which we cannot know here, so it stays undefined and
        // `findGeneratedColumnConflicts` matches on the table name alone.
        const [schema, name] = table[2]
            ? [unquote(table[1]), unquote(table[2])]
            : [undefined, unquote(table[1])];

        const collect = (re: RegExp, kind: ColumnMutationKind) => {
            re.lastIndex = 0;
            let match: RegExpExecArray | null;
            while ((match = re.exec(statement)) !== null) {
                mutations.push({ schema, table: name, column: unquote(match[1]), kind });
            }
        };
        collect(ALTER_COLUMN_RE, "type");
        collect(DROP_COLUMN_RE, "drop");
    }

    return mutations;
}

/**
 * The generated columns that block a plan: those reading a column it retypes
 * or drops.
 *
 * A mutation with no schema matches on table name alone. That is deliberately
 * loose — a bare `ALTER TABLE posts` resolves through `search_path` at
 * execution time, and guessing wrong in the *permissive* direction costs a
 * generated column that is rebuilt seconds later, while guessing wrong in the
 * strict direction costs the whole push.
 */
export function findGeneratedColumnConflicts(
    mutations: ColumnMutation[],
    dependencies: GeneratedColumnDependency[]
): GeneratedColumnConflict[] {
    const conflicts = new Map<string, GeneratedColumnConflict>();

    for (const dependency of dependencies) {
        for (const mutation of mutations) {
            if (mutation.table !== dependency.table) continue;
            if (mutation.schema !== undefined && mutation.schema !== dependency.schema) continue;
            if (mutation.column !== dependency.dependsOn) continue;

            const key = `${dependency.schema}.${dependency.table}.${dependency.column}`;
            const conflict = conflicts.get(key) ?? {
                schema: dependency.schema,
                table: dependency.table,
                column: dependency.column,
                blocking: []
            };
            if (!conflict.blocking.some(b => b.column === mutation.column && b.kind === mutation.kind)) {
                conflict.blocking.push({ column: mutation.column, kind: mutation.kind });
            }
            conflicts.set(key, conflict);
        }
    }

    const ordered = [...conflicts.values()];
    for (const conflict of ordered) conflict.blocking.sort((a, b) => a.column.localeCompare(b.column));
    return ordered.sort((a, b) => `${a.schema}.${a.table}.${a.column}`.localeCompare(`${b.schema}.${b.table}.${b.column}`));
}

/**
 * Split the conflicts into the ones Rebase can rebuild and the ones it cannot.
 *
 * `managed` is decided by the very list that hid the column from Atlas: a
 * `schema.table.column` exclude pattern means Rebase generated the column and
 * `search.sql` will put it back. Anything else is somebody's hand-written
 * generated column — dropping it would destroy a definition Rebase has no copy
 * of, so it is reported and the push stops instead.
 */
export function partitionByOwnership(
    conflicts: GeneratedColumnConflict[],
    excludePatterns: string[]
): { managed: GeneratedColumnConflict[]; foreign: GeneratedColumnConflict[] } {
    const owned = new Set(excludePatterns);
    const managed: GeneratedColumnConflict[] = [];
    const foreign: GeneratedColumnConflict[] = [];
    for (const conflict of conflicts) {
        const target = `${conflict.schema}.${conflict.table}.${conflict.column}`;
        (owned.has(target) ? managed : foreign).push(conflict);
    }
    return { managed, foreign };
}

/**
 * `ALTER TABLE … DROP COLUMN …` for each conflict, in catalogue order.
 *
 * `ifExists` is for the migration path, where the statement is written now and
 * runs later against a database nobody can inspect: on a fresh one the column
 * does not exist yet (the migration is about to create the table), on a live
 * one it does, and the same file has to survive both.
 */
export function dropGeneratedColumnStatements(
    conflicts: GeneratedColumnConflict[],
    opts: { ifExists?: boolean } = {}
): string[] {
    const guard = opts.ifExists ? "IF EXISTS " : "";
    return conflicts.map(c => `ALTER TABLE "${c.schema}"."${c.table}" DROP COLUMN ${guard}"${c.column}";`);
}

/**
 * The preamble a migration needs when it retypes a column a search block reads.
 *
 * Prepended, because the drop has to precede the `ALTER COLUMN … TYPE` that
 * PostgreSQL would otherwise refuse. The column comes back at the end of the
 * same migration: `db generate` appends `search.sql`, whose
 * `ADD COLUMN IF NOT EXISTS` rebuilds the column, its index and its stamp.
 */
export function migrationDropPreamble(conflicts: GeneratedColumnConflict[]): string {
    if (conflicts.length === 0) return "";
    const reasons = conflicts.map(c => {
        const reads = c.blocking.map(b => `${b.column} (${b.kind})`).join(", ");
        return `--   ${describeConflict(c)} reads ${reads}`;
    });
    return [
        "-- Rebase: generated columns removed so the statements below can run.",
        "-- PostgreSQL refuses to retype or drop a column while a GENERATED",
        "-- ALWAYS AS … STORED expression reads it.",
        ...reasons,
        "-- The search DDL appended at the end of this migration rebuilds them.",
        ...dropGeneratedColumnStatements(conflicts, { ifExists: true }),
        ""
    ].join("\n");
}

/** `public.posts.search_vector`, the way every message here names one. */
export function describeConflict(conflict: GeneratedColumnConflict): string {
    return `${conflict.schema}.${conflict.table}.${conflict.column}`;
}
