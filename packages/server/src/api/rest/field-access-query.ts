import type { CollectionConfig, IncludeSpec } from "@rebasepro/types";
import { type FilterCondition, type LogicalCondition, parseRelationAggregateSort } from "@rebasepro/types";
import {
    apiHiddenFieldNames,
    type FieldViewer,
    findRelation,
    includableRelationNames,
    type IncludeNode,
    normalizeInclude,
    queryableFieldNames,
    resolveCollectionRelations,
    restrictedFieldNames,
    type UnknownFieldAnswer,
    unknownFilterField,
    unknownIncludeRelation,
    unknownOrderByField,
    unknownProjectionField,
    unknownRelationTargetField
} from "@rebasepro/common";
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
 * The refusal names a field restricted by role. That is deliberate and it is
 * not a leak: the published OpenAPI lists every property of every collection,
 * including the ones a given caller cannot read, because the document is one
 * document and is served off the app rather than off the authenticated data
 * router. Hiding the name here would protect nothing and would answer a
 * caller's genuine typo with "unknown field", sending them to look for a
 * spelling mistake that is not there. Those field *names* are public; their
 * *values* are not.
 *
 * An `excludeFromApi` field is the exception, because its name is *not*
 * public: OpenAPI, `list_collections` and the generated SDK all leave it out.
 * "`email` is not readable on `authors`" would confirm the one thing those hide,
 * so a filter, sort, projection or include naming one is answered as one naming
 * a field that does not exist — built by the functions the driver answers a
 * typo with (`@rebasepro/common`'s `unknown-field`), so the two answers are the
 * same bytes. See {@link assertNoHiddenNames}.
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
type Where = "filter" | "orderBy" | "fields" | "select" | "groupBy" | "vector_search";

/**
 * The parameters an `excludeFromApi` name is answered in as an unknown field
 * (by {@link assertNoHiddenNames}) rather than as an unreadable one. The others
 * — `select`, `groupBy`, `vector_search` — have no unknown-field answer shared
 * with the driver yet, so a hidden name there is still refused as unreadable.
 */
const ANSWERED_AS_UNKNOWN: ReadonlySet<Where> = new Set<Where>(["filter", "orderBy", "fields"]);

const WHERE_LABEL: Record<Where, string> = {
    filter: "a filter",
    orderBy: "`orderBy`",
    fields: "`fields`",
    select: "`select`",
    groupBy: "`groupBy`",
    vector_search: "`vector_search`"
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
    const hidden = ANSWERED_AS_UNKNOWN.has(where) ? apiHiddenFieldNames(collection) : undefined;

    const named = [...new Set(names.filter((n): n is string =>
        n !== undefined && refused.has(n) && !hidden?.has(n)))];
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
        include?: IncludeSpec;
        vectorSearch?: { property: string };
    },
    collection: CollectionConfig,
    viewer: FieldViewer | undefined
): void {
    const filtered = assertRestrictedFieldsUnused(options, collection, viewer);

    // After every refusal, as the driver's unknown-field answers come after
    // them: a hidden name is a typo the driver has not reached yet.
    const include = options.include !== undefined ? normalizeInclude(options.include) : undefined;
    assertNoHiddenNames({ ...options, filtered, include: include?.tree }, collection);
}

/**
 * Refuse every field restricted by role that the read names, at every level of
 * its include tree. Returns the filter's column names, for the hidden pass.
 */
function assertRestrictedFieldsUnused(
    options: Parameters<typeof assertQueryFieldsReadable>[0],
    collection: CollectionConfig,
    viewer: FieldViewer | undefined
): string[] {
    const filtered: string[] = [];
    if (options.where) filtered.push(...Object.keys(options.where));
    logicalColumns(options.logical, filtered);
    assertReadableFields(filtered.map(filterHead), collection, viewer, "filter");
    assertRelationPathsReadable(filtered, collection, viewer);

    assertReadableFields(
        (options.orderBy ?? []).map(entry => orderByColumn(entry.field)),
        collection, viewer, "orderBy"
    );
    assertAggregateSortsReadable(options.orderBy ?? [], collection, viewer);

    assertReadableFields(options.fields ?? [], collection, viewer, "fields");

    // A similarity search reads the vector it ranks by: `_distance` from a
    // point the caller chose is a measurement of it, enough of them locate it,
    // and `vector_threshold` alone answers "is it within r of here".
    assertReadableFields(
        options.vectorSearch ? [options.vectorSearch.property] : [],
        collection, viewer, "vector_search"
    );

    const include = options.include !== undefined ? normalizeInclude(options.include) : undefined;
    if (include) assertIncludeFieldsReadable(include.tree, collection, viewer);
    return filtered;
}

