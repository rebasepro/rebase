/**
 * Which of the three ways onto the database a project is on, read before
 * `rebase db migrate` and `rebase db push` act on it.
 *
 * Boot ensures the additive part of the schema on every start, `db push` syncs
 * it directly, and `db generate` + `db migrate` carry it as files. A database
 * the first two set up holds the tables the first migration creates and records
 * no migration, so `db migrate` there stops on `already exists` part-way through
 * Atlas's run. That case is read here first: the tables the pending migrations
 * create, and whether any already exist on a database with no history. The
 * baseline is the user's decision, so the command stops and names it rather
 * than recording one itself.
 *
 * The reverse is `db push` on a database that records migrations: the push
 * changes it outside them, and the next migration that makes the same change
 * stops the same way. That one is a note, not a refusal.
 */

/** How many existing tables the refusal names before "and N more". */
const TABLES_NAMED = 3;

/** A table a migration creates, as Postgres resolves it. */
export interface CreatedTable {
    schema: string;
    table: string;
}

/** The part of a client this module queries through: `pg`'s and PGlite's both fit. */
export interface TableQueryable {
    query<R extends Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: R[] }>;
}

/** One identifier as written in DDL: `"Posts"` keeps its case, `posts` folds to lower case. */
function identifier(raw: string): string {
    return raw.startsWith("\"") ? raw.slice(1, -1).replace(/""/g, "\"") : raw.toLowerCase();
}

const IDENT = String.raw`(?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_$]*)`;
const CREATE_TABLE = new RegExp(
    String.raw`^\s*CREATE\s+(?:UNLOGGED\s+)?TABLE\s+(IF\s+NOT\s+EXISTS\s+)?(${IDENT})(?:\s*\.\s*(${IDENT}))?`,
    "gim"
);

/**
 * The tables a migration file creates with a plain `CREATE TABLE`, in order.
 *
 * `CREATE TABLE IF NOT EXISTS` is left out: it does not fail on a table that is
 * already there. An unqualified name is `public`'s, where Rebase puts tables.
 */
export function tablesCreatedBy(sql: string): CreatedTable[] {
    const tables: CreatedTable[] = [];
    for (const match of sql.matchAll(CREATE_TABLE)) {
        if (match[1]) continue;
        const first = identifier(match[2]);
        tables.push(match[3] ? { schema: first, table: identifier(match[3]) } : { schema: "public", table: first });
    }
    return tables;
}

/** `schema.table`, or `table` alone in `public`, as the messages name it. */
export function displayTableName({ schema, table }: CreatedTable): string {
    return schema === "public" ? table : `${schema}.${table}`;
}

function quoted(name: string): string {
    return `"${name.replace(/"/g, "\"\"")}"`;
}

/** Which of `tables` already exist on the database, in the order given. */
export async function existingTables(client: TableQueryable, tables: readonly CreatedTable[]): Promise<CreatedTable[]> {
    if (tables.length === 0) return [];
    const names = tables.map(t => `${quoted(t.schema)}.${quoted(t.table)}`);
    const result = await client.query<{ name: string }>(
        "SELECT name FROM unnest($1::text[]) AS name WHERE to_regclass(name) IS NOT NULL",
        [names]
    );
    const present = new Set(result.rows.map(row => row.name));
    return tables.filter((_, i) => present.has(names[i]));
}

/**
 * Why `rebase db migrate` without `--baseline` cannot run here, or `null`.
 *
 * Only on a database that records no migration: with history, Atlas runs from
 * the next version and any clash is a single migration's, which the failure
 * banner names.
 *
 * @param state.latestRecorded the newest version the database records, or null.
 * @param state.existing the tables the pending migrations create that already exist.
 * @param state.newestVersion the newest migration file's version: what boot set up.
 * @returns the refusal, its first line the error and the rest the detail.
 */
export function provisionedWithoutHistoryProblem(state: {
    latestRecorded: string | null;
    existing: readonly CreatedTable[];
    newestVersion: string | null;
    /** What the printed command needs to reach the same database: `""`, or ` --database analytics`. */
    commandSuffix?: string;
}): string | null {
    if (state.latestRecorded !== null || state.existing.length === 0 || state.newestVersion === null) return null;
    const names = state.existing.slice(0, TABLES_NAMED).map(t => `"${displayTableName(t)}"`);
    const more = state.existing.length - names.length;
    const listed = more > 0
        ? `${names.join(", ")} and ${more} more`
        : names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0];
    const version = state.newestVersion;
    return [
        "This database already has the tables your migrations create, and records no migration as applied. Nothing was run.",
        `A Rebase boot or \`rebase db push\` set it up without migrations: ${listed} ${state.existing.length === 1 ? "is" : "are"} there, so the first migration would stop on "already exists".`,
        "Record once that it already holds the migrations, and migrate from the next one:",
        "",
        `  rebase db migrate${state.commandSuffix ?? ""} --baseline ${version}`,
        "",
        `That marks ${version} and every migration before it as applied; every later \`rebase db migrate\` is an ordinary one.`,
        "Boot never drops or renames: if one of those migrations does, baseline at the version before it instead."
    ].join("\n");
}

/**
 * The one line `rebase db push` prints on a database that records migrations,
 * or `null` on one that records none.
 */
export function pushOnMigratedDatabaseNote(latestRecorded: string | null): string | null {
    if (latestRecorded === null) return null;
    return `This database is on migrations (newest recorded: ${latestRecorded}): \`rebase db push\` changes it outside them, ` +
        "so the next migration that makes the same change stops on \"already exists\" — apply changes here with " +
        "`rebase db generate` and `rebase db migrate` instead.";
}
