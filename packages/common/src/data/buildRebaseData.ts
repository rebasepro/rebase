import { CollectionAccessor, DataDriver, Entity, EntityValues, FindAllParams, FindParams, FindResponse, FindResult, IterateParams, LogicalCondition, OrderByTuple, PageWalkOptions, RebaseApiError, RebaseData, RebaseSdkData, RelationAggregateSort, SDKCollectionClient, SDKQueryBuilderInterface, sortKeyToString, type AggregateParams, type AggregateRow, type AggregateSelect, type ComputedSortField, type FieldPath, type IncludeSpec, type NonColumnFieldPath, type NullsPlacement, type SearchMatch, type UpdateValues, type UpsertOptions, WhereFilterOp, WhereValueFor, isUnsupported, unsupportedMethod } from "@rebasepro/types";
import { toSnakeCase, toWireKey } from "@rebasepro/utils";
import { cursorToStartAfter, decodeCursor, reconcileCursorOrder } from "./cursor";
import { mergeIncludeSpecs } from "./include-spec";
import { QueryBuilder } from "./query_builder";
import { collectAllPages, paginateFind, resolveFindWindow } from "./paginate";
import { normalizeOrderBy } from "./sort-dialect";
import { deserializeFilter } from "./filter-dialect";
import { buildCompositeId, resolvePrimaryKeys, PrimaryKeyInfo } from "../util/identity";
import { resolveCollectionRelations } from "../util/relations";
import { EntityRelation } from "@rebasepro/types";

/**
 * What a client says when its data source cannot subscribe.
 *
 * Named rather than inlined so the sentence a caller sees does not depend on
 * which of the two adapters below happened to build the client.
 */
const noRealtime = (slug: string): string =>
    `Realtime is not available for "${slug}": its data source does not support subscriptions.`;

/** What a client says when its data source cannot count. */
const noCount = (slug: string): string =>
    `Counting is not available for "${slug}": its data source does not support it.`;

/**
 * Derive the response key an aggregate comes back under.
 *
 * `sum(total)` → `sum_total`, `count()` → `count`. Written once, here, because
 * the REST parser derives the same alias from `?select=sum(total)` and the two
 * have to agree — a caller reading `row.sum_total` off an SDK result and off an
 * HTTP response is reading the same key or the SDK is broken.
 */
export function aggregateAlias(fn: string, field?: string): string {
    return field ? `${fn}_${field}` : fn;
}

function toDriverAggregate(
    select: AggregateSelect<Record<string, unknown>>
): { fn: "count" | "sum" | "avg" | "min" | "max"; field?: string; alias: string } {
    const field = select.field as string | undefined;
    return { fn: select.fn, field, alias: aggregateAlias(select.fn, field) };
}

/**
 * What a client says when its data source cannot aggregate.
 *
 * A stub rather than a fallback that fetches and reduces in JavaScript: that
 * would be wrong under a `limit` and unaffordable without one, and it would look
 * like it had worked.
 */
const noAggregate = (slug: string): string =>
    `Aggregates are not available for "${slug}": its data source does not implement them.`;

export interface EntityDataOptions {
    /**
     * Look up a collection's config by slug, to derive row addresses from its
     * primary keys.
     *
     * Called lazily rather than up front: the data layer is created by `Rebase`,
     * which sits *above* the admin that owns the collections, so a resolver
     * registered on mount would otherwise arrive too late to be seen.
     */
    resolveCollection?: (slug: string) => { properties?: Record<string, unknown>; relations?: unknown[]; slug?: string } | undefined;
}

function createPrimaryKeyResolver(options?: EntityDataOptions) {
    const cache = new Map<string, PrimaryKeyInfo[]>();
    const warned = new Set<string>();

    return function primaryKeysFor(slug: string): PrimaryKeyInfo[] {
        const cached = cache.get(slug);
        if (cached) return cached;

        const collection = options?.resolveCollection?.(slug);
        if (!collection) {
            // The registry may not have been registered yet. Don't memoize a
            // miss, or the collection would stay address-less for this session.
            return [];
        }

        const keys = resolvePrimaryKeys(collection);
        if (keys.length > 0) {
            // Memoized for the session: a collection's key does not change
            // while the app runs, and this is called once per row. Editing
            // `isId` in the schema editor needs a reload to take effect here.
            cache.set(slug, keys);
            return keys;
        }

        if (!warned.has(slug)) {
            warned.add(slug);
            // Silence here surfaces much later as rows that cannot be opened,
            // linked, or saved, with nothing pointing back at the cause.
            console.warn(
                `[rebase] Collection '${slug}' declares no primary key, so its rows have no address: ` +
                `detail links, caching and relations will not work for it. ` +
                `Mark the key property with \`isId\` in its collection config — the server logs which ` +
                `column to mark at boot, if its schema knows the key.`
            );
        }
        return keys;
    };
}

/**
 * Build the admin's view model out of the row the wire serves.
 *
 * The wire has ONE shape, for every consumer: flat columns, typed the way the
 * database typed them, and a relation rendered as the target's own columns (or
 * only its foreign key, when nothing asked for it). That is the REST contract,
 * what `find()` returns, what `listen()` pushes, and what the generated types
 * describe.
 *
 * The admin renders neither of those directly. Its date field requires a real
 * `Date` and rejects a string outright; its relation cells read `.data.values`
 * off a relation ref. Those requirements are the *admin's*, so they are met
 * here — in the browser, from the collection config the panel already has —
 * rather than by asking the server for a second wire shape.
 *
 * That second shape is what this replaces. Until 2026-09-09 the realtime wire
 * carried the view model and every other read carried flat rows, so `find()`
 * and `listen()` answered one query two ways; unifying the wire without doing
 * this conversion is what left every date cell reading "Invalid date value"
 * and every relation cell "Unexpected value".
 *
 * Values already in view-model form pass through untouched: a driver that
 * still sends `{ __type: "date" }` or a relation ref (the client revives both)
 * is served by the same walk.
 */
