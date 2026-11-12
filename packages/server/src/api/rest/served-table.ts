import type { CollectionConfig, TableDescriptor } from "@rebasepro/types";

/**
 * The one seam between what the REST layer decides and what it hands the data
 * driver.
 *
 * Every decision a data route makes — which columns a body may write, which a
 * query may read, what a value must satisfy, which relation a path names, how
 * a row is keyed — is made from the table's {@link TableDescriptor}. The data
 * driver still takes the collection the table was lowered into (`fetchCollection`,
 * `save`, … each carry a `collection`), until slice B-R7 changes the driver
 * contract to tables across server, driver and client at once. Until then a
 * route needs both, and this is where it gets them: one value per served
 * table, built once when the routes are generated.
 *
 * B-R7 deletes `driverCollection` here and every read of it; nothing else in
 * the REST layer reads the collection.
 *
 * @module
 */

/**
 * A table the REST routes serve.
 *
 * @group REST
 */
export interface ServedTable {
    /** The table: what every decision of a route reads. */
    readonly table: TableDescriptor;
    /** What the data driver is handed for this table. Deleted with slice B-R7. */
    readonly driverCollection: CollectionConfig;
}

/**
 * The tables a set of REST routes serve, as the server's boot holds them: the
 * descriptor of every table, and the collection each served table was lowered
 * into for the data driver.
 *
 * `collections` lists the served tables (a table not in it has no routes);
 * `descriptors` may hold more — the target of a relation that is not served
 * itself is still described.
 *
 * @group REST
 */
export interface RestTables {
    /** Every table's descriptor, by slug. */
    readonly descriptors: readonly TableDescriptor[];
    /** The collection of each served table, handed to the data driver. Deleted with slice B-R7. */
    readonly collections: readonly CollectionConfig[];
}

/**
 * Look a table's descriptor up by slug: what a relation's `target` names.
 *
 * @group REST
 */
export type TableLookup = (slug: string) => TableDescriptor | undefined;

/**
 * Pair every served collection with its table's descriptor.
 *
 * Throws, naming the tables, when a served collection has no descriptor: the
 * boot fills both from one compile (or one introspection), so a gap is a bug
 * in whatever built the input, and a route without a descriptor would decide
 * nothing.
 *
 * @group REST
 */
export function servedTables(input: RestTables): { served: ServedTable[]; lookup: TableLookup } {
    const bySlug = new Map(input.descriptors.map(table => [table.slug, table]));
    const served: ServedTable[] = [];
    const undescribed: string[] = [];
    for (const driverCollection of input.collections) {
        const table = bySlug.get(driverCollection.slug);
        if (!table) {
            undescribed.push(driverCollection.slug);
            continue;
        }
        served.push({ table, driverCollection });
    }
    if (undescribed.length > 0) {
        throw new Error(
            `The REST routes were handed ${undescribed.length === 1 ? "a table" : "tables"} without a descriptor: ` +
            `${undescribed.join(", ")}. Every served table is described by the same compile that lowered it.`
        );
    }
    return { served, lookup: slug => bySlug.get(slug) };
}
