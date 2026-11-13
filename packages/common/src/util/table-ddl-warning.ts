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

/** A character that continues an identifier: `$` is one, so `a$b$` is a name and not a dollar quote. */
const IDENTIFIER_CHAR = /[\w$]/;
const DOLLAR_QUOTE = /\$([A-Za-z_]\w*)?\$/y;

/**
 * Comments and literals out, quoted identifiers kept: a `CREATE TABLE` inside a
 * string is data, and a table named `"Order"` must keep its case.
 */
function stripCommentsAndLiterals(sqlText: string): string {
    let out = "";
    let i = 0;
    while (i < sqlText.length) {
        const char = sqlText[i];
        if (char === "-" && sqlText.startsWith("--", i)) {
            const end = sqlText.indexOf("\n", i);
            i = end === -1 ? sqlText.length : end;
            continue;
        }
        if (char === "/" && sqlText.startsWith("/*", i)) {
            const end = sqlText.indexOf("*/", i + 2);
            i = end === -1 ? sqlText.length : end + 2;
            out += " ";
            continue;
        }
        if (char === "'") {
            i++;
            while (i < sqlText.length) {
                if (sqlText[i] === "'" && sqlText[i + 1] === "'") i += 2;
                else if (sqlText[i] === "'") { i++; break; }
                else i++;
            }
            out += "''";
            continue;
        }
        if (char === "$" && !(i > 0 && IDENTIFIER_CHAR.test(sqlText[i - 1]))) {
            DOLLAR_QUOTE.lastIndex = i;
            const dollar = DOLLAR_QUOTE.exec(sqlText);
            if (dollar) {
                const end = sqlText.indexOf(dollar[0], i + dollar[0].length);
                i = end === -1 ? sqlText.length : end + dollar[0].length;
                out += "''";
                continue;
            }
        }
        if (char === "\"") {
            const end = sqlText.indexOf("\"", i + 1);
            const stop = end === -1 ? sqlText.length : end + 1;
            out += sqlText.slice(i, stop);
            i = stop;
            continue;
        }
        out += char;
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
    // Every statement this finds starts with one of these words (`CREATE INDEX`
    // with `create`), so a query without them — a large INSERT, most of all —
    // is not scanned.
    if (!/\b(?:create|alter|drop)\b/i.test(sqlText)) return [];
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
    const declaration = `its \`defineTable("${ddl.table}", …)\` in backend/schema/`;
    const migrations = "`pnpm db:push` in development, `pnpm db:generate` then `pnpm db:migrate` for production";
    const introspect = "A table with no declaration yet: `pnpm schema:introspect` writes one.";
    const ran = "The statement ran. See ai-instructions.md.";
    if (ddl.statement === "alter table") {
        return [
            `rebase.sql() ran \`ALTER TABLE ${qualified}\`: in a Rebase project every application table is declared in backend/schema.`,
            `Change ${declaration} and let the migration do it: ${migrations}.`,
            introspect,
            ran
        ].join("\n");
    }
    if (ddl.statement === "drop table") {
        return [
            `rebase.sql() ran \`DROP TABLE ${qualified}\`: in a Rebase project every application table is declared in backend/schema.`,
            `Remove ${declaration} instead, and leave dropping the table to a person, who can see what it holds first.`,
            ran
        ].join("\n");
    }
    const what = ddl.statement === "create index"
        ? `\`CREATE INDEX\` on ${qualified}: an index belongs in the table's \`indexes\`, which boot creates.`
        : `\`CREATE TABLE ${qualified}\`: in a Rebase project every application table is declared in backend/schema.`;
    return [
        `rebase.sql() ran ${what}`,
        `Declare it in backend/schema/${file}.ts with defineTable("${ddl.table}", { columns, rls, indexes }).` +
        " `pnpm dev` (or `pnpm schema:generate`) creates the table and its columns and indexes, and gives it validation, hooks, row-level security, an admin view and SDK types.",
        "Read and write it with `rebase.dataAsAdmin.<slug>`, or `getDriver(c)` to act as the caller — never raw SQL against an application table.",
        `A table that already exists: \`pnpm schema:introspect\` writes its declaration. A change boot leaves alone (a rename, a dropped column): ${migrations}.`,
        ran
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
