import {
    CollectionAccessor,
    DataDriver,
    Entity,
    EntityValues,
    FindAllParams,
    FindParams,
    FindResponse,
    FindResult,
    IterateParams,
    LogicalCondition,
    RebaseData,
    RebaseSdkData,
    SDKCollectionClient,
    SDKQueryBuilderInterface,
    WhereFilterOp,
    WhereValue
} from "@rebasepro/types";
import { toSnakeCase } from "@rebasepro/utils";
import { QueryBuilder } from "./query_builder";
import { collectAllPages, paginateFind, resolveFindWindow } from "./paginate";
import { deserializeFilter } from "./filter-dialect";
import { buildCompositeId, resolvePrimaryKeys, PrimaryKeyInfo } from "../util/identity";

export interface EntityDataOptions {
    /**
     * Look up a collection's config by slug, to derive row addresses from its
     * primary keys.
     *
     * Called lazily rather than up front: the data layer is created by `Rebase`,
     * which sits *above* the admin that owns the collections, so a resolver
     * registered on mount would otherwise arrive too late to be seen.
     */
    resolveCollection?: (slug: string) => { properties?: Record<string, unknown> } | undefined;
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
    primaryKeys: PrimaryKeyInfo[] = []
): Entity<M> {
    return {
        id: primaryKeys.length > 0
            ? buildCompositeId(row, primaryKeys)
            : row.id as string | number,
        path: slug,
        values: row as EntityValues<M>
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
 * {@link RestFetchService}) — and reads that come back through a *driver*
 * method rather than the REST pipeline still carry envelopes. Realtime is the
 * one such read left: there is no `listenForRest`, so the rows arrive shaped
 * for the admin and are flattened here instead.
 *
 * Only applied where the REST pipeline is the contract (see `find`); a driver
 * without a `restFetchService` keeps whatever it returns, so the admin's own
 * path through {@link buildRebaseData} is untouched.
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
    getPks: () => PrimaryKeyInfo[] = () => []
): CollectionAccessor<M> {
    const accessor: CollectionAccessor<M> = {
        async find(params?: FindParams<M>): Promise<FindResponse<M>> {
            // Ensure filters are in canonical [op, value] format even if passed as PostgREST strings
            const filter = params?.where ? deserializeFilter(params.where as Record<string, unknown>) : undefined;
            const { limit, offset, driverOffset } = resolveFindWindow(params);

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
            const fetchService = driver.restFetchService;
            const rows = fetchService
                ? await fetchService.fetchCollectionForRest(
                    slug,
                    {
                        filter,
                        // Without this the group was dropped and the read ran
                        // unfiltered — every row the caller's policies allow,
                        // in place of the ones they asked for.
                        logical: params?.logical,
                        limit,
                        offset: driverOffset,
                        orderBy: params?.orderBy?.[0],
                        order: params?.orderBy?.[1],
                        searchString: params?.searchString
                    },
                    params?.include
                )
                : await driver.fetchCollection<M>({
                    path: slug,
                    limit,
                    offset: driverOffset,
                    filter,
                    logical: params?.logical,
                    orderBy: params?.orderBy?.[0],
                    order: params?.orderBy?.[1],
                    searchString: params?.searchString
                });

            // Compute real total when count is available
            let total = rows.length + offset;
            let hasMore = rows.length >= limit;
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
                hasMore = offset + rows.length < total;
            }

            return {
                data: rows.map((row: Record<string, unknown>) => rowToEntity<M>(row, slug, getPks())),
                meta: { total, limit, offset, hasMore }
            };
        },

        async findById(id: string | number): Promise<Entity<M> | undefined> {
            // Same contract as `find` above: one row read the same way the
            // collection read is, so `find()[0]` and `findById()` agree.
            const fetchService = driver.restFetchService;
            const row = fetchService
                ? await fetchService.fetchOneForRest(slug, id)
                : await driver.fetchOne<M>({ path: slug, id: id });
            return row ? rowToEntity<M>(row, slug, getPks()) : undefined;
        },

        async create(data: Partial<EntityValues<M>>, id?: string | number): Promise<Entity<M>> {
            const row = await driver.save<M>({
                path: slug,
                values: data,
                id: id,
                status: "new"
            });
            return rowToEntity<M>(row, slug, getPks());
        },

        createMany: driver.saveMany
            ? async (data: Partial<EntityValues<M>>[], options?: { upsert?: boolean }): Promise<Entity<M>[]> => {
                const rows = await driver.saveMany!<M>({
                    path: slug,
                    rows: data,
                    upsert: options?.upsert
                });
                return rows.map((row) => rowToEntity<M>(row, slug, getPks()));
            }
            : undefined,

        async update(id: string | number, data: Partial<EntityValues<M>>): Promise<Entity<M>> {
            const row = await driver.save<M>({
                path: slug,
                values: data,
                id: id,
                status: "existing"
            });
            return rowToEntity<M>(row, slug, getPks());
        },

        async delete(id: string | number): Promise<void> {
            return driver.delete({
                row: { id,
path: slug,
values: {} as Record<string, unknown> }
            });
        },

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
                // Realtime has no REST-pipeline equivalent, so the rows arrive
                // admin-shaped. Flatten them to the one shape the rest of this
                // accessor serves.
                const normalize = driver.restFetchService ? inlineRelationRefs : (row: Record<string, unknown>) => row;
                return driver.listenCollection!<M>({
                    path: slug,
                    limit,
                    offset: driverOffset,
                    filter: params?.where,
                    logical: params?.logical,
                    orderBy: params?.orderBy?.[0],
                    order: params?.orderBy?.[1],
                    searchString: params?.searchString,
                    onUpdate: (entities) => {
                        onUpdate({
                            data: entities.map((row: Record<string, unknown>) => rowToEntity<M>(normalize(row), slug, getPks())),
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
                    onUpdate: (entity) => onUpdate(entity ? rowToEntity<M>(normalize(entity), slug, getPks()) : undefined),
                    onError
                });
            } : undefined,

        // Fluent Query Builder
        where(columnOrCondition: string | LogicalCondition, operator?: WhereFilterOp, value?: unknown) {
            const builder = new QueryBuilder<M>(accessor);
            if (typeof columnOrCondition === "object") {
                return builder.where(columnOrCondition);
            }
            return builder.where(columnOrCondition as keyof M & string, operator!, value as WhereValue<M[keyof M & string]>);
        },
        orderBy(column: keyof M & string, ascending?: "asc" | "desc") {
            return new QueryBuilder<M>(accessor).orderBy(column, ascending);
        },
        limit(count: number) {
            return new QueryBuilder<M>(accessor).limit(count);
        },
        offset(count: number) {
            return new QueryBuilder<M>(accessor).offset(count);
        },
        search(searchString: string) {
            return new QueryBuilder<M>(accessor).search(searchString);
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
export function buildRebaseData(driver: DataDriver, options?: EntityDataOptions): RebaseData {
    const cache = new Map<string, CollectionAccessor>();
    const primaryKeysFor = createPrimaryKeyResolver(options);

    function getAccessor(slug: string): CollectionAccessor {
        let accessor = cache.get(slug);
        if (!accessor) {
            accessor = createDriverAccessor(driver, slug, () => primaryKeysFor(slug));
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
    return entity.values as unknown as M;
}

/**
 * Fluent query builder for the flat SDK data layer. Mirrors {@link QueryBuilder}
 * but resolves to `FindResult<M>` (flat rows) instead of Entity-wrapped
 * `FindResponse<M>`.
 */
class SdkQueryBuilder<M extends Record<string, unknown> = Record<string, unknown>> implements SDKQueryBuilderInterface<M> {
    private params: FindParams = { where: {} };

    constructor(private client: SDKCollectionClient<M>) {}

    where<K extends keyof M & string>(column: K, operator: WhereFilterOp, value: WhereValue<M[K]>): this;
    where(logicalCondition: LogicalCondition): this;
    where(columnOrCondition: string | LogicalCondition, operator?: WhereFilterOp, value?: unknown): this {
        if (typeof columnOrCondition === "object" && columnOrCondition !== null && "type" in columnOrCondition) {
            this.params.logical = columnOrCondition as LogicalCondition;
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

    orderBy(column: keyof M & string, direction: "asc" | "desc" = "asc"): this {
        this.params.orderBy = [column, direction];
        return this;
    }

    limit(count: number): this { this.params.limit = count; return this; }
    offset(count: number): this { this.params.offset = count; return this; }
    search(searchString: string): this { this.params.searchString = searchString; return this; }
    include(...relations: string[]): this { this.params.include = relations; return this; }

    async find(): Promise<FindResult<M>> {
        return this.client.find(this.params as FindParams<M>);
    }

    async count(): Promise<number> {
        return this.client.count ? this.client.count(this.params as FindParams<M>) : 0;
    }

    listen(onUpdate: (data: FindResult<M>) => void, onError?: (error: Error) => void): () => void {
        if (!this.client.listen) {
            throw new Error("Listen is only available when the driver supports realtime.");
        }
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
        async update(id: string | number, data: Partial<M>): Promise<M> {
            return entityToRow(await snap.update(id, data as Partial<EntityValues<M>>));
        },
        delete(id: string | number): Promise<void> {
            return snap.delete(id);
        },
        count: snap.count ? (params?: FindParams<M>) => snap.count!(params) : undefined,
        listen: snap.listen
            ? (params: FindParams<M> | undefined, onUpdate: (r: FindResult<M>) => void, onError?: (e: Error) => void) =>
                snap.listen!(params, (res) => onUpdate({ data: res.data.map(entityToRow), meta: res.meta }), onError)
            : undefined,
        listenById: snap.listenById
            ? (id: string | number, onUpdate: (r: M | undefined) => void, onError?: (e: Error) => void) =>
                snap.listenById!(id, (s) => onUpdate(s ? entityToRow(s) : undefined), onError)
            : undefined,
        where(columnOrCondition: string | LogicalCondition, operator?: WhereFilterOp, value?: unknown) {
            const builder = new SdkQueryBuilder<M>(client);
            if (typeof columnOrCondition === "object") {
                return builder.where(columnOrCondition);
            }
            return builder.where(columnOrCondition as keyof M & string, operator!, value as WhereValue<M[keyof M & string]>);
        },
        orderBy: (column: keyof M & string, direction?: "asc" | "desc") => new SdkQueryBuilder<M>(client).orderBy(column, direction),
        limit: (count: number) => new SdkQueryBuilder<M>(client).limit(count),
        offset: (count: number) => new SdkQueryBuilder<M>(client).offset(count),
        search: (searchString: string) => new SdkQueryBuilder<M>(client).search(searchString),
        include: (...relations: string[]) => new SdkQueryBuilder<M>(client).include(...relations)
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
    getPks: () => PrimaryKeyInfo[] = () => []
): CollectionAccessor<M> {
    const accessor: CollectionAccessor<M> = {
        async find(params?: FindParams<M>): Promise<FindResponse<M>> {
            const res = await sdk.find(params);
            return { data: res.data.map((row) => rowToEntity<M>(row, slug, getPks())), meta: res.meta };
        },
        async findById(id: string | number): Promise<Entity<M> | undefined> {
            const row = await sdk.findById(id);
            return row ? rowToEntity<M>(row, slug, getPks()) : undefined;
        },
        async create(data: Partial<EntityValues<M>>, id?: string | number): Promise<Entity<M>> {
            return rowToEntity<M>(await sdk.create(data as Partial<M>, id), slug, getPks());
        },
        async update(id: string | number, data: Partial<EntityValues<M>>): Promise<Entity<M>> {
            const row = await sdk.update(id, data as Partial<M>);
            if (!row) throw new Error(`Update returned no data for id ${id}`);
            return rowToEntity<M>(row, slug, getPks());
        },
        delete(id: string | number): Promise<void> {
            return sdk.delete(id);
        },
        count: sdk.count ? (params?: FindParams<M>) => sdk.count!(params) : undefined,
        listen: sdk.listen
            ? (params: FindParams<M> | undefined, onUpdate: (r: FindResponse<M>) => void, onError?: (e: Error) => void) =>
                sdk.listen!(params, (res) => onUpdate({ data: res.data.map((row) => rowToEntity<M>(row, slug, getPks())), meta: res.meta }), onError)
            : undefined,
        listenById: sdk.listenById
            ? (id: string | number, onUpdate: (s: Entity<M> | undefined) => void, onError?: (e: Error) => void) =>
                sdk.listenById!(id, (row) => onUpdate(row ? rowToEntity<M>(row, slug, getPks()) : undefined), onError)
            : undefined,
        where(columnOrCondition: string | LogicalCondition, operator?: WhereFilterOp, value?: unknown) {
            const builder = new QueryBuilder<M>(accessor);
            if (typeof columnOrCondition === "object") {
                return builder.where(columnOrCondition);
            }
            return builder.where(columnOrCondition as keyof M & string, operator!, value as WhereValue<M[keyof M & string]>);
        },
        orderBy: (column: keyof M & string, direction?: "asc" | "desc") => new QueryBuilder<M>(accessor).orderBy(column, direction),
        limit: (count: number) => new QueryBuilder<M>(accessor).limit(count),
        offset: (count: number) => new QueryBuilder<M>(accessor).offset(count),
        search: (searchString: string) => new QueryBuilder<M>(accessor).search(searchString),
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
export function wrapAsEntityData(sdkData: RebaseSdkData, options?: EntityDataOptions): RebaseData {
    const cache = new Map<string, CollectionAccessor>();
    const primaryKeysFor = createPrimaryKeyResolver(options);

    function getAccessor(slug: string): CollectionAccessor {
        let accessor = cache.get(slug);
        if (!accessor) {
            accessor = toEntityAccessor(sdkData.collection(slug), slug, () => primaryKeysFor(slug));
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
 * callbacks & scripts (`context.data` / `rebase.data`). It returns flat rows —
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
