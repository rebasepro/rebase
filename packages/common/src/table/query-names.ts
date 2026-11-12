import type { TableDescriptor } from "@rebasepro/types";

import { apiHiddenKeys } from "./access";

/**
 * The names a query may use on a table, for the "Valid fields: …" an unknown
 * name is answered with. Never a private column or relation: a name the API
 * does not have is offered nowhere.
 *
 * @module
 */

/**
 * The column keys a filter, a sort, a projection or an aggregate may name,
 * sorted: every column — the foreign keys of `belongsTo` relations included —
 * except the private ones.
 *
 * Replaces `queryableFieldNames(collection)`.
 *
 * @group Table
 */
export function queryableColumnKeys(table: TableDescriptor): string[] {
    const hidden = apiHiddenKeys(table);
    return table.columns.map(column => column.key).filter(key => !hidden.has(key)).sort();
}

/**
 * The relation names an `include` may name, sorted, the private ones left out.
 *
 * Replaces `includableRelationNames(collection)`.
 *
 * @group Table
 */
export function includableRelations(table: TableDescriptor): string[] {
    const hidden = apiHiddenKeys(table);
    return table.relations.map(relation => relation.name).filter(name => !hidden.has(name)).sort();
}

/**
 * The keys of the `vector` columns a vector search may rank by, sorted, the
 * private ones left out.
 *
 * Replaces `vectorPropertyNames(collection)`.
 *
 * @group Table
 */
export function vectorColumnKeys(table: TableDescriptor): string[] {
    const hidden = apiHiddenKeys(table);
    return table.columns
        .filter(column => column.type.kind === "vector" && !hidden.has(column.key))
        .map(column => column.key)
        .sort();
}
