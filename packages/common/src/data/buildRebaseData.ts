import {
    CollectionAccessor,
    DataDriver,
    Snapshot,
    SnapshotValues,
    FindParams,
    FindResponse,
    FindResult,
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
import { deserializeFilter } from "./filter-dialect";

/**
 * Convert a flat REST record (e.g. from RestFetchService) to Snapshot<M> format.
 * Mirrors the client SDK's rowToSnapshot conversion.
 */
function rowToSnapshot<M extends Record<string, unknown>>(row: Record<string, unknown>, slug: string): Snapshot<M> {
    return {
        id: row.id as string | number,
        path: slug,
        values: row as SnapshotValues<M>
    };
}

function createDriverAccessor<M extends Record<string, unknown> = Record<string, unknown>>(
    driver: DataDriver,
    slug: string
): CollectionAccessor<M> {
    const accessor: CollectionAccessor<M> = {
        async find(params?: FindParams): Promise<FindResponse<M>> {
            // Ensure filters are in canonical [op, value] format even if passed as PostgREST strings
            const filter = params?.where ? deserializeFilter(params.where as any) : undefined;
            const limit = params?.limit ?? 20;
            const offset = params?.offset ?? 0;

            // Use the RestFetchService for include-aware queries when available
            const fetchService = driver.restFetchService;
            const rows = (fetchService && params?.include && params.include.length > 0)
                ? await fetchService.fetchCollectionForRest(
                    slug,
                    {
                        filter,
                        limit: params?.limit,
                        offset: params?.offset,
                        orderBy: params?.orderBy?.[0],
                        order: params?.orderBy?.[1],
                        searchString: params?.searchString
                    },
                    params.include
                )
                : await driver.fetchCollection<M>({
                    path: slug,
                    limit: params?.limit,
                    offset: params?.offset,
                    filter,
                    orderBy: params?.orderBy?.[0],
                    order: params?.orderBy?.[1],
                    searchString: params?.searchString
                });

            // Compute real total when count is available
            let total = rows.length + offset;
            let hasMore = rows.length >= limit;
            if (driver.count) {
                total = await driver.count({ path: slug, filter });
                hasMore = offset + rows.length < total;
            }

            return {
                data: rows.map((row: Record<string, unknown>) => rowToSnapshot<M>(row, slug)),
                meta: { total, limit, offset, hasMore }
            };
        },

        async findById(id: string | number): Promise<Snapshot<M> | undefined> {
            const row = await driver.fetchOne<M>({ path: slug, id: id });
            return row ? rowToSnapshot<M>(row, slug) : undefined;
        },

        async create(data: Partial<SnapshotValues<M>>, id?: string | number): Promise<Snapshot<M>> {
            const row = await driver.save<M>({
                path: slug,
                values: data,
                id: id,
                status: "new"
            });
            return rowToSnapshot<M>(row, slug);
        },

        async update(id: string | number, data: Partial<SnapshotValues<M>>): Promise<Snapshot<M>> {
            const row = await driver.save<M>({
                path: slug,
                values: data,
                id: id,
                status: "existing"
            });
            return rowToSnapshot<M>(row, slug);
        },

        async delete(id: string | number): Promise<void> {
            return driver.delete({
                row: { id,
path: slug,
values: {} as Record<string, unknown> }
            });
        },

        deleteAll: driver.deleteAll
            ? async (): Promise<void> => {
                return driver.deleteAll!(slug);
            }
            : undefined,

        count: driver.count
            ? async (params?: FindParams): Promise<number> => {
                const filter = params?.where ? deserializeFilter(params.where as any) : undefined;
                return driver.count!({
                    path: slug,
                    filter
                });
            }
            : undefined,

        listen: driver.listenCollection
            ? (params: FindParams | undefined, onUpdate: (response: FindResponse<M>) => void, onError?: (error: Error) => void) => {
                const limit = params?.limit ?? 20;
                const offset = params?.offset ?? 0;
                return driver.listenCollection!<M>({
                    path: slug,
                    limit: params?.limit,
                    offset: params?.offset,
                    filter: params?.where,
                    orderBy: params?.orderBy?.[0],
                    order: params?.orderBy?.[1],
                    searchString: params?.searchString,
                    onUpdate: (snapshots) => {
                        onUpdate({
                            data: snapshots.map((row: Record<string, unknown>) => rowToSnapshot<M>(row, slug)),
                            meta: {
                                total: snapshots.length,
                                limit,
                                offset,
                                hasMore: snapshots.length >= limit,
                                estimated: true
                            }
                        });
                    },
                    onError
                });
            } : undefined,

        listenById: driver.listenOne
            ? (id: string | number, onUpdate: (snapshot: Snapshot<M> | undefined) => void, onError?: (error: Error) => void) => {
                return driver.listenOne!<M>({
                    path: slug,
                    id: id,
                    onUpdate: (snapshot) => onUpdate(snapshot ? rowToSnapshot<M>(snapshot, slug) : undefined),
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
export function buildRebaseData(driver: DataDriver): RebaseData {
    const cache = new Map<string, CollectionAccessor>();

    function getAccessor(slug: string): CollectionAccessor {
        let accessor = cache.get(slug);
        if (!accessor) {
            accessor = createDriverAccessor(driver, slug);
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
 * Unwrap a Snapshot into a flat row. `rowToSnapshot` stores the whole flat row
 * (id included) under `.values`, so this is just that payload.
 */
function snapshotToRow<M extends Record<string, unknown>>(snapshot: Snapshot<M>): M {
    return snapshot.values as unknown as M;
}

/**
 * Fluent query builder for the flat SDK data layer. Mirrors {@link QueryBuilder}
 * but resolves to `FindResult<M>` (flat rows) instead of Snapshot-wrapped
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
        return this.client.find(this.params);
    }

    async count(): Promise<number> {
        return this.client.count ? this.client.count(this.params) : 0;
    }

    listen(onUpdate: (data: FindResult<M>) => void, onError?: (error: Error) => void): () => void {
        if (!this.client.listen) {
            throw new Error("Listen is only available when the driver supports realtime.");
        }
        return this.client.listen(this.params, onUpdate, onError);
    }
}

/**
 * Wrap a Snapshot-shaped {@link CollectionAccessor} into a flat
 * {@link SDKCollectionClient}. Every returned record is unwrapped to a flat row
 * so the backend SDK is byte-for-byte the same shape as the frontend client.
 */
function toSdkCollectionClient<M extends Record<string, unknown>>(
    snap: CollectionAccessor<M>
): SDKCollectionClient<M> {
    const client: SDKCollectionClient<M> = {
        async find(params?: FindParams): Promise<FindResult<M>> {
            const res = await snap.find(params);
            return { data: res.data.map(snapshotToRow), meta: res.meta };
        },
        async findById(id: string | number): Promise<M | undefined> {
            const s = await snap.findById(id);
            return s ? snapshotToRow(s) : undefined;
        },
        async create(data: Partial<M>, id?: string | number): Promise<M> {
            return snapshotToRow(await snap.create(data as Partial<SnapshotValues<M>>, id));
        },
        async update(id: string | number, data: Partial<M>): Promise<M> {
            return snapshotToRow(await snap.update(id, data as Partial<SnapshotValues<M>>));
        },
        delete(id: string | number): Promise<void> {
            return snap.delete(id);
        },
        deleteAll: snap.deleteAll ? () => snap.deleteAll!() : undefined,
        count: snap.count ? (params?: FindParams) => snap.count!(params) : undefined,
        listen: snap.listen
            ? (params: FindParams | undefined, onUpdate: (r: FindResult<M>) => void, onError?: (e: Error) => void) =>
                snap.listen!(params, (res) => onUpdate({ data: res.data.map(snapshotToRow), meta: res.meta }), onError)
            : undefined,
        listenById: snap.listenById
            ? (id: string | number, onUpdate: (r: M | undefined) => void, onError?: (e: Error) => void) =>
                snap.listenById!(id, (s) => onUpdate(s ? snapshotToRow(s) : undefined), onError)
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
 * Wrap a flat {@link SDKCollectionClient} into a Snapshot-shaped
 * {@link CollectionAccessor}. Every returned row is re-wrapped into the
 * `{ id, path, values }` view-model the admin CMS renders.
 */
function toSnapshotAccessor<M extends Record<string, unknown>>(
    sdk: SDKCollectionClient<M>,
    slug: string
): CollectionAccessor<M> {
    const accessor: CollectionAccessor<M> = {
        async find(params?: FindParams): Promise<FindResponse<M>> {
            const res = await sdk.find(params);
            return { data: res.data.map((row) => rowToSnapshot<M>(row, slug)), meta: res.meta };
        },
        async findById(id: string | number): Promise<Snapshot<M> | undefined> {
            const row = await sdk.findById(id);
            return row ? rowToSnapshot<M>(row, slug) : undefined;
        },
        async create(data: Partial<SnapshotValues<M>>, id?: string | number): Promise<Snapshot<M>> {
            return rowToSnapshot<M>(await sdk.create(data as Partial<M>, id), slug);
        },
        async update(id: string | number, data: Partial<SnapshotValues<M>>): Promise<Snapshot<M>> {
            return rowToSnapshot<M>(await sdk.update(id, data as Partial<M>), slug);
        },
        delete(id: string | number): Promise<void> {
            return sdk.delete(id);
        },
        deleteAll: sdk.deleteAll ? () => sdk.deleteAll!() : undefined,
        count: sdk.count ? (params?: FindParams) => sdk.count!(params) : undefined,
        listen: sdk.listen
            ? (params: FindParams | undefined, onUpdate: (r: FindResponse<M>) => void, onError?: (e: Error) => void) =>
                sdk.listen!(params, (res) => onUpdate({ data: res.data.map((row) => rowToSnapshot<M>(row, slug)), meta: res.meta }), onError)
            : undefined,
        listenById: sdk.listenById
            ? (id: string | number, onUpdate: (s: Snapshot<M> | undefined) => void, onError?: (e: Error) => void) =>
                sdk.listenById!(id, (row) => onUpdate(row ? rowToSnapshot<M>(row, slug) : undefined), onError)
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
 * Wrap a flat {@link RebaseSdkData} into a Snapshot-shaped {@link RebaseData}.
 *
 * This is the **CMS boundary**: the SDK client (`client.data`) returns flat
 * rows, but the admin renders the `Snapshot` view-model (`snapshot.values.*`).
 * `core/Rebase.tsx` wraps `client.data` through this before handing it to the
 * CMS `RebaseDataContext` — without it the admin renders rows with only their
 * `id`.
 */
export function wrapAsSnapshotData(sdkData: RebaseSdkData): RebaseData {
    const cache = new Map<string, CollectionAccessor>();

    function getAccessor(slug: string): CollectionAccessor {
        let accessor = cache.get(slug);
        if (!accessor) {
            accessor = toSnapshotAccessor(sdkData.collection(slug), slug);
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
 * Wrap a Snapshot-shaped {@link RebaseData} into a flat {@link RebaseSdkData}.
 *
 * Every collection accessor is adapted to return flat rows. Use this to derive
 * the flat SDK data layer (`context.data`) from an existing Snapshot data layer
 * — e.g. the admin routes its Snapshot data via `useData()` and exposes the
 * same routing as flat `context.data` for callbacks by wrapping it here.
 */
export function wrapAsSdkData(snapshotData: RebaseData): RebaseSdkData {
    const cache = new Map<string, SDKCollectionClient>();

    function getAccessor(slug: string): SDKCollectionClient {
        let accessor = cache.get(slug);
        if (!accessor) {
            accessor = toSdkCollectionClient(snapshotData.collection(slug));
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
 * identical in shape to the frontend SDK client — so the API is symmetric
 * across front and back. The admin CMS uses {@link buildRebaseData} (Snapshot).
 */
export function buildSdkData(driver: DataDriver): RebaseSdkData {
    return wrapAsSdkData(buildRebaseData(driver));
}
