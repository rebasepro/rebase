/**
 * Do the migration files still describe the collections?
 *
 * `rebase db generate` asks Atlas, which needs a dev database to replay the
 * migrations into — seconds of Docker, or the managed PGlite, before it can say
 * a word. `rebase verify` runs after every edit an agent makes to a collection
 * file and in CI, where neither is acceptable, so this answers the narrower
 * question offline: replay the `CREATE TABLE` / `ALTER TABLE` / `DROP TABLE`
 * statements the migrations contain, and compare the tables and columns that
 * leaves with the ones the schema plan derives from the collections.
 *
 * Deliberately tables and columns only. A changed type or default is a real
 * drift too, but reading it back out of Atlas's SQL means parsing every type
 * spelling Postgres accepts, and a check that misreads `character varying(255)`
 * as a change cries wolf on every run. A missing table or column is the drift
 * that breaks a deploy — the runtime queries a column the migrated database
 * does not have — and it is unambiguous in the text.
 *
 * Policies are not compared: the runtime applies a collection's policies at
 * boot whether or not a migration carries them.
 */
import type { CollectionConfig } from "@rebasepro/types";
import { planSchema } from "./plan/plan-schema";

/** One difference between the collections and what the migrations build. */
export interface UnmigratedChange {
    /**
     * - `missing-table` / `missing-column` — the collections declare it and no
     *   migration creates it.
     * - `removed-column` — a migration creates it, the collection no longer
     *   declares it, and no later migration drops it.
     */
    kind: "missing-table" | "missing-column" | "removed-column";
    /** `schema.table`. */
    table: string;
    column?: string;
    /** The collection that declares the table, when one does (a junction has none). */
    slug?: string;
}

/** A table as the migrations leave it. */
interface MigratedTable {
    /** Every column, however it was added. */
    columns: Set<string>;
    /**
     * The columns Atlas wrote: from a `CREATE TABLE` or an `ADD COLUMN` without
     * `IF NOT EXISTS`. The search, vector and trigger DDL `db generate` appends
     * after Atlas's half always says `IF NOT EXISTS`, and the planner keeps
     * those columns out of `TablePlan.columns` — so only these are candidates
     * for "removed from the collection".
     */
    managed: Set<string>;
}

/** Blank out `--` and `/* *\/` comments, leaving string and identifier literals alone. */
function stripComments(sql: string): string {
    let out = "";
    let i = 0;
    while (i < sql.length) {
        const ch = sql[i];
        if (ch === "'" || ch === "\"") {
            const end = sql.indexOf(ch, i + 1);
            const stop = end === -1 ? sql.length : end + 1;
            out += sql.slice(i, stop);
            i = stop;
        } else if (ch === "-" && sql[i + 1] === "-") {
            const end = sql.indexOf("\n", i);
            i = end === -1 ? sql.length : end;
        } else if (ch === "/" && sql[i + 1] === "*") {
            const end = sql.indexOf("*/", i + 2);
            i = end === -1 ? sql.length : end + 2;
        } else if (ch === "$") {
            // A dollar-quoted body (`$$ … $$`, `$fn$ … $fn$`) is copied whole: a
            // function body is full of `--` and `;` that are not ours to read.
            const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(i))?.[0];
            if (!tag) {
                out += ch;
                i++;
                continue;
            }
            const end = sql.indexOf(tag, i + tag.length);
            const stop = end === -1 ? sql.length : end + tag.length;
            out += sql.slice(i, stop);
            i = stop;
        } else {
            out += ch;
            i++;
        }
    }
    return out;
}

/**
 * Split on a separator at nesting depth zero, outside quotes and dollar quotes.
 * `;` splits a file into statements, `,` a column list into its elements.
 */