/**
 * The field a filter key reads on *this* collection: the column before a JSON
 * path's first arrow (`metadata->theme` reads `metadata`), the relation before
 * a relation path's dot (`author.email` reads `author`), the key itself
 * otherwise. A key that is a property outright wins, as the driver resolves it.
 */
function filterHead(name: string): string {
    const arrow = name.indexOf("->");
    if (arrow > 0) return name.slice(0, arrow);
    const dot = name.indexOf(".");
    if (dot > 0) return name.slice(0, dot);
    return name;
}

/**
 * `orderBy=max(staff.salary)` ranks the parents by the target's `salary` — the
 * same reading `orderBy=salary` on `staff` is — so the aggregated field is
 * judged by the target's rule. Whether the relation itself may be read is the
 * driver's check (`assertRelationReadable`), which runs on every door.
 */
function assertAggregateSortsReadable(
    orderBy: readonly { field: string }[],
    collection: CollectionConfig,
    viewer: FieldViewer | undefined
): void {
    let relations: ReturnType<typeof resolveCollectionRelations> | undefined;
    for (const { field } of orderBy) {
        const spec = parseRelationAggregateSort(field);
        if (!spec?.field) continue;
        relations ??= resolveCollectionRelations(collection);
        const relation = findRelation(relations, spec.relation);
        if (!relation) continue;
        assertReadableFields([spec.field], relation.target(), viewer, "orderBy");
    }
}

/**
 * `?author.salary=gt.100000` reads the target's `salary`, a row at a time, as
 * `?salary=gt.100000` on `authors` would — so it is judged by the target's
 * rule. Only a path whose first segment is a relation here; anything else is
 * the driver's to refuse.
 */
function assertRelationPathsReadable(
    filtered: readonly string[],
    collection: CollectionConfig,
    viewer: FieldViewer | undefined
): void {
    let relations: ReturnType<typeof resolveCollectionRelations> | undefined;
    for (const name of filtered) {
        const dot = name.indexOf(".");
        if (dot <= 0 || name.indexOf("->") >= 0) continue;
        relations ??= resolveCollectionRelations(collection);
        const relation = findRelation(relations, name.slice(0, dot));
        if (!relation) continue;
        assertReadableFields([name.slice(dot + 1)], relation.target(), viewer, "filter");
    }
}

/**
 * Answer a read naming an `excludeFromApi` field — or relation — exactly as the
 * driver answers a read naming a field that does not exist.
 *
 * The names are walked in the order the driver resolves them — the `fields`
 * projection, then the filter, then the sort, then each include, parent before
 * child — and the first that is hidden *or* unknown gets the answer. Answering
 * only the hidden one would still tell the two apart: with `?aaa=x&email=x` the
 * driver names `aaa` when `email` does not exist, so this has to as well.
 *
 * A request naming nothing hidden is left alone entirely, so the driver stays
 * the only one answering ordinary typos.
 */
function assertNoHiddenNames(
    options: {
        filtered: string[];
        orderBy?: { field: string }[];
        fields?: string[];
        include?: Record<string, IncludeNode>;
    },
    collection: CollectionConfig
): void {
    const hidden = apiHiddenFieldNames(collection);
    if (hidden.size > 0) {
        const asked: { kind: "fields" | "filter" | "orderBy"; name: string }[] = [
            ...(options.fields ?? []).map(name => ({ kind: "fields" as const, name })),
            ...options.filtered.map(name => ({ kind: "filter" as const, name })),
            ...(options.orderBy ?? []).flatMap(entry => {
                const name = orderByColumn(entry.field);
                return name === undefined ? [] : [{ kind: "orderBy" as const, name }];
            })
        ];
        const shapes = asked.map(({ kind, name }) => ({ kind, name, shape: nameShape(name, collection, hidden) }));
        if (shapes.some(entry => entry.shape.hidden)) {
            for (const { kind, name, shape } of shapes) {
                if (shape.known && !shape.hidden) continue;
                const answer = unknownAnswer(kind, name, shape, collection);
                throw ApiError.badRequest(answer.message, answer.code, answer.details);
            }
        }
    }

    const relations = resolveCollectionRelations(collection);
    for (const [key, node] of Object.entries(options.include ?? {})) {
        if (hidden.has(key)) {
            const answer = unknownIncludeRelation(key, collection.slug ?? collection.name, includableRelationNames(collection));
            throw ApiError.badRequest(answer.message, answer.code, answer.details);
        }
        const relation = relations[key];
        if (!relation) continue;
        const filtered: string[] = [];
        if (node.where) filtered.push(...Object.keys(node.where));
        logicalColumns(node.logical, filtered);
        assertNoHiddenNames({
            filtered,
            orderBy: node.orderBy?.map(([field]) => ({ field })),
            fields: node.fields,
            include: node.children
        }, relation.target());
    }
}

