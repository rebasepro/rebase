/**
 * What `schema introspect` does with the parts of a database that a table
 * definition does not hold as they are: Supabase's conventions, plain indexes,
 * CHECKs the API validates and the database no longer would, and the objects
 * (functions, triggers, extensions) no definition carries at all.
 *
 * Introspecting a Supabase schema used to rewrite the policies to
 * `rebase.uid()` and leave the rest as it was: a column default of
 * `auth.uid()` that fails the first push (`schema "auth" does not exist`),
 * policies `TO authenticated` / `TO anon` for roles a Rebase database does not
 * have, a foreign key to `auth.users` dropped without a word, indexes dropped,
 * and seven functions and two triggers never mentioned. Silence read as
 * "everything came across".
 *
 * Every function here is pure: `describeTables` calls them in its "generate"
 * pass, and `schema introspect` prints the report.
 */
import { compilePolicyExpression } from "@rebasepro/common";
import { policy } from "@rebasepro/types";
import type { SecurityRule, SecurityRuleBase, TableIndex, TableIndexKey } from "@rebasepro/types";
import type { DatabaseObjectRow, ForeignKeyRow, IndexDefinitionRow, SchemaMetadata } from "./introspect-db-logic";

/** A column DEFAULT that is the caller's id: `auth.uid()`, `rebase.uid()`, either inside `(SELECT …)`. */
export function isCallerIdDefault(raw: string | null | undefined): boolean {
    if (!raw) return false;
    return /^\(*\s*(?:select\s+)?(?:auth|rebase)\.uid\(\)\s*\)*(?:::\s*(?:text|uuid))?$/i.test(raw.trim());
}

/** A foreign key to Supabase's users table. */
export function isAuthUsersReference(fk: Pick<ForeignKeyRow, "foreign_schema" | "foreign_table_name">): boolean {
    return fk.foreign_schema === "auth" && fk.foreign_table_name === "users";
}

/** Supabase's database roles, which a Rebase database does not have. */
const SUPABASE_ROLES = new Set(["anon", "authenticated", "service_role"]);

/** The SQL `policy.authenticated()` compiles to: a signed-in caller, guests included, as Supabase's `authenticated`. */
function signedInSql(): string {
    return compilePolicyExpression(policy.authenticated());
}

function and(a: string | undefined, clause: string): string {
    if (a === undefined || /^\(?\s*true\s*\)?$/i.test(a.trim())) return clause;
    // `owner_id = rebase.uid()` already admits only the owner, and no row is
    // owned by an anonymous caller: the signed-in clause would add nothing.
    if (clause === signedInSql() && OWNER_EQUALITY.test(a)) return a;
    return `(${a}) AND (${clause})`;
}