function toViewModelValues(
    values: Record<string, unknown>,
    properties: Record<string, unknown> | undefined,
    collection: { properties?: Record<string, unknown>; relations?: unknown[]; slug?: string } | undefined,
    resolveCollection?: EntityDataOptions["resolveCollection"]
): Record<string, unknown> {
    if (!properties) return values;

    const relations = collection
        ? resolveCollectionRelations(collection as never)
        : {};
    let out: Record<string, unknown> | undefined;
    const write = (key: string, value: unknown) => {
        out = out ?? { ...values };
        out[key] = value;
    };

    for (const [key, rawProperty] of Object.entries(properties)) {
        const property = rawProperty as { type?: string; of?: { type?: string }; properties?: Record<string, unknown> } | undefined;
        if (!property) continue;

        // A relation nobody included is still a relation: the row carries only
        // its foreign key, and an addressable ref with no data attached is what
        // lets the preview fetch the one record it needs. Without this the
        // record form showed an empty chip where the customer goes — the panel
        // reads a form through `listenById`, which takes no `include`.
        if (!(key in values)) {
            const fkRelation = relations[key];
            // `localKey` is the column; the row is keyed the way the wire keys
            // it, which is that column camelCased (`customer_id` → `customerId`).
            const column = fkRelation && "localKey" in fkRelation ? fkRelation.localKey : undefined;
            const fk = column !== undefined
                ? values[column] ?? values[toWireKey(column)]
                : undefined;
            const fkTarget = fkRelation?.targetSlug;
            if (fkTarget && (typeof fk === "string" || typeof fk === "number")) {
                write(key, new EntityRelation(fk, fkTarget));
            }
            continue;
        }

        const value = values[key];
        if (value === null || value === undefined) continue;

        // A relation, under the property key or the relation name.
        const relation = relations[key];
        if (relation && (property.type === "relation" || property.of?.type === "relation" || property.type === "array")) {
            const target = relation.targetSlug;
            if (!target) continue;
            const targetProperties = resolveCollection?.(target)?.properties;
            const targetCollection = resolveCollection?.(target);
            const toRef = (item: unknown): unknown => {
                if (item instanceof EntityRelation) return item;
                if (typeof item === "object" && item !== null && "__type" in item) return item;
                // The target's own columns: the id it is addressed by, and the
                // values a relation cell renders without a second fetch.
                if (typeof item === "object" && item !== null) {
                    const row = item as Record<string, unknown>;
                    const keys = targetCollection ? resolvePrimaryKeys(targetCollection as never) : [];
                    const id = keys.length > 0 ? buildCompositeId(row, keys) : row.id as string | number;
                    if (id === undefined || id === null || id === "") return item;
                    return new EntityRelation(id, target, {
                        id,
                        path: target,
                        values: toViewModelValues(row, targetProperties, targetCollection, resolveCollection)
                    });
                }
                // Only the foreign key came back — nothing asked for the
                // relation. Addressable, with nothing to render but its id.
                if (typeof item === "string" || typeof item === "number") {
                    return new EntityRelation(item, target);
                }
                return item;
            };
            write(key, Array.isArray(value) ? value.map(toRef) : toRef(value));
            continue;
        }

        if (property.type === "date" && !(value instanceof Date)) {
            if (typeof value === "string" || typeof value === "number") {
                const date = new Date(value);
                write(key, isNaN(date.getTime()) ? null : date);
            }
            continue;
        }

        // A map's children are declared too, and a date two levels down is
        // still a date.
        if (property.type === "map" && property.properties && typeof value === "object" && !Array.isArray(value)) {
            write(key, toViewModelValues(value as Record<string, unknown>, property.properties, undefined, resolveCollection));
        }
    }

    return out ?? values;
}

/**
 * Give a flat row the Entity view-model the admin renders.
 *
 * The address is *derived here* — it is not a column, and the row it came from
 * does not contain one. Rows carry exactly what the table has, with the types
 * Postgres returned; the id is this layer's invention, and this is the only
 * place it is minted.
 *
 * `primaryKeys` empty falls back to a literal `id` on the row: drivers other
 * than postgres still serve rows with one, and this keeps them working.
 */
function rowToEntity<M extends Record<string, unknown>>(
    row: Record<string, unknown>,
    slug: string,
    primaryKeys: PrimaryKeyInfo[] = [],
    /**
     * Turns the wire's row into the view model — see
     * {@link toViewModelValues}. Absent when the collections cannot be
     * resolved, which is every consumer that is not the admin: the flat SDK
     * derives itself from this layer and must keep the wire's own types.
     */
    toViewModel?: (values: Record<string, unknown>) => Record<string, unknown>
): Entity<M> {
    // Query-computed metadata rides in on the row because that is how the wire
    // carries it, but it is not a column: it belongs beside `values`, not in
    // them. Left inside, `_matches` would show up in the record inspector as a
    // field the collection never declared.
    const { _matches, ...values } = row as Record<string, unknown> & { _matches?: SearchMatch[] };

    return {
        id: primaryKeys.length > 0
            ? buildCompositeId(row, primaryKeys)
            : row.id as string | number,
        path: slug,
        values: (toViewModel ? toViewModel(values) : values) as EntityValues<M>,
        ...(_matches ? { searchMatches: _matches } : {})
    };
}

/**
 * The relation envelope `toFlatRow` writes where a relation was:
 * `{ id, path, __type: "relation", data: { id, path, values } }`. It is the
 * admin's view-model, and the only pipeline that produces one is postgres'.
 */
function isRelationEnvelope(
    value: unknown
): value is { __type: "relation"; data?: { values?: Record<string, unknown> } } {
    return typeof value === "object"
        && value !== null
        && !Array.isArray(value)
        && (value as { __type?: unknown }).__type === "relation";
}

/** The target's own columns, as `toRestRow` would have inlined them. */
function inlineEnvelope(envelope: { data?: { values?: Record<string, unknown> } }): Record<string, unknown> {
    return envelope.data?.values ?? {};
}

/**
 * Replace every relation envelope on a row with the target's flat columns.
 *
 * The SDK serves one relation shape — the inlined one (see
 * {@link RestFetchService}) — and Postgres now serves it on every read, so
 * against that driver this walk finds nothing to do. It stays for the drivers
 * whose own `fetchCollection` still answers with refs: a developer reading
 * through this accessor gets one shape whichever driver is underneath.
 *
 * Only applied where the REST pipeline is the contract (see `find`); a driver
 * without a `restFetchService` keeps whatever it returns.
 *
 * Note this is NOT how the admin gets its view model — that is built in the
 * browser by {@link toViewModelValues}, from the same flat row.
 */