function splitTopLevel(text: string, separator: ";" | ","): string[] {
    const parts: string[] = [];
    let depth = 0;
    let start = 0;
    let i = 0;
    while (i < text.length) {
        const ch = text[i];
        if (ch === "'" || ch === "\"") {
            const end = text.indexOf(ch, i + 1);
            i = end === -1 ? text.length : end + 1;
            continue;
        }
        if (ch === "$") {
            const tag = /^\$[A-Za-z_]*\$/.exec(text.slice(i))?.[0];
            if (tag) {
                const end = text.indexOf(tag, i + tag.length);
                i = end === -1 ? text.length : end + tag.length;
                continue;
            }
        }
        if (ch === "(") depth++;
        else if (ch === ")") depth--;
        else if (ch === separator && depth === 0) {
            parts.push(text.slice(start, i));
            start = i + 1;
        }
        i++;
    }
    parts.push(text.slice(start));
    return parts.map(p => p.trim()).filter(p => p.length > 0);
}

/** One identifier: `"Quoted"` keeps its case, a bare word folds to lower case as Postgres folds it. */
const IDENT = String.raw`(?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_$]*)`;
/** An optionally schema-qualified name. */
const QUALIFIED = String.raw`${IDENT}(?:\s*\.\s*${IDENT})?`;

function unquote(identifier: string): string {
    const trimmed = identifier.trim();
    return trimmed.startsWith("\"") ? trimmed.slice(1, -1).replace(/""/g, "\"") : trimmed.toLowerCase();
}

/** `"public"."posts"` → `public.posts`; an unqualified name is in `public`. */
function qualifiedName(name: string): string {
    const [first = "", second] = name.match(new RegExp(IDENT, "g")) ?? [];
    return second !== undefined ? `${unquote(first)}.${unquote(second)}` : `public.${unquote(first)}`;
}

/** Words that open a table constraint rather than a column, inside `CREATE TABLE ( … )`. */
const TABLE_CONSTRAINT = /^(CONSTRAINT|PRIMARY|UNIQUE|FOREIGN|CHECK|EXCLUDE|LIKE)\b/i;

const CREATE_TABLE = new RegExp(String.raw`^CREATE\s+(?:UNLOGGED\s+)?TABLE\s+(IF\s+NOT\s+EXISTS\s+)?(${QUALIFIED})\s*\(([\s\S]*)\)[^)]*$`, "i");
const ALTER_TABLE = new RegExp(String.raw`^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(${QUALIFIED})\s+([\s\S]*)$`, "i");
const DROP_TABLE = /^DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([\s\S]*?)(?:\s+(?:CASCADE|RESTRICT))?$/i;
const ADD_COLUMN = new RegExp(String.raw`^ADD\s+(?:COLUMN\s+)?(IF\s+NOT\s+EXISTS\s+)?(${IDENT})`, "i");
const DROP_COLUMN = new RegExp(String.raw`^DROP\s+(?:COLUMN\s+)?(?:IF\s+EXISTS\s+)?(${IDENT})`, "i");
const RENAME_COLUMN = new RegExp(String.raw`^RENAME\s+(?:COLUMN\s+)?(${IDENT})\s+TO\s+(${IDENT})$`, "i");
const RENAME_TABLE = new RegExp(String.raw`^RENAME\s+TO\s+(${IDENT})$`, "i");

/**
 * The tables and columns the migrations leave behind, replayed in order.
 *
 * Exported for its tests.
 */