/**
 * What a name in a read resolves to, as far as a collection can say without its
 * table: `hidden` when it reaches an `excludeFromApi` field or relation, `known`
 * when it names something the driver will resolve. A relation path
 * (`author.email`) carries its relation, to be answered about the target.
 */
type NameShape = {
    hidden: boolean;
    known: boolean;
    path?: { relationKey: string; fieldKey: string; target: CollectionConfig };
};

function nameShape(name: string, collection: CollectionConfig, hidden: ReadonlySet<string>): NameShape {
    if (hidden.has(name)) return { hidden: true, known: false };
    const columns = new Set(queryableFieldNames(collection));
    const relations = resolveCollectionRelations(collection);
    if (columns.has(name) || name in (collection.properties ?? {})) return { hidden: false, known: true };

    // `metadata->theme`: the column before the first arrow is what it names.
    const arrow = name.indexOf("->");
    if (arrow > 0) {
        const head = name.slice(0, arrow);
        return { hidden: hidden.has(head), known: columns.has(head) };
    }

    // `author.email`: a field of the relation's target.
    const dot = name.indexOf(".");
    if (dot > 0) {
        const relationKey = name.slice(0, dot);
        const fieldKey = name.slice(dot + 1);
        if (hidden.has(relationKey)) return { hidden: true, known: false };
        const relation = findRelation(relations, relationKey);
        if (!relation) return { hidden: false, known: false };
        const target = relation.target();
        const targetHidden = apiHiddenFieldNames(target);
        const path = { relationKey, fieldKey, target };
        if (targetHidden.has(fieldKey)) return { hidden: true, known: false, path };
        const known = queryableFieldNames(target).includes(fieldKey) || fieldKey in (target.properties ?? {});
        return { hidden: false, known, path };
    }
    return { hidden: false, known: false };
}

function unknownAnswer(
    kind: "fields" | "filter" | "orderBy",
    name: string,
    shape: NameShape,
    collection: CollectionConfig
): UnknownFieldAnswer {
    const slug = collection.slug ?? collection.name;
    if (kind === "fields") return unknownProjectionField(name, slug, queryableFieldNames(collection));
    if (kind === "orderBy") return unknownOrderByField(name, slug, queryableFieldNames(collection));
    if (shape.path) {
        return unknownRelationTargetField(
            { field: name, relationKey: shape.path.relationKey, fieldKey: shape.path.fieldKey },
            { slug: shape.path.target.slug, validFields: queryableFieldNames(shape.path.target) },
            slug
        );
    }
    return unknownFilterField(name, slug, queryableFieldNames(collection));
}

/**
 * Every relation an `include` loads, judged like the read it is part of.
 *
 * An include's own `where`, `logical`, `orderBy` and `fields` read the columns
 * of the relation's *target*: `?include={"staff":{"where":{"salary":[">",100000]}}}`
 * answers which departments employ someone paid over 100k, and `orderBy` with a
 * `limit` of one names who — while `?salary=gt.100000` on `staff` itself is
 * refused. So each node is checked against its target's rules, level by level.
 *
 * A name that is not a relation of the collection is skipped rather than
 * refused here: the driver refuses it with a 400 naming the relations there
 * are, and loads nothing for it. Looked up by exact key, as the driver does, so
 * both judge the same relation.
 */
function assertIncludeFieldsReadable(
    tree: Record<string, IncludeNode>,
    collection: CollectionConfig,
    viewer: FieldViewer | undefined
): void {
    const relations = resolveCollectionRelations(collection);
    for (const [key, node] of Object.entries(tree)) {
        const relation = relations[key];
        if (!relation) continue;
        const target = relation.target();
        assertRestrictedFieldsUnused({
            where: node.where,
            logical: node.logical,
            orderBy: node.orderBy?.map(([field]) => ({ field })),
            fields: node.fields
        }, target, viewer);
        assertIncludeFieldsReadable(node.children, target, viewer);
    }
}