function inlineRelationRefs(row: Record<string, unknown>): Record<string, unknown> {
    let out: Record<string, unknown> | undefined;
    for (const [key, value] of Object.entries(row)) {
        if (isRelationEnvelope(value)) {
            out = out ?? { ...row };
            out[key] = inlineEnvelope(value);
        } else if (Array.isArray(value) && value.some(isRelationEnvelope)) {
            out = out ?? { ...row };
            out[key] = value.map((item) => isRelationEnvelope(item) ? inlineEnvelope(item) : item);
        }
    }
    return out ?? row;
}

function createDriverAccessor<M extends Record<string, unknown> = Record<string, unknown>>(
    driver: DataDriver,
    slug: string,
    getPks: () => PrimaryKeyInfo[] = () => [],
    toViewModel?: (values: Record<string, unknown>) => Record<string, unknown>
): CollectionAccessor<M> {
    const accessor: CollectionAccessor<M> = {
        async find(params?: FindParams<M>): Promise<FindResponse<M>> {
            // Ensure filters are in canonical [op, value] format even if passed as PostgREST strings
            const filter = params?.where ? deserializeFilter(params.where as Record<string, unknown>) : undefined;
            const { limit, offset, driverOffset } = resolveFindWindow(params);

            // Keyset paging, through the same codec and the same driver
            // comparison the HTTP route uses. The in-process accessor is a
            // transport like any other: a walk that seeked differently here
            // than over the wire would be a difference the types cannot see.
            const cursor = params?.after ? decodeCursor(params.after) : undefined;
            const orderBy = cursor
                ? reconcileCursorOrder(cursor, normalizeOrderBy(params?.orderBy))
                : normalizeOrderBy(params?.orderBy);
            const startAfter = cursor ? cursorToStartAfter(cursor) : undefined;

            // One relation shape, whatever the call looks like.
            //
            // This used to fork on `include`: asking for one ran the REST
            // pipeline, which inlines a relation as the target's own columns;
            // not asking ran the driver's own fetch, which eagerly loaded
            // *every* relation and put a `{ __type: "relation" }` envelope
            // where the foreign key was. The same method answered in two
            // shapes, the generated types described only one, and a column
            // typed `string` arrived as an object.
            //
            // The REST pipeline is the published contract — the shape the HTTP
            // API serves for this same query, and what `RestFetchService`
            // documents — so every read goes through it when the driver has
            // one. Drivers without one (every browser driver, and so the
            // admin's own path through `buildRebaseData`) are untouched.
            //
            // One row past the page, when seeking.
            //
            // `hasMore` on an offset page is `offset + rows.length < total`, and
            // under a cursor that arithmetic is simply false: every seeked page
            // runs at offset 0, so it compares one page against the whole
            // collection and says "more" forever. Asking for `limit + 1` and
            // looking at whether the extra row arrived is the answer keyset
            // paging actually has — and it costs nothing, where the count it
            // replaces was a second query per page.
            const probeLimit = startAfter ? limit + 1 : limit;

            const fetchService = driver.restFetchService;
            const fetched = fetchService
                ? await fetchService.fetchCollectionForRest(
                    slug,
                    {
                        filter,
                        // Without this the group was dropped and the read ran
                        // unfiltered — every row the caller's policies allow,
                        // in place of the ones they asked for.
                        logical: params?.logical,
                        limit: probeLimit,
                        // A cursor and an offset describe the same window two
                        // incompatible ways; seeking wins and the offset is not
                        // sent, or the page would start `offset` rows past
                        // where the cursor pointed.
                        offset: startAfter ? undefined : driverOffset,
                        startAfter,
                        orderBy,
                        searchString: params?.searchString,
                        fields: params?.fields,
                        distinct: params?.distinct
                    },
                    params?.include
                )
                : await driver.fetchCollection<M>({
                    path: slug,
                    limit: probeLimit,
                    offset: startAfter ? undefined : driverOffset,
                    startAfter,
                    filter,
                    logical: params?.logical,
                    orderBy,
                    searchString: params?.searchString,
                    include: params?.include,
                    fields: params?.fields,
                    distinct: params?.distinct
                });

            // The probe row is evidence, not data — it is never served.
            const seeking = startAfter !== undefined;
            const rows = seeking ? fetched.slice(0, limit) : fetched;

            // Compute real total when count is available
            let total = rows.length + offset;
            let hasMore = seeking ? fetched.length > limit : rows.length >= limit;
            if (driver.count) {
                // The same narrowing the rows were read with. Counting only by
                // `filter` reported the whole collection beside a narrowed
                // page, and `hasMore` is derived from it — so the list offered
                // a next page that did not exist.
                total = await driver.count({
                    path: slug,
                    filter,
                    logical: params?.logical,
                    searchString: params?.searchString
                });
                // ...but only for an *offset* page. `offset` is 0 on every
                // seeked page, so this arithmetic compares one page against the
                // whole collection and says "more" forever; the probe row above
                // is what answers it under a cursor.
                if (!seeking) hasMore = offset + rows.length < total;
            }

            // The cursor for the *next* page, from the last row served. Issued
            // by the driver, which is the only layer that knows which columns
            // address a row; absent where it cannot describe one, and the
            // caller then pages by offset.
            const last = rows[rows.length - 1] as Record<string, unknown> | undefined;
            const nextCursor = (hasMore && last && driver.restFetchService?.cursorFor)
                ? driver.restFetchService.cursorFor(slug, last, orderBy)
                : undefined;

            return {
                data: rows.map((row: Record<string, unknown>) => rowToEntity<M>(row, slug, getPks(), toViewModel)),
                meta: { total, limit, offset, hasMore, ...(nextCursor && { nextCursor }) }
            };
        },

        async findById(id: string | number): Promise<Entity<M> | undefined> {
            // Same contract as `find` above: one row read the same way the
            // collection read is, so `find()[0]` and `findById()` agree.
            const fetchService = driver.restFetchService;
            const row = fetchService
                ? await fetchService.fetchOneForRest(slug, id)
                : await driver.fetchOne<M>({ path: slug, id: id });
            return row ? rowToEntity<M>(row, slug, getPks(), toViewModel) : undefined;
        },

        // Present only when the driver's fetch service implements it — the SDK
        // wrapper turns an absent one into a stub that names the capability.
        aggregate: driver.restFetchService?.aggregate
            ? async (params: AggregateParams<M>): Promise<AggregateRow[]> =>
                driver.restFetchService!.aggregate!(slug, {
                    aggregates: params.select.map(toDriverAggregate),
                    groupBy: params.groupBy as string[] | undefined,
                    filter: params.where
                        ? deserializeFilter(params.where as Record<string, unknown>)
                        : undefined,
                    logical: params.logical,
                    searchString: params.searchString,
                    limit: params.limit
                })
            : undefined,

        async create(data: Partial<EntityValues<M>>, id?: string | number): Promise<Entity<M>> {
            const row = await driver.save<M>({
                path: slug,
                values: data,
                id: id,
                status: "new"
            });
            return rowToEntity<M>(row, slug, getPks(), toViewModel);
        },

        createMany: driver.saveMany
            ? async (
                data: Partial<EntityValues<M>>[],
                options?: { upsert?: boolean; onConflict?: readonly string[] }
            ): Promise<Entity<M>[]> => {
                const rows = await driver.saveMany!<M>({
                    path: slug,
                    rows: data,
                    upsert: options?.upsert,
                    // Dropped here, an `upsert` on a natural key silently
                    // became an upsert on the primary key — which for a serial
                    // id is a plain insert, so the re-runnable import the
                    // option exists for duplicated every row instead.
                    onConflict: options?.onConflict
                });
                return rows.map((row) => rowToEntity<M>(row, slug, getPks(), toViewModel));
            }
            : undefined,

        async update(id: string | number, data: Partial<EntityValues<M>>): Promise<Entity<M>> {
            const row = await driver.save<M>({
                path: slug,
                values: data,
                id: id,
                status: "existing"
            });
            return rowToEntity<M>(row, slug, getPks(), toViewModel);
        },

        async delete(id: string | number): Promise<void> {
            return driver.delete({
                row: { id,
path: slug,
values: {} as Record<string, unknown> }
            });
        },

        // Present only when the driver is: exposing these unconditionally and
        // looping single writes underneath would give a caller neither the
        // atomicity nor the single round trip they reached for a batch to get,
        // while looking exactly like it had.
        updateMany: driver.updateMany
            ? async (updates: { id: string | number; data: Partial<EntityValues<M>> }[]): Promise<Entity<M>[]> => {
                const rows = await driver.updateMany!<M>({
                    path: slug,
                    updates: updates.map(u => ({ id: u.id,
values: u.data })),
                });
                return rows.map(row => rowToEntity<M>(row, slug, getPks(), toViewModel));
            }
            : undefined,

        deleteMany: driver.deleteMany
            ? async (ids: (string | number)[]): Promise<void> => {
                await driver.deleteMany!<M>({ path: slug,
ids });
            }
            : undefined,

        count: driver.count
            ? async (params?: FindParams<M>): Promise<number> => {
                const filter = params?.where ? deserializeFilter(params.where as Record<string, unknown>) : undefined;
                // Every narrowing `find()` applies has to apply here too, or
                // the count describes a different query than the one it is
                // reported against.
                return driver.count!({
                    path: slug,
                    filter,
                    logical: params?.logical,
                    searchString: params?.searchString
                });
            }
            : undefined,

        listen: driver.listenCollection
            ? (params: FindParams<M> | undefined, onUpdate: (response: FindResponse<M>) => void, onError?: (error: Error) => void) => {
                const { limit, offset, driverOffset } = resolveFindWindow(params);
                // Belt and braces. Postgres serves one shape on every read now,
                // realtime included, so this flattens nothing there — but a
                // driver whose `listen` still answers with refs is normalized
                // to the shape the rest of this accessor serves rather than
                // handing a developer two.
                const normalize = driver.restFetchService ? inlineRelationRefs : (row: Record<string, unknown>) => row;
                return driver.listenCollection!<M>({
                    path: slug,
                    limit,
                    offset: driverOffset,
                    filter: params?.where,
                    logical: params?.logical,
                    orderBy: normalizeOrderBy(params?.orderBy),
                    searchString: params?.searchString,
                    searchExplain: params?.searchExplain,
                    // Forwarded so the SERVER can refuse it. `realtimeService`
                    // rejects a subscription carrying `vectorSearch` — a
                    // subscription is re-run on every matching write and
                    // nothing there computes distances — and the docs promise
                    // that refusal. Both producers hand-list their fields and
                    // both omitted this one, so the guard could not fire and
                    // `.vectorSearch(…).listen()` returned an ordinary
                    // `id DESC` listing with no `_distance` and no error.
                    vectorSearch: params?.vectorSearch,
                    onUpdate: (entities) => {
                        onUpdate({
                            data: entities.map((row: Record<string, unknown>) => rowToEntity<M>(normalize(row), slug, getPks(), toViewModel)),
                            meta: {
                                // No count is issued on this path, so the total
                                // is unknown; the lower bound is the rows in
                                // hand plus the ones paged past to reach them.
                                // Reporting `entities.length` claimed a read at
                                // offset 100 had found a collection of two.
                                total: offset + entities.length,
                                limit,
                                offset,
                                hasMore: entities.length >= limit
                            }
                        });
                    },
                    onError
                });
            } : undefined,

        listenById: driver.listenOne
            ? (id: string | number, onUpdate: (entity: Entity<M> | undefined) => void, onError?: (error: Error) => void) => {
                const normalize = driver.restFetchService ? inlineRelationRefs : (row: Record<string, unknown>) => row;
                return driver.listenOne!<M>({
                    path: slug,
                    id: id,
                    onUpdate: (entity) => onUpdate(entity ? rowToEntity<M>(normalize(entity), slug, getPks(), toViewModel) : undefined),
                    onError
                });
            } : undefined,

        // Fluent Query Builder
        where(columnOrCondition: string | LogicalCondition, operator?: WhereFilterOp, value?: unknown) {
            const builder = new QueryBuilder<M>(accessor);
            if (typeof columnOrCondition === "object") {
                return builder.where(columnOrCondition);
            }
            return builder.where(columnOrCondition as keyof M & string, operator!, value as WhereValueFor<WhereFilterOp, M[keyof M & string]>);
        },
        orderBy(column: (keyof M & string) | ComputedSortField, ascending?: "asc" | "desc") {
            return new QueryBuilder<M>(accessor).orderBy(column, ascending);
        },
        limit(count: number) {
            return new QueryBuilder<M>(accessor).limit(count);
        },
        offset(count: number) {
            return new QueryBuilder<M>(accessor).offset(count);
        },
        search(searchString: string, options?: { explain?: boolean }) {
            return new QueryBuilder<M>(accessor).search(searchString, options);
        },
        vectorSearch(
            property: string,
            vector: number[],
            options?: { distance?: "cosine" | "l2" | "inner_product"; threshold?: number }
        ) {
            return new QueryBuilder<M>(accessor).vectorSearch(property, vector, options);
        },
        include(...relations: string[]) {
            return new QueryBuilder<M>(accessor).include(...relations);
        }
    };

    return accessor;
}