export function replayMigrationTables(migrations: readonly string[]): Map<string, MigratedTable> {
    const tables = new Map<string, MigratedTable>();
    const tableOf = (name: string): MigratedTable => {
        let table = tables.get(name);
        if (!table) {
            table = { columns: new Set(), managed: new Set() };
            tables.set(name, table);
        }
        return table;
    };

    for (const migration of migrations) {
        for (const raw of splitTopLevel(stripComments(migration), ";")) {
            const statement = raw.replace(/\s+/g, " ").trim();

            const created = CREATE_TABLE.exec(statement);
            if (created) {
                const table = tableOf(qualifiedName(created[2]));
                const managed = !created[1];
                for (const element of splitTopLevel(created[3], ",")) {
                    if (TABLE_CONSTRAINT.test(element)) continue;
                    const column = new RegExp(`^${IDENT}`).exec(element)?.[0];
                    if (!column) continue;
                    table.columns.add(unquote(column));
                    if (managed) table.managed.add(unquote(column));
                }
                continue;
            }

            const altered = ALTER_TABLE.exec(statement);
            if (altered) {
                const name = qualifiedName(altered[1]);
                for (const action of splitTopLevel(altered[2], ",")) {
                    const renamedTable = RENAME_TABLE.exec(action);
                    if (renamedTable) {
                        const existing = tables.get(name);
                        tables.delete(name);
                        const target = `${name.split(".")[0]}.${unquote(renamedTable[1])}`;
                        if (existing) tables.set(target, existing);
                        continue;
                    }
                    const renamed = RENAME_COLUMN.exec(action);
                    if (renamed) {
                        const table = tableOf(name);
                        const from = unquote(renamed[1]);
                        const to = unquote(renamed[2]);
                        table.columns.delete(from);
                        table.columns.add(to);
                        if (table.managed.delete(from)) table.managed.add(to);
                        continue;
                    }
                    const added = ADD_COLUMN.exec(action);
                    if (added && !/^ADD\s+(CONSTRAINT|PRIMARY|UNIQUE|FOREIGN|CHECK|EXCLUDE)\b/i.test(action)) {
                        const table = tableOf(name);
                        const column = unquote(added[2]);
                        table.columns.add(column);
                        if (!added[1]) table.managed.add(column);
                        continue;
                    }
                    const dropped = DROP_COLUMN.exec(action);
                    if (dropped && !/^DROP\s+(CONSTRAINT|DEFAULT|NOT|EXPRESSION|IDENTITY)\b/i.test(action)) {
                        const table = tableOf(name);
                        const column = unquote(dropped[1]);
                        table.columns.delete(column);
                        table.managed.delete(column);
                    }
                }
                continue;
            }

            const droppedTables = DROP_TABLE.exec(statement);
            if (droppedTables) {
                for (const name of splitTopLevel(droppedTables[1], ",")) tables.delete(qualifiedName(name));
            }
        }
    }
    return tables;
}

/**
 * What the collections declare that the migrations do not build, and what the
 * migrations still build that the collections dropped.
 *
 * `migrations` are the contents of every `.sql` file in the migrations
 * directory, in file-name order — Atlas's order. An empty list is a project
 * with no migrations at all, for which everything is missing; whether that is a
 * problem (a project on `db push` has none by design) is the caller's call.
 *
 * Throws what {@link planSchema} throws for a configuration it cannot plan.
 */
export function findUnmigratedSchema(
    collections: CollectionConfig[],
    migrations: readonly string[]
): UnmigratedChange[] {
    const plan = planSchema(collections);
    const migrated = replayMigrationTables(migrations);
    const changes: UnmigratedChange[] = [];

    for (const table of plan.tables) {
        const slug = table.slug;
        const existing = migrated.get(table.qualified);
        if (!existing) {
            changes.push({ kind: "missing-table", table: table.qualified, ...(slug && { slug }) });
            continue;
        }
        // The users table is shared with the auth tables boot provisions
        // (`auth-users-columns`), which add columns no collection declares and
        // no migration has to carry. The table's existence is the fact here.
        if (table.auth) continue;

        // A search column is carved out of Atlas's diff and added by the
        // search DDL `db generate` appends (`ADD COLUMN IF NOT EXISTS`), which
        // a migration from before the block was declared does not carry and
        // the runtime applies itself — not a migration's to own.
        const planned = new Set(table.columns
            .filter(column => column.source.kind !== "search")
            .map(column => column.column));
        for (const column of planned) {
            if (!existing.columns.has(column)) {
                changes.push({ kind: "missing-column", table: table.qualified, column, ...(slug && { slug }) });
            }
        }
        for (const column of existing.managed) {
            if (!planned.has(column)) {
                changes.push({ kind: "removed-column", table: table.qualified, column, ...(slug && { slug }) });
            }
        }
    }
    return changes;
}
