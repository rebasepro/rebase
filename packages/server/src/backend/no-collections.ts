/**
 * What the data API and the docs say when a project serves no collections.
 *
 * Two causes, and they want different fixes. A project that declares nothing
 * over an empty database needs tables. A project whose database has tables,
 * every one with row-level security off, needs RLS enabled on them: those
 * tables were found and deliberately not served, because without RLS a table
 * has no authorization model. Saying "the database has no tables" to the
 * second sent its developer looking for tables that were right there.
 *
 * Either way the answer describes the database as it was read at startup, or
 * at the last schema reload, and says so: a developer who has just enabled RLS
 * and still reads "row-level security is disabled" otherwise has no way to
 * tell a stale answer from a wrong fix.
 */

/**
 * How the answer is brought up to date: restart, or reload the schema in
 * place. The reload is the route every introspected backend mounts; on
 * Postgres the server also reloads on its own after DDL, when its role could
 * install the event trigger, and on `NOTIFY rebase_schema_changed`.
 */
export const SCHEMA_RELOAD_HINT =
    "This reflects the database as it was read at startup (or at the last schema reload). " +
    "After changing it, restart `rebase dev`, or reload without restarting: " +
    "`POST /api/admin/schema/reload` as an admin or with the service key, " +
    "or run `NOTIFY rebase_schema_changed;` on the database (Postgres, not the embedded dev database).";

/** How many skipped tables the message names before it counts the rest. */
const NAMED_TABLES = 10;

/**
 * The sentence after the opening one: why nothing is served, and what to do.
 *
 * @param unprotected tables the driver skipped for having RLS disabled.
 */
export function noCollectionsCause(unprotected: readonly { schema: string; table: string }[]): string {
    if (unprotected.length === 0) {
        return "It declares none in code, and the database has no tables to derive them from. " +
            "Create tables — a migration, SQL, or a table in backend/schema plus `rebase db push`. " +
            SCHEMA_RELOAD_HINT;
    }
    const names = unprotected.slice(0, NAMED_TABLES).map(({ schema, table }) => `${schema}.${table}`);
    const rest = unprotected.length - names.length;
    const listed = names.join(", ") + (rest > 0 ? ` and ${rest} more` : "");
    const first = unprotected[0];
    return `It declares none in code, and the database's ${unprotected.length === 1 ? "table" : "tables"} ` +
        `(${listed}) ${unprotected.length === 1 ? "was" : "were"} not served: row-level security is disabled, ` +
        "so nothing decides who may read which rows. Enable it on each — " +
        `\`ALTER TABLE "${first.schema}"."${first.table}" ENABLE ROW LEVEL SECURITY;\` — add a policy that opens ` +
        "the rows each user may see. A table with RLS and no policy is served and returns no rows. " +
        "To serve them without RLS anyway, pass `baas: { unprotectedTables: \"serve\" }` to the server entry, " +
        "which takes `rebase eject`: the managed runtime does not read it from config/ or the environment. " +
        SCHEMA_RELOAD_HINT;
}

/**
 * The answer for a request to one of the tables the driver skipped, when the
 * project does serve others — built-in auth's users table, say, which every
 * project on built-in auth serves. Without it the request fell through to the
 * data API's generic answers and the reason, with its fix, was only in the
 * boot log. `undefined` when `segment` names no skipped table.
 *
 * @param segment the path's first segment: a table name, or its kebab-case spelling.
 * @param unprotected tables the driver skipped for having RLS disabled.
 */
export function unprotectedTableAnswer(
    segment: string,
    unprotected: readonly { schema: string; table: string }[]
): { message: string; code: "TABLE_NOT_FOUND"; details: { unprotectedTables: string[] } } | undefined {
    const name = segment.replace(/-/g, "_");
    const skipped = unprotected.find(({ table }) => table === segment || table === name);
    if (!skipped) return undefined;
    const qualified = `"${skipped.schema}"."${skipped.table}"`;
    return {
        message: `The table ${skipped.schema}.${skipped.table} is not served: row-level security is disabled on it, ` +
            "so nothing decides who may read which rows. Enable it — " +
            `\`ALTER TABLE ${qualified} ENABLE ROW LEVEL SECURITY;\` — and add a policy that opens the rows each user ` +
            "may see. A table with RLS and no policy is served and returns no rows. " +
            "To serve it without RLS anyway, pass `baas: { unprotectedTables: \"serve\" }` to the server entry, " +
            "which takes `rebase eject`: the managed runtime does not read it from config/ or the environment. " +
            SCHEMA_RELOAD_HINT,
        code: "TABLE_NOT_FOUND",
        details: { unprotectedTables: unprotected.map(({ schema, table }) => `${schema}.${table}`) }
    };
}
