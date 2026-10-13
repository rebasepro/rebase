/**
 * What the data API and the docs say when a project serves no collections.
 *
 * Two causes, and they want different fixes. A project that declares nothing
 * over an empty database needs tables. A project whose database has tables,
 * every one with row-level security off, needs RLS enabled on them: those
 * tables were found and deliberately not served, because without RLS a table
 * has no authorization model. Saying "the database has no tables" to the
 * second sent its developer looking for tables that were right there.
 */

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
            "Create tables — a migration, SQL, or a collection file plus `rebase db push` — and restart.";
    }
    const names = unprotected.slice(0, NAMED_TABLES).map(({ schema, table }) => `${schema}.${table}`);
    const rest = unprotected.length - names.length;
    const listed = names.join(", ") + (rest > 0 ? ` and ${rest} more` : "");
    const first = unprotected[0];
    return `It declares none in code, and the database's ${unprotected.length === 1 ? "table" : "tables"} ` +
        `(${listed}) ${unprotected.length === 1 ? "was" : "were"} not served: row-level security is disabled, ` +
        "so nothing decides who may read which rows. Enable it on each — " +
        `\`ALTER TABLE "${first.schema}"."${first.table}" ENABLE ROW LEVEL SECURITY;\` — add a policy that opens ` +
        "the rows each user may see, and restart. A table with RLS and no policy is served and returns no rows. " +
        "To serve them without RLS, set `baas.unprotectedTables: \"serve\"`.";
}
