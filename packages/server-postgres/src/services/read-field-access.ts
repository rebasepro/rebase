import type { FetchCollectionProps } from "@rebasepro/types";
import { hasColumnAccessRules, hasJoinAccessRules, type FieldViewer } from "@rebasepro/common";
import { assertQueryFieldsReadable } from "@rebasepro/server";
import type { PostgresTableRegistry } from "../model/PostgresTableRegistry";

/**
 * Refuse a read that names a column or relation its caller may not read, for
 * the doors that take a driver-shaped request rather than a query string: the
 * socket's `FETCH_COLLECTION`, `COUNT` and `CHECK_UNIQUE_FIELD`,
 * `subscribe_collection`, and the driver's own read entry points for any read
 * made on a caller's behalf (an in-process `context.data` under the caller's
 * scope reaches no REST check). Callers hand it the request itself, not a
 * re-listed copy of some of its keys.
 *
 * Every decision is the table descriptor's, through common's access helpers
 * (the REST check's `assertQueryFieldsReadable`): a `.private()` column or
 * relation is answered as a name the table does not have, an `.access({ read })`
 * one the caller's roles do not satisfy is refused with `FIELD_NOT_READABLE`,
 * and a withheld `belongsTo` takes its foreign key with it.
 *
 * The row strip keeps a withheld value off the wire; this is the other half, and
 * without it the value is still readable one predicate at a time — a `COUNT`
 * filtered on `passwordHash like '$2b$10$A%'` answers 1 or 0. `GET /api/data`
 * refuses the same request with `FIELD_NOT_READABLE`, and this is that rule, not
 * a copy of it: only the request's shape is translated here.
 *
 * The shape arrives as whatever JSON the client sent, so it is read defensively.
 * A malformed `orderBy` or `fields` is not this check's to reject; the entries
 * that name a field are checked and the rest are left for the driver to refuse.
 */
export function assertReadRequestReadable(
    request: Pick<FetchCollectionProps, "filter" | "logical" | "orderBy" | "fields" | "include" | "vectorSearch">,
    /** The table read, by slug. */
    read: { slug: string },
    viewer: FieldViewer,
    /** Where the table's descriptor — and its relations' targets' — are read from. */
    registry: Pick<PostgresTableRegistry, "relatedTables" | "requireTable">
): void {
    // Fail closed: a table this registry does not serve is refused by
    // `requireTable`, never read unchecked.
    const table = registry.requireTable(read.slug).descriptor;
    // By slug or SQL name: a `via` step names a table by its SQL name. A table
    // the server does not serve closes every `via` through it.
    const related = registry.relatedTables();
    // Nothing on the table restricts a name and nothing reaches another
    // table: there is nothing to refuse. Every read on a caller's behalf
    // passes here, so the common case costs one walk of the columns.
    // A relation path reads the join's columns, which may be another
    // table's (`staff?handledCases.title=…` reads `cases.handlerId`).
    if (request.include == null && !hasColumnAccessRules(table) && !hasJoinAccessRules(table, related)) return;
    // Every input the REST check takes. An `include` reads its target's
    // columns — `{ staff: { where: { salary: [">", 100000] } } }` answers which
    // departments employ someone over the line — and a vector search measures
    // the vector it ranks by. Left out, both were refused over HTTP and
    // answered here.
    const vectorProperty = request.vectorSearch && typeof request.vectorSearch === "object"
        ? request.vectorSearch.property
        : undefined;
    assertQueryFieldsReadable({
        where: request.filter && typeof request.filter === "object" ? request.filter : undefined,
        logical: request.logical,
        orderBy: sortedFields(request.orderBy),
        fields: Array.isArray(request.fields) ? request.fields : undefined,
        include: request.include ?? undefined,
        vectorSearch: typeof vectorProperty === "string" ? { property: vectorProperty } : undefined
    }, table, viewer, related);
}

/** The fields an `orderBy` sorts on, in either of its two spellings. */
function sortedFields(orderBy: unknown): { field: string }[] | undefined {
    if (typeof orderBy === "string") return [{ field: orderBy }];
    if (!Array.isArray(orderBy)) return undefined;
    return orderBy.flatMap((entry: unknown) =>
        Array.isArray(entry) && typeof entry[0] === "string" ? [{ field: entry[0] }] : []);
}
