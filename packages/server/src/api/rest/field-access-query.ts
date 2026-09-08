import type { CollectionConfig } from "@rebasepro/types";
import type { FilterCondition, LogicalCondition } from "@rebasepro/types";
import { type FieldViewer, restrictedFieldNames } from "@rebasepro/common";
import { ApiError } from "../errors";

/**
 * A read may not name a field the caller cannot read.
 *
 * The strip in the row pipeline is what keeps the *value* off the wire. This is
 * the other half, and without it the value is still readable one bit at a time:
 * `?salary=gt.100000` returns the rows whose withheld salary is above 100k, and
 * `?orderBy=salary` returns them in order of it. A column no response can carry
 * has to be a column no query can interrogate, or the read rule is decoration.
 *
 * The refusal names the field. That is deliberate and it is not a leak: the
 * published OpenAPI lists every property of every collection, including the ones
 * a given caller cannot read, because the document is one document and is served
 * off the app rather than off the authenticated data router. Hiding the name
 * here would protect nothing and would answer a caller's genuine typo with
 * "unknown field", sending them to look for a spelling mistake that is not
 * there. Field *names* are public; field *values* are not.
 *
 * @module
 */

/**
 * The roles behind a request, as a viewer a field rule can judge.
 *
 * Never `undefined`, and that is the point. `undefined` means the trusted server
 * plane in {@link FieldViewer}, which satisfies every non-empty role list — so
 * returning it for a request that merely has no `user` on the context would
 * hand an unauthenticated caller every field in the database. The auth
 * middleware scopes such a request's driver as `roles: ["anon"]` but sets no
 * `user`, so the fallback here has to be the same list the driver was scoped
 * with, not nothing.
 *
 * @param c anything carrying the Hono context's `get` — the batch route passes a
 *          shim rather than the context itself, exactly as the API-key
 *          permission check does.
 */
export function requestViewer(c: { get: (key: never) => unknown }): FieldViewer {
    const user = c.get("user" as never) as { roles?: readonly string[] } | undefined;
    return { roles: user?.roles ?? ANON_ROLES };
}

/** What the auth middleware scopes an unauthenticated request's driver with. */
const ANON_ROLES: readonly string[] = Object.freeze(["anon"]);

/** Which query parameter a refused field arrived in, for the message. */
type Where = "filter" | "orderBy" | "fields" | "select" | "groupBy";

const WHERE_LABEL: Record<Where, string> = {
    filter: "a filter",
    orderBy: "`orderBy`",
    fields: "`fields`",
    select: "`select`",
    groupBy: "`groupBy`"
};

/** Every column a logical group compares, however deeply nested. */
function logicalColumns(logical: LogicalCondition | undefined, into: string[]): void {
    if (!logical?.conditions) return;
    for (const condition of logical.conditions) {
        if ("conditions" in condition) logicalColumns(condition as LogicalCondition, into);
        else if ((condition as FilterCondition).column) into.push((condition as FilterCondition).column);
    }
}

/**
 * The bare column an `orderBy` key names, or `undefined` for one that is not a
 * column at all.
 *
 * A sort key may be a relation aggregate (`comments.count()`) or one of the
 * computed keys a search adds (`_score`, `_distance`). Neither is a property of
 * this collection, so neither is a field this rule has anything to say about;
 * the field it *would* have named is checked by the same walk one level down
 * when the driver resolves the relation.
 */
function orderByColumn(field: string): string | undefined {
    if (field.startsWith("_")) return undefined;
    if (field.includes("(") || field.includes(".")) return undefined;
    return field;
}

/**
 * Refuse the request when any of `names` is a field this caller cannot read.
 *
 * Exported so the aggregate route — whose `select` and `groupBy` are parsed
 * outside `parseQueryOptions` — applies the identical rule. `count(*)` over a
 * withheld column is the same disclosure as reading it, one predicate at a time.
 */
export function assertReadableFields(
    names: readonly (string | undefined)[],
    collection: CollectionConfig,
    viewer: FieldViewer | undefined,
    where: Where
): void {
    if (names.length === 0) return;
    const { refused } = restrictedFieldNames(collection, viewer, "read");
    if (refused.size === 0) return;

    const named = [...new Set(names.filter((n): n is string => Boolean(n) && refused.has(n!)))];
    if (named.length === 0) return;

    throw ApiError.badRequest(
        `${named.map(f => `'${f}'`).join(", ")} ${named.length > 1 ? "are" : "is"} not readable ` +
        `on '${collection.slug}' with your roles, so ${named.length > 1 ? "they" : "it"} cannot be used in ` +
        `${WHERE_LABEL[where]}.`,
        "FIELD_NOT_READABLE",
        {
            collection: collection.slug,
            fields: named,
            violations: named.map(field => ({
                field,
                code: "access",
                message: `'${field}' is not readable with your roles.`
            }))
        }
    );
}

/**
 * The whole of a parsed read request, checked in one pass.
 *
 * One call rather than five, because five call sites is five chances to add a
 * sixth query parameter and forget it — which is exactly how `?or=` came to be
 * parsed and then dropped by the list route.
 */
export function assertQueryFieldsReadable(
    options: {
        where?: Record<string, unknown>;
        logical?: LogicalCondition;
        orderBy?: { field: string }[];
        fields?: string[];
    },
    collection: CollectionConfig,
    viewer: FieldViewer | undefined
): void {
    const filtered: string[] = [];
    if (options.where) filtered.push(...Object.keys(options.where));
    logicalColumns(options.logical, filtered);
    assertReadableFields(filtered, collection, viewer, "filter");

    assertReadableFields(
        (options.orderBy ?? []).map(entry => orderByColumn(entry.field)),
        collection, viewer, "orderBy"
    );

    assertReadableFields(options.fields ?? [], collection, viewer, "fields");
}
