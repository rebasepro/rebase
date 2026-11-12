import type { CollectionConfig, TableDescriptor } from "@rebasepro/types";

/**
 * The descriptors of the tables a backend introspected from its database.
 *
 * A backend with no `backend/schema` serves the tables its database holds
 * (those with row-level security on), and the driver hands back, per table, the
 * descriptor it read from the catalogue (`InitializedDriver.tables`: columns as
 * Postgres types, relations from foreign keys, row-level security from
 * `pg_policies`) beside the collection the request-time code reads. Those
 * descriptors are what `GET /api/schema/tables`, the schema version and global
 * hooks read — nothing is lifted or re-derived here.
 *
 * @module
 */

/**
 * What one introspecting driver reported: its collections and their
 * descriptors.
 *
 * @group Schema
 */
export interface IntrospectedDriverResult {
    /** The driver's name, for the error. */
    driver: string;
    collections: readonly CollectionConfig[];
    tables: readonly TableDescriptor[] | undefined;
}

/**
 * The descriptors of every table the drivers introspected, each one's
 * auth-secret columns made private (`excluded`, what
 * `enforceAuthSecretExclusion` stripped from the collections — the same
 * columns must never be described as served).
 *
 * Throws, naming the driver and the tables, when a driver served a collection
 * without its descriptor or described a table it does not serve: the two lists
 * are one answer, and a table with no descriptor would break every reader of
 * `GET /api/schema/tables` and every global hook on it.
 *
 * @group Schema
 */
export function introspectedDescriptors(
    results: readonly IntrospectedDriverResult[],
    excluded: readonly { slug: string; columns: readonly string[] }[] = []
): TableDescriptor[] {
    const out: TableDescriptor[] = [];
    for (const { driver, collections, tables } of results) {
        if (collections.length === 0) continue;
        if (tables === undefined) {
            throw new Error(
                `Driver "${driver}" introspected ${collections.length} table(s) and described none of them. A driver ` +
                "that derives tables from the database reports their descriptors on `InitializedDriver.tables`."
            );
        }
        const described = new Set(tables.map(table => table.slug));
        const served = new Set(collections.map(collection => collection.slug));
        const undescribed = [...served].filter(slug => !described.has(slug));
        const unserved = [...described].filter(slug => !served.has(slug));
        if (undescribed.length > 0 || unserved.length > 0) {
            throw new Error(
                `Driver "${driver}" reported tables and descriptors that do not match` +
                (undescribed.length > 0 ? `; served without a descriptor: ${undescribed.join(", ")}` : "") +
                (unserved.length > 0 ? `; described but not served: ${unserved.join(", ")}` : "") + "."
            );
        }
        for (const table of tables) {
            const secret = new Set(excluded.find(entry => entry.slug === table.slug)?.columns ?? []);
            out.push(secret.size === 0 ? table : {
                ...table,
                columns: table.columns.map(column => secret.has(column.key) ? { ...column, private: true } : column)
            });
        }
    }
    return out;
}