/**
 * Build a `RebaseData` object from a `DataDriver` using JavaScript Proxy.
 *
 * This is the key bridge: any property access like `data.products` returns
 * a `CollectionAccessor` backed by the underlying DataDriver, without
 * needing per-collection code generation.
 *
 * @example
 * const data = buildRebaseData(driver);
 * await data.products.create({ name: "Camera", price: 299 });
 * const { data: items } = await data.products.find({ where: { status: ["==", "published"] } });
 */
/**
 * The view-model converter for one collection, or `undefined` when there is no
 * collection config to build it from.
 *
 * Absent is the honest answer for every consumer that is not the admin: the
 * flat SDK derives itself from this same layer (`buildSdkData`) and must keep
 * the wire's own types, and it registers no collection resolver.
 */
function createViewModelConverter(options?: EntityDataOptions) {
    if (!options?.resolveCollection) return () => undefined;
    return function converterFor(slug: string) {
        return (values: Record<string, unknown>): Record<string, unknown> => {
            // Resolved per call rather than memoized: the resolver is
            // late-bound (see `createPrimaryKeyResolver`) and a collection
            // edited in the schema editor should not need a reload here.
            const collection = options.resolveCollection?.(slug);
            if (!collection) return values;
            return toViewModelValues(values, collection.properties, collection, options.resolveCollection);
        };
    };
}

