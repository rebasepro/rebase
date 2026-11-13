import { createTableRelationsHelpers, extractTablesRelationalConfig, is, type TablesRelationalConfig } from "drizzle-orm";
import { PgDialect, PgTable, type PgDatabase, type PgQueryResultHKT } from "drizzle-orm/pg-core";
import { RelationalQueryBuilder } from "drizzle-orm/pg-core/query-builders/query";

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
 * The dialect is a fresh `PgDialect`, which is what `drizzle(client, { schema })`
 * builds for a handle opened without a `casing` option (every driver handle
 * is).
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

    const dialect = new PgDialect();
    for (const name of Object.keys(db.query)) delete db.query[name];
    for (const [name, config] of Object.entries(tables)) {
        const table = schema[name];
        if (!is(table, PgTable)) continue;
        db.query[name] = new RelationalQueryBuilder(
            db._.fullSchema, tables, db._.tableNamesMap, table, config, dialect, db._.session
        );
    }
}

/** Replace every entry of `target` with those of `source`, keeping the object. */
function refill<T>(target: Record<string, T>, source: Record<string, T>): void {
    for (const key of Object.keys(target)) delete target[key];
    Object.assign(target, source);
}

