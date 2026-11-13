import type { TableDescriptor } from "@rebasepro/types";

/**
 * The tables a set of REST routes serves.
 *
 * Every decision a data route makes — which columns a body may write, which a
 * query may read, what a value must satisfy, which relation a path names, how
 * a row is keyed — is made from the table's {@link TableDescriptor}, and the
 * data driver is handed the table's path (its slug) and nothing else.
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
}

/**
 * The tables a set of REST routes serves, as the server's boot holds them.
 *
 * `descriptors` describes every table a route may meet — the target of a
 * relation that is not served itself is still described. `served` names the
 * tables that get routes; left out, every described table does.
 *
 * @group REST
 */
export interface RestTables {
    /** Every table's descriptor. */
    readonly descriptors: readonly TableDescriptor[];
    /** The slugs of the tables that get routes (a table not in it has none); every descriptor when absent. */
    readonly served?: readonly string[];
}

/**
 * Look a table's descriptor up by slug: what a relation's `target` names.
 *
 * @group REST
 */
export type TableLookup = (slug: string) => TableDescriptor | undefined;

/**
 * The served tables, each with its descriptor, and the lookup over every
 * descriptor.
 *
 * Throws, naming the tables, when a served slug has no descriptor: the boot
 * fills both from one compile (or one introspection), so a gap is a bug in
 * whatever built the input, and a route without a descriptor would decide
 * nothing.
 *
 * @group REST
 */
export function servedTables(input: RestTables): { served: ServedTable[]; lookup: TableLookup } {
    const bySlug = new Map(input.descriptors.map(table => [table.slug, table]));
    // By slug, then by SQL name: a `via` step names the tables it joins by
    // their SQL names, and a read gate judges the columns on each.
    const byTable = new Map(input.descriptors.map(table => [table.table, table]));
    const lookup: TableLookup = name => bySlug.get(name) ?? byTable.get(name);
    if (input.served === undefined) {
        return { served: input.descriptors.map(table => ({ table })), lookup };
    }
    const served: ServedTable[] = [];
    const undescribed: string[] = [];
    for (const slug of input.served) {
        const table = bySlug.get(slug);
        if (!table) {
            undescribed.push(slug);
            continue;
        }
        served.push({ table });
    }
    if (undescribed.length > 0) {
        throw new Error(
            `The REST routes were asked to serve ${undescribed.length === 1 ? "a table" : "tables"} without a descriptor: ` +
            `${undescribed.join(", ")}. Every served table is described by the same compile (or introspection) that names it.`
        );
    }
    return { served, lookup };
}