export function buildRebaseData(driver: DataDriver, options?: EntityDataOptions): RebaseData {
    const cache = new Map<string, CollectionAccessor>();
    const primaryKeysFor = createPrimaryKeyResolver(options);
    const viewModelFor = createViewModelConverter(options);

    function getAccessor(slug: string): CollectionAccessor {
        let accessor = cache.get(slug);
        if (!accessor) {
            accessor = createDriverAccessor(driver, slug, () => primaryKeysFor(slug), viewModelFor(slug));
            cache.set(slug, accessor);
        }
        return accessor;
    }

    const target = {
        collection: getAccessor
    } as RebaseData;

    return new Proxy(target, {
        get(_target, prop: string | symbol) {
            if (prop === "collection") return getAccessor;
            // Ignore Symbol properties (e.g. Symbol.toPrimitive, Symbol.iterator)
            if (typeof prop === "symbol") return undefined;
            // Ignore internal JS properties
            if (prop === "then" || prop === "toJSON" || prop === "$$typeof") return undefined;

            // Convert camelCase property names to snake_case slugs
            const slug = toSnakeCase(prop);
            return getAccessor(slug);
        }
    });
}

// =============================================================================
// SDK data — flat rows (symmetric with the frontend SDK client)
// =============================================================================

/**
 * Unwrap a Entity back into the flat row it was built from. `rowToEntity` keeps
 * the row untouched under `.values` and derives `.id` alongside it, so dropping
 * the wrapper is the whole operation — the address was never part of the row.
 */
function entityToRow<M extends Record<string, unknown>>(entity: Entity<M>): M {
    return entity.values as M;
}

/**
 * Fluent query builder for the flat SDK data layer. Mirrors {@link QueryBuilder}
 * but resolves to `FindResult<M>` (flat rows) instead of Entity-wrapped
 * `FindResponse<M>`.
 */
class SdkQueryBuilder<M extends Record<string, unknown> = Record<string, unknown>> implements SDKQueryBuilderInterface<M> {
    private params: FindParams = { where: {} };

    constructor(private client: SDKCollectionClient<M>) {}

    where<K extends keyof M & string, Op extends WhereFilterOp>(column: K, operator: Op, value: WhereValueFor<Op, M[K]>): this;
    /** A relation path (`author.name`) or a JSON path (`metadata->>tier`). */
    where(column: NonColumnFieldPath, operator: WhereFilterOp, value: unknown): this;
    where(logicalCondition: LogicalCondition): this;
    where(columnOrCondition: string | LogicalCondition, operator?: WhereFilterOp, value?: unknown): this {
        if (typeof columnOrCondition === "object" && columnOrCondition !== null && "type" in columnOrCondition) {
            // A second group narrows rather than replaces — see the SDK
            // builder in `@rebasepro/client`, which had the same defect.
            const next = columnOrCondition as LogicalCondition;
            this.params.logical = this.params.logical
                ? { type: "and", conditions: [this.params.logical, next] }
                : next;
            return this;
        }
        if (!this.params.where) this.params.where = {};
        const column = columnOrCondition as string;
        const condition: [WhereFilterOp, unknown] = [operator!, value];
        const existing = this.params.where[column];
        if (existing === undefined) {
            this.params.where[column] = condition;
        } else if (Array.isArray(existing) && existing.length > 0 && Array.isArray(existing[0])) {
            (this.params.where[column] as [WhereFilterOp, unknown][]).push(condition);
        } else {
            let firstCondition: [WhereFilterOp, unknown];
            if (Array.isArray(existing) && existing.length === 2 && typeof existing[0] === "string") {
                firstCondition = existing as [WhereFilterOp, unknown];
            } else {
                firstCondition = ["==", existing];
            }
            this.params.where[column] = [firstCondition, condition];
        }
        return this;
    }

    /** Called again, this adds a tie-breaker rather than replacing the sort. */
    orderBy(
        column: FieldPath<M> | ComputedSortField | RelationAggregateSort,
        direction: "asc" | "desc" = "asc",
        nulls?: NullsPlacement
    ): this {
        const existing = normalizeOrderBy(this.params.orderBy) ?? [];
        const key = sortKeyToString(column);
        this.params.orderBy = [...existing, (nulls
            ? [key, direction, nulls]
            : [key, direction]) as OrderByTuple];
        return this;
    }