/** `<column> = rebase.uid()`, bare or inside `(SELECT … AS uid)`, as Postgres prints it back. */
const OWNER_EQUALITY = /^\(*\s*"?\w+"?\s*=\s*\(*\s*(?:SELECT\s+)?rebase\.uid\(\)(?:\s+AS\s+uid)?\s*\)*\s*$/i;

/**
 * A rule read back from a policy, with Supabase's `TO` roles translated into
 * what Rebase means by them, or `null` when the policy only served a role
 * Rebase has no use for (`service_role`, which the server's own context
 * replaces).
 *
 * - `TO authenticated` → the role is dropped and the rule requires a signed-in
 *   caller (`policy.authenticated()`'s SQL, ANDed into USING and WITH CHECK).
 * - `TO anon` → dropped, the rule requiring a caller who is *not* signed in.
 * - `TO anon, authenticated` → dropped: every caller, which is no condition.
 * - Any other role is kept as it was.
 */
export function translateSupabaseRoles(rule: SecurityRule): { rule: SecurityRule | null; note?: string } {
    const pgRoles = "pgRoles" in rule ? rule.pgRoles : undefined;
    if (!pgRoles || !pgRoles.some(role => SUPABASE_ROLES.has(role))) return { rule };
    const kept = pgRoles.filter(role => !SUPABASE_ROLES.has(role));
    const anon = pgRoles.includes("anon");
    const authenticated = pgRoles.includes("authenticated");
    const name = rule.name ?? "a policy";
    if (!anon && !authenticated && kept.length === 0) {
        return { rule: null, note: `policy "${name}" was only for Supabase's service_role, which a Rebase server replaces with its own context; it is not carried over.` };
    }
    const base: SecurityRuleBase = {
        ...(rule.name !== undefined ? { name: rule.name } : {}),
        ...(rule.operation !== undefined ? { operation: rule.operation } : {}),
        ...(rule.operations !== undefined ? { operations: rule.operations } : {}),
        ...(rule.mode !== undefined ? { mode: rule.mode } : {}),
        ...(kept.length > 0 ? { pgRoles: kept } : {})
    };
    const using = "using" in rule && typeof rule.using === "string" ? rule.using : undefined;
    const withCheck = "withCheck" in rule && typeof rule.withCheck === "string" ? rule.withCheck : undefined;
    const rebuilt = (u: string | undefined, w: string | undefined): SecurityRule =>
        u !== undefined ? (w !== undefined ? { ...base, using: u, withCheck: w } : { ...base, using: u })
            : w !== undefined ? { ...base, withCheck: w } : { ...base, using: "true" };
    if (anon && authenticated) {
        return { rule: rebuilt(using, withCheck), note: `policy "${name}" was TO anon, authenticated (every caller); the roles are dropped.` };
    }
    const clause = authenticated ? signedInSql() : `NOT (${signedInSql()})`;
    const out = using === undefined && withCheck === undefined
        ? rebuilt(clause, undefined)
        : rebuilt(using !== undefined ? and(using, clause) : undefined, withCheck !== undefined ? and(withCheck, clause) : undefined);
    return {
        rule: out,
        note: `policy "${name}" was TO ${authenticated ? "authenticated" : "anon"}; Rebase has no such database role, so the rule now requires a ${authenticated ? "signed-in" : "signed-out"} caller instead.`
    };
}

/**
 * The plain indexes of a table as `indexes` entries: columns only, no
 * expression, no predicate, btree / gin / brin, not unique (a unique index is
 * the column's `unique`). An index on a link's column alone is left out: the
 * relation indexes it. Everything else is returned in `unsupported`, with the
 * SQL that recreates it.
 */
export function plainIndexes(
    rows: readonly IndexDefinitionRow[],
    keyByColumn: ReadonlyMap<string, string>,
    linkColumns: ReadonlySet<string>
): { indexes: TableIndex[]; unsupported: IndexDefinitionRow[] } {
    const indexes: TableIndex[] = [];
    const unsupported: IndexDefinitionRow[] = [];
    for (const row of rows) {
        const columns = Array.isArray(row.column_names) ? row.column_names : null;
        if (row.unique && columns && columns.length === 1) continue;
        if (columns && columns.length === 1 && linkColumns.has(columns[0]) && row.method === "btree" && !row.predicate) continue;
        const method = row.method === "btree" || row.method === "gin" || row.method === "brin" ? row.method : null;
        const keys = columns?.map(column => keyByColumn.get(column));
        if (!columns || !method || row.unique || row.predicate || !keys || keys.some(key => key === undefined)) {
            unsupported.push(row);
            continue;
        }
        const desc = Array.isArray(row.descending) ? row.descending : [];
        const entries: Array<string | TableIndexKey> = [];
        keys.forEach((key, i) => {
            if (key === undefined) return;
            entries.push(desc[i] && method === "btree" ? { column: key, direction: "desc" } : key);
        });
        const [first, ...more] = entries;
        if (first === undefined) {
            unsupported.push(row);
            continue;
        }
        indexes.push({
            columns: [first, ...more],
            ...(method !== "btree" ? { using: method } : {}),
            reason: `carried over from ${row.index_name}`
        });
    }
    return { indexes, unsupported };
}

/** One line of the "not carried over" report, and the SQL to recreate it where there is one. */
export interface LeftBehind {
    kind: "function" | "trigger" | "extension" | "check" | "index" | "foreign key";
    name: string;
    table?: string;
    why: string;
    sql?: string;
}

/** Functions, triggers and extensions, which no table definition carries. */
export function objectsLeftBehind(objects: readonly DatabaseObjectRow[]): LeftBehind[] {
    return objects.map(object => ({
        kind: object.kind,
        name: object.name,
        ...(object.table_name ? { table: object.table_name } : {}),
        why: object.kind === "extension"
            ? "an extension of the database; enable it on the new one (`CREATE EXTENSION`) if the app uses it"
            : `a ${object.kind} is not part of a table definition; apply its SQL after \`db push\` (\`rebase cloud db query --file\` on Rebase Cloud)`,
        ...(object.definition ? { sql: object.definition } : {})
    }));
}

/** The left-behind objects' SQL as one reviewable file. */
export function renderLeftBehindSql(schema: string, items: readonly LeftBehind[]): string {
    const lines = [
        `-- Objects \`rebase schema introspect\` did not carry over from schema "${schema}".`,
        "-- Review each one, then apply after `rebase db push`:",
        "--   psql \"$DATABASE_URL\" -f this-file.sql      (or `rebase cloud db query --file this-file.sql`)",
        "-- Functions that referenced Supabase (auth.uid(), auth.users, roles anon/authenticated)",
        "-- need the same edits the tables got: rebase.uid(), the users table, no such roles.",
        ""
    ];
    for (const item of items) {
        lines.push(`-- ${item.kind}: ${item.table ? `${item.table}.` : ""}${item.name}`);
        if (!item.sql) continue;
        lines.push(item.sql.trim().replace(/;?$/, ";"));
        lines.push("");
    }
    return lines.join("\n");
}


/** Whether a schema uses Supabase's conventions: an `auth.uid()` default, a foreign key to `auth.users`, a policy for its roles. */
export function looksLikeSupabase(metadata: Pick<SchemaMetadata, "columns" | "externalFks" | "policies">): boolean {
    return metadata.columns.some(col => /\bauth\.uid\(\)/i.test(col.column_default ?? ""))
        || (metadata.externalFks ?? []).some(isAuthUsersReference)
        || (metadata.policies ?? []).some(policy => policy.roles.some(role => SUPABASE_ROLES.has(role)));
}
