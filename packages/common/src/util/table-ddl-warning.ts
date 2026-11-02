/**
 * The guard that keeps a project's tables in its collections.
 *
 * `rebase.sql()` runs on the owner connection, so nothing in the database stops
 * it creating a table — and an AI agent that does not know Rebase reaches for
 * exactly that: `CREATE TABLE IF NOT EXISTS` inside a function, then raw reads
 * and writes against it. Such a table has no collection, so no validation, no
 * callbacks, no security rules, no admin view and no SDK type, and every later
 * agent copies the pattern it finds. The project's instruction files say all of
 * this, but they are files an agent may never open: one started at the root of
 * a repository whose Rebase project sits in a subfolder never loads them. What
 * every agent does read is what its own code prints when it runs, so the rule
 * is said there.
 *
 * A statement that creates, alters or drops a table, or indexes one, is logged
 * once per table with the way to do it instead, and then runs: raw SQL is never
 * blocked. Temporary tables and Rebase's own schemas are left alone.
 */

import { REBASE_INTERNAL_SCHEMAS, isRebaseInternalTable } from "../table-classification";

/** One statement that changes the shape of an application table. */
export interface TableDdl {
    statement: "create table" | "alter table" | "drop table" | "create index";
    /** As Postgres resolves it: unquoted names lower-cased, `public` when unqualified. */
    schema: string;
    table: string;
}

/**
 * Comments and literals out, quoted identifiers kept: a `CREATE TABLE` inside a
 * string is data, and a table named `"Order"` must keep its case.
 */
function stripCommentsAndLiterals(sqlText: string): string {
    let out = "";
    let i = 0;
    while (i < sqlText.length) {
        const rest = sqlText.slice(i);
        if (rest.startsWith("--")) {
            const end = sqlText.indexOf("\n", i);
            i = end === -1 ? sqlText.length : end;
            continue;
        }
        if (rest.startsWith("/*")) {
            const end = sqlText.indexOf("*/", i + 2);
            i = end === -1 ? sqlText.length : end + 2;
            out += " ";
            continue;
        }
        if (sqlText[i] === "'") {
            i++;
            while (i < sqlText.length) {
                if (sqlText[i] === "'" && sqlText[i + 1] === "'") i += 2;
                else if (sqlText[i] === "'") { i++; break; }
                else i++;
            }
            out += "''";
            continue;
        }
        const dollar = /^\$([A-Za-z_]\w*)?\$/.exec(rest);
        if (dollar) {
            const end = sqlText.indexOf(dollar[0], i + dollar[0].length);
            i = end === -1 ? sqlText.length : end + dollar[0].length;
            out += "''";
            continue;
        }
        if (sqlText[i] === "\"") {
            const end = sqlText.indexOf("\"", i + 1);
            const stop = end === -1 ? sqlText.length : end + 1;
            out += sqlText.slice(i, stop);
            i = stop;
            continue;
        }
        out += sqlText[i];
        i++;
    }
    return out;
}

const PART = String.raw`(?:"[^"]+"|[A-Za-z_][\w$]*)`;
const NAME = String.raw`(${PART}(?:\s*\.\s*${PART})?)`;

const PATTERNS: readonly [TableDdl["statement"], RegExp][] = [
    ["create table", new RegExp(String.raw`^create\s+(?:(?:global|local)\s+)?(?:(temp|temporary|unlogged)\s+)?table\s+(?:if\s+not\s+exists\s+)?${NAME}`, "i")],
    ["alter table", new RegExp(String.raw`^alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?()${NAME}`, "i")],
    ["drop table", new RegExp(String.raw`^drop\s+table\s+(?:if\s+exists\s+)?()${NAME}`, "i")],
    ["create index", new RegExp(String.raw`^create\s+(?:unique\s+)?index\b[\s\S]*?\bon\s+(?:only\s+)?()${NAME}`, "i")]
];

function unquote(part: string): string {
    const trimmed = part.trim();
    return trimmed.startsWith("\"") ? trimmed.slice(1, -1) : trimmed.toLowerCase();
}

/** The application-table DDL in a SQL string, one entry per statement that has it. */
export function findTableDdl(sqlText: string): TableDdl[] {
    const found: TableDdl[] = [];
    for (const raw of stripCommentsAndLiterals(sqlText).split(";")) {
        const statement = raw.trim();
        for (const [kind, pattern] of PATTERNS) {
            const match = pattern.exec(statement);
            if (!match) continue;
            if (match[1] && /^temp/i.test(match[1])) break;
            const parts = match[2].split(/\s*\.\s*(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(unquote);
            const [schema, table] = parts.length === 2 ? parts : ["public", parts[0]];
            if (schema === "pg_temp" || REBASE_INTERNAL_SCHEMAS.includes(schema) || isRebaseInternalTable(table, schema)) break;
            found.push({ statement: kind, schema, table });
            break;
        }
    }
    return found;
}

/** What an agent (or a person) reads when the guard stops them, written to be acted on as it stands. */
export function tableDdlMessage(ddl: TableDdl): string {
    const qualified = ddl.schema === "public" ? ddl.table : `${ddl.schema}.${ddl.table}`;
    const file = ddl.table.replace(/_/g, "-");
    const what = ddl.statement === "create index"
        ? `\`CREATE INDEX\` on ${qualified}: an index belongs in the collection's \`indexes\`, which boot creates.`
        : `\`${ddl.statement.toUpperCase()} ${qualified}\`: in a Rebase project every application table is a collection.`;
    return [
        `rebase.sql() ran ${what}`,
        `Declare it in config/collections/${file}.ts with defineCollection({ slug, table: "${ddl.table}", properties, securityRules, indexes }).` +
        " `pnpm dev` (or `pnpm schema:generate`) creates the table and its columns and indexes, and gives it validation, callbacks, security rules, an admin view and SDK types.",
        "Read and write it with `rebase.dataAsAdmin.<slug>`, or `getDriver(c)` to act as the caller — never raw SQL against an application table.",
        "A table that already exists: `pnpm schema:introspect` writes its collection. A change boot leaves alone (a rename, a dropped column): `pnpm db:push` in development, `pnpm db:generate` then `pnpm db:migrate` for production.",
        "The statement ran. See ai-instructions.md."
    ].join("\n");
}

const warned = new Set<string>();

/** Log application-table DDL once per table, with the way to do it instead. Never throws: the statement runs. */
export function warnOnTableDdl(sqlText: string, warn: (message: string) => void = message => console.warn(message)): void {
    for (const one of findTableDdl(sqlText)) {
        const key = `${one.statement} ${one.schema}.${one.table}`;
        if (warned.has(key)) continue;
        warned.add(key);
        warn(tableDdlMessage(one));
    }
}