    limit(count: number): this { this.params.limit = count; return this; }
    offset(count: number): this { this.params.offset = count; return this; }
    search(searchString: string, options?: { explain?: boolean }): this { this.params.searchString = searchString; if (options?.explain !== undefined) this.params.searchExplain = options.explain; return this; }
    vectorSearch(
        property: string,
        vector: number[],
        options?: { distance?: "cosine" | "l2" | "inner_product"; threshold?: number }
    ): this {
        this.params.vectorSearch = {
            property,
            vector,
            ...(options?.distance !== undefined && { distance: options.distance }),
            ...(options?.threshold !== undefined && { threshold: options.threshold })
        };
        return this;
    }
    /**
     * Load relations. Merges rather than replaces, so `.include("author")` then
     * `.include({ comments: { limit: 5 } })` asks for both — a builder call that
     * silently discarded an earlier one is the same defect `where` had.
     */
    include(...relations: (string | IncludeSpec)[]): this {
        this.params.include = mergeIncludeSpecs(this.params.include, relations);
        return this;
    }

    fields(...columns: (FieldPath<M> | string)[]): this {
        this.params.fields = [...(this.params.fields ?? []), ...columns as string[]];
        return this;
    }

    distinct(enabled = true): this { this.params.distinct = enabled; return this; }

    after(cursor: string): this { this.params.after = cursor; return this; }

    async find(): Promise<FindResult<M>> {
        return this.client.find(this.params as FindParams<M>);
    }

    /** Aggregate the matching rows. See {@link SDKCollectionClient.aggregate}. */
    async aggregate(
        params: Omit<AggregateParams<M>, "where" | "logical" | "searchString">
    ): Promise<AggregateRow[]> {
        return this.client.aggregate({
            ...params,
            where: this.params.where as AggregateParams<M>["where"],
            logical: this.params.logical,
            searchString: this.params.searchString
        });
    }

    /**
     * Page through everything this query matches, one row at a time.
     *
     * `.limit()` on the builder becomes the page size, so the ceiling on a
     * single `find()` is not a ceiling on what the query can read.
     */
    iterate(options?: PageWalkOptions<M>): AsyncIterableIterator<M> {
        return this.client.iterate({
            ...(this.params as FindParams<M>),
            ...(this.params.limit !== undefined && { pageSize: this.params.limit }),
            ...options
        } as IterateParams<M>);
    }

    /** Collect everything this query matches into one array. */
    findAll(options?: PageWalkOptions<M> & { maxRows?: number }): Promise<M[]> {
        return this.client.findAll({
            ...(this.params as FindParams<M>),
            ...(this.params.limit !== undefined && { pageSize: this.params.limit }),
            ...options
        } as FindAllParams<M>);
    }

    /**
     * Count the records matching this query.
     *
     * This used to answer `0` when the client had no `count` — a number, from a
     * source that had not counted anything, indistinguishable from an empty
     * collection. It now does what the client does, which on a source that
     * cannot count is throw and say so.
     */
    async count(): Promise<number> {
        return this.client.count(this.params as FindParams<M>);
    }

    listen(onUpdate: (data: FindResult<M>) => void, onError?: (error: Error) => void): () => void {
        return this.client.listen(this.params as FindParams<M>, onUpdate, onError);
    }
}

/**
 * Wrap a Entity-shaped {@link CollectionAccessor} into a flat
 * {@link SDKCollectionClient}. Every returned record is unwrapped to a flat row
 * so the backend SDK is byte-for-byte the same shape as the frontend client.
 */
