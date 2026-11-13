import { createTableRelationsHelpers, extractTablesRelationalConfig, type TablesRelationalConfig } from "drizzle-orm";
import { PgDatabase, PgDialect, type PgQueryResultHKT } from "drizzle-orm/pg-core";

/**
 * Give a drizzle database handle another relational schema (tables and
 * relations), in place.
 *
 * The handle is held by every service of a driver — the fetch, persist and
 * relation services, the realtime service, every request-scoped driver — so a
 * live schema apply cannot hand them a new one. Drizzle builds its relational
 * config once, in the handle's constructor, into three objects the handle,
 * its session (and so every transaction it opens) and each `db.query.<table>`
 * builder share: the table configs, the full schema and the table-name map.
 * Those objects are refilled here, and the `db.query` builders rebuilt over
 * them, synchronously: a request sees the schema before the call or the one
 * after it, never a mixture.
 *
 * The builders' dialect is a fresh `PgDialect`, which is what
 * `drizzle(client, { schema })` builds for a handle opened without a `casing`
 * option (every driver handle is).
 *
 * @param db The handle, opened with a relational schema (`drizzle(client, { schema })`).
 * @param schema The drizzle tables and relations to serve from now on.
 */
export function refreshRelationalSchema(
    db: PgDatabase<PgQueryResultHKT, Record<string, unknown>, TablesRelationalConfig>,
    schema: Record<string, unknown>
): void {
    const tables = db._.schema;
    if (!tables) {
        throw new Error("This drizzle handle was opened without a relational schema, so there is none to refresh.");
    }
    const next = extractTablesRelationalConfig<TablesRelationalConfig>(schema, createTableRelationsHelpers);
    refill(tables, next.tables);
    refill(db._.fullSchema, schema);
    refill(db._.tableNamesMap, next.tableNamesMap);

    // The `db.query` builders, built the way the handle's constructor built
    // them: a handle over the same session and the refilled objects builds one
    // per table, and its builders replace the old ones. (Built through
    // `PgDatabase` rather than `new RelationalQueryBuilder(…)`, whose
    // `session` parameter is a session of the empty schema — the handle's
    // session, typed by its own schema, is not one.)
    const rebuilt = new PgDatabase<PgQueryResultHKT, Record<string, unknown>, TablesRelationalConfig>(
        new PgDialect(),
        db._.session,
        { fullSchema: db._.fullSchema, schema: tables, tableNamesMap: db._.tableNamesMap }
    );
    for (const name of Object.keys(db.query)) delete db.query[name];
    Object.assign(db.query, rebuilt.query);
}

/** Replace every entry of `target` with those of `source`, keeping the object. */
function refill<T>(target: Record<string, T>, source: Record<string, T>): void {
    for (const key of Object.keys(target)) delete target[key];
    Object.assign(target, source);
}

