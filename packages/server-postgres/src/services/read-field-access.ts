import type { CollectionConfig, FetchCollectionProps } from "@rebasepro/types";
import type { FieldViewer } from "@rebasepro/common";
import { assertQueryFieldsReadable } from "@rebasepro/server";

/**
 * Refuse a read that names a field its caller may not read, for the doors that
 * take a driver-shaped request rather than a query string: the socket's
 * `FETCH_COLLECTION`, `COUNT` and `CHECK_UNIQUE_FIELD`, and `subscribe_collection`.
 * Callers hand it the request itself, not a re-listed copy of some of its keys.
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
    collection: CollectionConfig,
    viewer: FieldViewer
): void {
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
    }, collection, viewer);
}

/** The fields an `orderBy` sorts on, in either of its two spellings. */
function sortedFields(orderBy: unknown): { field: string }[] | undefined {
    if (typeof orderBy === "string") return [{ field: orderBy }];
    if (!Array.isArray(orderBy)) return undefined;
    return orderBy.flatMap((entry: unknown) =>
        Array.isArray(entry) && typeof entry[0] === "string" ? [{ field: entry[0] }] : []);
}