function toSdkCollectionClient<M extends Record<string, unknown>>(
    snap: CollectionAccessor<M>,
    slug = "collection"
): SDKCollectionClient<M> {
    const client: SDKCollectionClient<M> = {
        async find(params?: FindParams<M>): Promise<FindResult<M>> {
            const res = await snap.find(params);
            return { data: res.data.map(entityToRow), meta: res.meta };
        },
        // Pagination is shared with the HTTP client rather than reimplemented:
        // both transports satisfy the same `SDKCollectionClient`, so a walk that
        // behaved differently in-process than over the wire would be a bug the
        // type system could not see.
        iterate(params?: IterateParams<M>) {
            return paginateFind<M>((p) => client.find(p), params, slug);
        },
        findAll(params?: FindAllParams<M>) {
            return collectAllPages<M>((p) => client.find(p), params, slug);
        },
        async findById(id: string | number): Promise<M | undefined> {
            const s = await snap.findById(id);
            return s ? entityToRow(s) : undefined;
        },
        async get(id: string | number): Promise<M> {
            // The same contract server-side as in the browser SDK, deliberately:
            // a callback, a cron and an app all read a row by id, and the shape
            // of "it is not there" should not depend on which one is asking.
            const s = await snap.findById(id);
            if (!s) {
                throw new RebaseApiError(
                    `No record with id ${JSON.stringify(String(id))} in "${slug}".`,
                    { status: 404, code: "NOT_FOUND" }
                );
            }
            return entityToRow(s);
        },
        async create(data: Partial<M>, id?: string | number): Promise<M> {
            return entityToRow(await snap.create(data as Partial<EntityValues<M>>, id));
        },
        async createMany(data: Partial<M>[], options?: { upsert?: boolean }): Promise<M[]> {
            if (!Array.isArray(data)) {
                throw new TypeError("createMany expects an array of records.");
            }
            if (data.length === 0) return [];
            if (!snap.createMany) {
                throw new Error(
                    "Bulk writes are not supported by this collection's data source. " +
                    "Fall back to create() per record."
                );
            }
            const rows = await snap.createMany(data as Partial<EntityValues<M>>[], options);
            return rows.map(entityToRow);
        },
        /**
         * One row through the bulk path, because the bulk path is where the
         * conflict target lives.
         *
         * `CollectionAccessor` has no single-row upsert and adding one would
         * mean a second way to say the same thing to the same driver method —
         * `saveMany` already takes `upsert` and `onConflict`, and a batch of
         * one is exactly an upsert of one.
         */
        async upsert(data: Partial<M>, options?: UpsertOptions): Promise<M> {
            if (!snap.createMany) {
                throw new Error(
                    "Upsert is not supported by this collection's data source: it needs a bulk write, " +
                    "which this driver does not implement. Fall back to create() or update()."
                );
            }
            const rows = await snap.createMany(
                [data as Partial<EntityValues<M>>],
                { upsert: true, onConflict: options?.onConflict }
            );
            const row = rows[0];
            if (!row) throw new Error(`Upsert into "${slug}" returned no row.`);
            return entityToRow(row);
        },
        async update(id: string | number, data: Partial<M> | UpdateValues<Partial<M>>): Promise<M> {
            return entityToRow(await snap.update(id, data as Partial<EntityValues<M>>));
        },
        async updateMany(updates: { id: string | number; data: Partial<M> | UpdateValues<Partial<M>> }[]): Promise<M[]> {
            if (!Array.isArray(updates)) {
                throw new TypeError("updateMany expects an array of { id, data } entries.");
            }
            if (updates.length === 0) return [];
            if (!snap.updateMany) {
                throw new Error(
                    "Bulk updates are not supported by this collection's data source. " +
                    "Fall back to update() per record."
                );
            }
            const rows = await snap.updateMany(
                updates.map(u => ({ id: u.id,
data: u.data as Partial<EntityValues<M>> }))
            );
            return rows.map(entityToRow);
        },
        delete(id: string | number): Promise<void> {
            return snap.delete(id);
        },
        async deleteMany(ids: (string | number)[]): Promise<void> {
            if (!Array.isArray(ids)) {
                throw new TypeError("deleteMany expects an array of ids.");
            }
            if (ids.length === 0) return;
            if (!snap.deleteMany) {
                throw new Error(
                    "Bulk deletes are not supported by this collection's data source. " +
                    "Fall back to delete() per record."
                );
            }
            await snap.deleteMany(ids);
        },
        // The three are non-optional on `SDKCollectionClient`: where the
        // underlying accessor cannot serve one, a stub says so when called
        // rather than being absent. `isUnsupported()` is how an adapter asks
        // the capability question — see `toEntityAccessor` below, which has to.
        count: snap.count
            ? (params?: FindParams<M>) => snap.count!(params)
            : unsupportedMethod(noCount(slug)),
        listen: snap.listen
            ? (params: FindParams<M> | undefined, onUpdate: (r: FindResult<M>) => void, onError?: (e: Error) => void) =>
                snap.listen!(params, (res) => onUpdate({ data: res.data.map(entityToRow), meta: res.meta }), onError)
            : unsupportedMethod(noRealtime(slug)),
        listenById: snap.listenById
            ? (id: string | number, onUpdate: (r: M | undefined) => void, onError?: (e: Error) => void) =>
                snap.listenById!(id, (s) => onUpdate(s ? entityToRow(s) : undefined), onError)
            : unsupportedMethod(noRealtime(slug)),
        where(columnOrCondition: string | LogicalCondition, operator?: WhereFilterOp, value?: unknown) {
            const builder = new SdkQueryBuilder<M>(client);
            if (typeof columnOrCondition === "object") {
                return builder.where(columnOrCondition);
            }
            return builder.where(columnOrCondition as keyof M & string, operator!, value as WhereValueFor<WhereFilterOp, M[keyof M & string]>);
        },
        orderBy: (
            column: FieldPath<M> | ComputedSortField | RelationAggregateSort,
            direction?: "asc" | "desc",
            nulls?: NullsPlacement
        ) => new SdkQueryBuilder<M>(client).orderBy(column, direction, nulls),
        limit: (count: number) => new SdkQueryBuilder<M>(client).limit(count),
        offset: (count: number) => new SdkQueryBuilder<M>(client).offset(count),
        search: (searchString: string) => new SdkQueryBuilder<M>(client).search(searchString),
        vectorSearch: (
            property: string,
            vector: number[],
            options?: { distance?: "cosine" | "l2" | "inner_product"; threshold?: number }
        ) => new SdkQueryBuilder<M>(client).vectorSearch(property, vector, options),
        include: (...relations: (string | IncludeSpec)[]) => new SdkQueryBuilder<M>(client).include(...relations),
        fields: (...columns: (FieldPath<M> | string)[]) => new SdkQueryBuilder<M>(client).fields(...columns),
        distinct: (enabled?: boolean) => new SdkQueryBuilder<M>(client).distinct(enabled),
        after: (cursor: string) => new SdkQueryBuilder<M>(client).after(cursor),
        aggregate: snap.aggregate
            ? (params: AggregateParams<M>) => snap.aggregate!(params)
            : unsupportedMethod(noAggregate(slug))
    };
    return client;
}

/**
 * Wrap a flat {@link SDKCollectionClient} into a Entity-shaped
 * {@link CollectionAccessor}. Every returned row is re-wrapped into the
 * `{ id, path, values }` view-model the admin panel renders.
 */
function toEntityAccessor<M extends Record<string, unknown>>(
    sdk: SDKCollectionClient<M>,
    slug: string,
    getPks: () => PrimaryKeyInfo[] = () => [],
    toViewModel?: (values: Record<string, unknown>) => Record<string, unknown>
): CollectionAccessor<M> {
    const accessor: CollectionAccessor<M> = {
        async find(params?: FindParams<M>): Promise<FindResponse<M>> {
            const res = await sdk.find(params);
            return { data: res.data.map((row) => rowToEntity<M>(row, slug, getPks(), toViewModel)), meta: res.meta };
        },
        async findById(id: string | number): Promise<Entity<M> | undefined> {
            const row = await sdk.findById(id);
            return row ? rowToEntity<M>(row, slug, getPks(), toViewModel) : undefined;
        },
        async create(data: Partial<EntityValues<M>>, id?: string | number): Promise<Entity<M>> {
            return rowToEntity<M>(await sdk.create(data as Partial<M>, id), slug, getPks(), toViewModel);
        },
        // Declared on `CollectionAccessor` and, until now, never implemented on
        // this side of the boundary — so the admin's own import wrote one HTTP
        // request per row and could neither be atomic nor upsert. It forwards to
        // the same `/bulk` route the SDK client uses.
        createMany: sdk.createMany
            ? async (
                data: Partial<EntityValues<M>>[],
                options?: { upsert?: boolean; onConflict?: readonly string[] }
            ): Promise<Entity<M>[]> => {
                const rows = await sdk.createMany!(data as Partial<M>[], options);
                return rows.map((row) => rowToEntity<M>(row, slug, getPks(), toViewModel));
            }
            : undefined,
        async update(id: string | number, data: Partial<EntityValues<M>>): Promise<Entity<M>> {
            const row = await sdk.update(id, data as Partial<M>);
            if (!row) throw new Error(`Update returned no data for id ${id}`);
            return rowToEntity<M>(row, slug, getPks(), toViewModel);
        },
        delete(id: string | number): Promise<void> {
            return sdk.delete(id);
        },
        // `CollectionAccessor` keeps these optional, and the optionality is
        // load-bearing: the admin panel picks between subscribing and a
        // one-shot `find()` on exactly this property, and a UI that subscribes
        // into a throw is worse than one that polls. The client's method is
        // always present now, so the capability is read off the stub instead.
        count: isUnsupported(sdk.count) ? undefined : (params?: FindParams<M>) => sdk.count(params),
        aggregate: isUnsupported(sdk.aggregate)
            ? undefined
            : (params: AggregateParams<M>) => sdk.aggregate(params),
        listen: isUnsupported(sdk.listen)
            ? undefined
            : (params: FindParams<M> | undefined, onUpdate: (r: FindResponse<M>) => void, onError?: (e: Error) => void) =>
                sdk.listen(params, (res) => onUpdate({ data: res.data.map((row) => rowToEntity<M>(row, slug, getPks(), toViewModel)), meta: res.meta }), onError),
        listenById: isUnsupported(sdk.listenById)
            ? undefined
            : (id: string | number, onUpdate: (s: Entity<M> | undefined) => void, onError?: (e: Error) => void) =>
                sdk.listenById(id, (row) => onUpdate(row ? rowToEntity<M>(row, slug, getPks(), toViewModel) : undefined), onError),
        where(columnOrCondition: string | LogicalCondition, operator?: WhereFilterOp, value?: unknown) {
            const builder = new QueryBuilder<M>(accessor);
            if (typeof columnOrCondition === "object") {
                return builder.where(columnOrCondition);
            }
            return builder.where(columnOrCondition as keyof M & string, operator!, value as WhereValueFor<WhereFilterOp, M[keyof M & string]>);
        },
        orderBy: (column: keyof M & string, direction?: "asc" | "desc") => new QueryBuilder<M>(accessor).orderBy(column, direction),
        limit: (count: number) => new QueryBuilder<M>(accessor).limit(count),
        offset: (count: number) => new QueryBuilder<M>(accessor).offset(count),
        search: (searchString: string) => new QueryBuilder<M>(accessor).search(searchString),
        vectorSearch: (
            property: string,
            vector: number[],
            options?: { distance?: "cosine" | "l2" | "inner_product"; threshold?: number }
        ) => new QueryBuilder<M>(accessor).vectorSearch(property, vector, options),
        include: (...relations: string[]) => new QueryBuilder<M>(accessor).include(...relations)
    };
    return accessor;
}

/**
 * Wrap a flat {@link RebaseSdkData} into a Entity-shaped {@link RebaseData}.
 *
 * This is the **admin boundary**: the SDK client (`client.data`) returns flat
 * rows, but the admin renders the `Entity` view-model (`entity.values.*`).
 * `core/Rebase.tsx` wraps `client.data` through this before handing it to the
 * admin `RebaseDataContext` — without it the admin renders rows with only their
 * `id`.
 */
/**
 * Only the by-slug accessor is asked for, so only that is required.
 *
 * Taking a whole `RebaseSdkData` meant taking `RebaseSdkData<unknown>`, whose
 * dynamic branch is an index signature — and no `RebaseSdkData<DB>` satisfies
 * it, because its own `collection` method is not a `SDKCollectionClient`. So a
 * caller holding a *typed* client could not pass it to a function that reads
 * one method off it, and that method is identical on every instantiation.
 */
export function wrapAsEntityData(sdkData: Pick<RebaseSdkData, "collection">, options?: EntityDataOptions): RebaseData {
    const cache = new Map<string, CollectionAccessor>();
    const primaryKeysFor = createPrimaryKeyResolver(options);
    const viewModelFor = createViewModelConverter(options);

    function getAccessor(slug: string): CollectionAccessor {
        let accessor = cache.get(slug);
        if (!accessor) {
            accessor = toEntityAccessor(sdkData.collection(slug), slug, () => primaryKeysFor(slug), viewModelFor(slug));
            cache.set(slug, accessor);
        }
        return accessor;
    }

    const target = { collection: getAccessor } as RebaseData;

    return new Proxy(target, {
        get(_target, prop: string | symbol) {
            if (prop === "collection") return getAccessor;
            if (typeof prop === "symbol") return undefined;
            if (prop === "then" || prop === "toJSON" || prop === "$$typeof") return undefined;
            return getAccessor(toSnakeCase(prop));
        }
    });
}

/**
 * Wrap a Entity-shaped {@link RebaseData} into a flat {@link RebaseSdkData}.
 *
 * Every collection accessor is adapted to return flat rows. Use this to derive
 * the flat SDK data layer (`context.data`) from an existing Entity data layer
 * — e.g. the admin routes its Entity data via `useData()` and exposes the
 * same routing as flat `context.data` for callbacks by wrapping it here.
 */
export function wrapAsSdkData(entityData: RebaseData): RebaseSdkData {
    const cache = new Map<string, SDKCollectionClient>();

    function getAccessor(slug: string): SDKCollectionClient {
        let accessor = cache.get(slug);
        if (!accessor) {
            accessor = toSdkCollectionClient(entityData.collection(slug), slug);
            cache.set(slug, accessor);
        }
        return accessor;
    }

    const target = { collection: getAccessor } as RebaseSdkData;

    return new Proxy(target, {
        get(_target, prop: string | symbol) {
            if (prop === "collection") return getAccessor;
            if (typeof prop === "symbol") return undefined;
            if (prop === "then" || prop === "toJSON" || prop === "$$typeof") return undefined;
            return getAccessor(toSnakeCase(prop));
        }
    });
}

/**
 * Build a flat {@link RebaseSdkData} from a `DataDriver`.
 *
 * This is the developer-facing SDK data layer used by backend framework
 * callbacks & scripts (`context.data` / `rebase.dataAsAdmin`). It returns flat rows —
 * identical in shape to the frontend SDK client, down to how a relation is
 * served: a foreign key stays a foreign key, and a relation named in `include`
 * arrives as the target's own columns. The `{ __type: "relation" }` envelope is
 * the admin's view-model and never reaches here.
 *
 * The admin uses {@link buildRebaseData} (Entity) over its own driver.
 */
export function buildSdkData(driver: DataDriver): RebaseSdkData {
    return wrapAsSdkData(buildRebaseData(driver));
}
