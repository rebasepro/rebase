import type {
    AggregateParams,
    AggregateResult,
    ByIdReadOptions,
    ComputedSortField,
    FilteredWriteParams,
    FindParams,
    LogicalConditionFor,
    RefreshOptions,
    WhereFilterOp,
    WhereFor,
    WhereValueFor
} from "@rebasepro/types";
import type { Entity, EntityValues } from "./entities";

/**
 * The admin's accessor: every table read and written as `Entity` view models
 * (`{ id, path, values }`). `buildRebaseData` builds it over a driver's rows,
 * `wrapAsEntityData` over the SDK client; the SDK itself (`SDKTableClient`,
 * `RebaseSdkData` in `@rebasepro/types`) serves plain rows.
 *
 * @module
 */

/**
 * Paginated response from a table query.
 * @group Data
 */
export interface FindResponse<M extends Record<string, unknown> = Record<string, unknown>> {
    /** Array of entities matching the query */
    data: Entity<M>[];
    /** Pagination metadata */
    meta: {
        total: number;
        limit: number;
        offset: number;
        hasMore: boolean;
    };
}



/**
 * Fluent query builder for the **admin panel** — resolves to `FindResponse<M>`
 * (Snapshot-wrapped rows).
 *
 * @internal App developers should use {@link SDKQueryBuilderInterface}
 * (flat rows, returned by `client.data.*` / `context.data.*`). This
 * Snapshot-flavored variant backs the admin panel internals only.
 *
 * @group Data
 */
export interface QueryBuilderInterface<M extends Record<string, unknown> = Record<string, unknown>> {
    where<K extends keyof M & string, Op extends WhereFilterOp>(column: K, operator: Op, value: WhereValueFor<Op, M[K]>): this;
    where(logicalCondition: LogicalConditionFor<M>): this;
    orderBy(column: (keyof M & string) | ComputedSortField, direction?: "asc" | "desc"): this;
    limit(count: number): this;
    offset(count: number): this;
    search(searchString: string, options?: { explain?: boolean }): this;

    /**
     * Order rows by nearest-neighbour distance to `vector`, closest first.
     *
     * Postgres only, over a property declared as `type: "vector"`. Each row
     * comes back with a `_distance`. Any `where` on the same query filters
     * before the ordering; distance decides the order.
     *
     * The query embedding is the caller's to produce.
     */
    vectorSearch(
        property: string,
        vector: number[],
        options?: { distance?: "cosine" | "l2" | "inner_product"; threshold?: number }
    ): this;
    include(...relations: string[]): this;
    find(): Promise<FindResponse<M>>;
    listen(onUpdate: (data: FindResponse<M>) => void, onError?: (error: Error) => void): () => void;
}

/**
 * A single table's CRUD accessor for the **admin panel** — every method
 * resolves to `Snapshot`-wrapped rows (`FindResponse<M>` / `Snapshot<M>`).
 *
 * @internal App developers do **not** use this. The public, symmetric surface
 * is {@link SDKTableClient} (flat rows), exposed as `client.data.products`
 * in the SDK and `context.data.products` in framework callbacks. This
 * Snapshot-flavored accessor backs the admin panel view-model only.
 *
 * @group Data
 */
export interface TableAccessor<M extends Record<string, unknown> = Record<string, unknown>> {
    /**
     * Find multiple records with optional filtering, pagination, and sorting.
     */
    find(params?: FindParams<M>): Promise<FindResponse<M>>;

    /**
     * Find a single record by its ID.
     */
    findById(id: string | number, options?: ByIdReadOptions): Promise<Entity<M> | undefined>;

    /**
     * Create a new record.
     * @param data The entity data to create.
     * @param id Optional specific ID to use for the new record.
     * @returns The created entity
     */
    create(data: Partial<EntityValues<M>>, id?: string | number): Promise<Entity<M>>;

    /**
     * Create many records in a single transaction.
     *
     * See {@link SDKTableClient.createMany}. Optional: not every driver can
     * write in bulk, and callers should fall back to `create` per record.
     */
    createMany?(
        data: Partial<EntityValues<M>>[],
        options?: { upsert?: boolean; onConflict?: readonly string[]; where?: WhereFor<M>; ignoreDuplicates?: boolean }
    ): Promise<Entity<M>[]>;

    /**
     * Update an existing record by ID.
     *
     * `options.ifMatch` is the version the edit was made against
     * ({@link Entity.etag}): the write is refused with `412
     * PRECONDITION_FAILED` when the row has changed since. A data source that
     * cannot check one ignores it, and the write is unconditional.
     * @returns The updated entity
     */
    update(id: string | number, data: Partial<EntityValues<M>>, options?: { ifMatch?: string }): Promise<Entity<M>>;

    /**
     * Update many records in a single transaction.
     *
     * See {@link SDKTableClient.updateMany}. Optional, as `createMany` is.
     */
    updateMany?(updates: { id: string | number; data: Partial<EntityValues<M>> }[]): Promise<Entity<M>[]>;

    /**
     * Delete many records in a single transaction.
     *
     * See {@link SDKTableClient.deleteMany}. Optional, as `createMany` is.
     */
    deleteMany?(ids: (string | number)[]): Promise<void>;

    /** See {@link SDKTableClient.updateWhere}. Optional, as `createMany` is. */
    updateWhere?(query: FilteredWriteParams<M>, data: Partial<EntityValues<M>>): Promise<Entity<M>[]>;

    /** See {@link SDKTableClient.deleteWhere}. Optional, as `createMany` is. */
    deleteWhere?(query: FilteredWriteParams<M>): Promise<number>;

    /**
     * Delete a record by ID.
     */
    delete(id: string | number): Promise<void>;

    /**
     * Subscribe to a table for real-time updates.
     * Optional method, may not be supported by all implementations (like stateless HTTP clients).
     */
    listen?(params: FindParams<M> | undefined, onUpdate: (response: FindResponse<M>) => void, onError?: (error: Error) => void): () => void;

    /**
     * Subscribe to a single record for real-time updates: every frame is the
     * record as `findById(id, options)` reads it.
     * Optional method.
     */
    listenById?(id: string | number, onUpdate: (entity: Entity<M> | undefined) => void, onError?: (error: Error) => void, options?: ByIdReadOptions): () => void;

    /**
     * {@link SDKTableClient.listenCount}: the matching rows' count, live.
     * Optional method; absent where the data source cannot subscribe.
     */
    listenCount?(params: FindParams<M> | undefined, onCount: (total: number) => void, onError?: (error: Error) => void): () => void;

    /**
     * The rows a soft delete stamped, and the delete that removes a row for
     * good: what {@link SDKTableClient.trash} is built from. A restore is
     * an ordinary {@link update}. Optional; absent where the data source
     * cannot read a table's trash.
     */
    trash?: TableTrashAccessor<M>;

    /**
     * Count the number of records matching the given filter.
     *
     * Optional on this contract because a data source need not support it, and
     * required on `TableClient` — the HTTP implementation always has it.
     * So `client.data.posts.count()` compiles in the browser while the same
     * call through a `context.data` accessor needs `count?.()`, which is the
     * one place the two halves of this API are not interchangeable.
     */
    count?(params?: FindParams<M>): Promise<number>;

    /**
     * {@link SDKTableClient.aggregate}. Optional here for the same reason
     * `count` is: not every data source can compute one, and the SDK wraps an
     * absent implementation in a stub that says so rather than returning a
     * number nothing counted.
     */
    aggregate?(params: AggregateParams<M>): Promise<AggregateResult>;

    /** {@link SDKTableClient.refresh}. Optional, as `aggregate` is. */
    refresh?(options?: RefreshOptions): Promise<void>;

    // Fluent Query Builder
    where<K extends keyof M & string, Op extends WhereFilterOp>(column: K, operator: Op, value: WhereValueFor<Op, M[K]>): QueryBuilderInterface<M>;
    where(logicalCondition: LogicalConditionFor<M>): QueryBuilderInterface<M>;
    orderBy(column: (keyof M & string) | ComputedSortField, direction?: "asc" | "desc"): QueryBuilderInterface<M>;
    limit(count: number): QueryBuilderInterface<M>;
    offset(count: number): QueryBuilderInterface<M>;
    search(searchString: string, options?: { explain?: boolean }): QueryBuilderInterface<M>;

    /**
     * Order rows by nearest-neighbour distance to `vector`, closest first.
     *
     * Postgres only, over a property declared as `type: "vector"`. Each row
     * comes back with a `_distance`. Any `where` on the same query filters
     * before the ordering; distance decides the order.
     *
     * The query embedding is the caller's to produce.
     */
    vectorSearch(
        property: string,
        vector: number[],
        options?: { distance?: "cosine" | "l2" | "inner_product"; threshold?: number }
    ): QueryBuilderInterface<M>;
    include(...relations: string[]): QueryBuilderInterface<M>;
}

/**
 * The entity-shaped half of {@link TrashClient}, on a {@link TableAccessor}.
 */
export interface TableTrashAccessor<M extends Record<string, unknown> = Record<string, unknown>> {
    /** The trashed rows matching `params`. */
    find(params?: FindParams<M>): Promise<FindResponse<M>>;
    /** How many trashed rows match `params`. */
    count(params?: FindParams<M>): Promise<number>;
    /** Delete a row for good, trashed or live. */
    purge(id: string | number): Promise<void>;
    /** {@link purge} for several rows, as one transaction, where the data source can. */
    purgeMany?(ids: (string | number)[]): Promise<void>;
}

/**
 * The unified data access object for the **admin panel** (Entity-shaped).
 *
 * Access tables as dynamic properties: `data.products.find(...)`. Each
 * accessor returns `Entity`-wrapped records (`{ id, path, values }`) — the
 * view-model the admin renders. This is what `useData()` / the admin
 * `RebaseContext.data` are backed by.
 *
 * @internal App developers do **not** use this — they use
 * {@link RebaseSdkData} (flat rows), which is what the SDK client and backend
 * `context.data` expose. This Entity-shaped map backs the admin panel only.
 *
 * @group Data
 */
export type RebaseData<DB = unknown> = {
    /**
     * Get a table accessor by slug.
     * Alternative to dynamic property access for cases where
     * the table name is a variable.
     *
     * @example
     * const accessor = data.table("products");
     * await accessor.find({ limit: 10 });
     */
    table<M extends Record<string, unknown> = Record<string, unknown>>(slug: string): TableAccessor<M>;
} & (
    DB extends Record<string, unknown>
        ? { [K in keyof DB]: TableAccessor<DB[K] extends { Row: infer R extends Record<string, unknown> } ? R : Record<string, unknown>> }
        : {
            /**
             * Dynamic table accessor.
             * Access any table by its slug as a property.
             *
             * The index signature is `TableAccessor` alone, for the reason
             * spelled out on {@link RebaseSdkData}: unioning in the `table`
             * method's own signature is unnecessary across an intersection, and it
             * costs `data.products.find()` — the access this `@example` documents.
             *
             * @example
             * data.products.find({ where: { status: ["==", "published"] } })
             */
            [tableSlug: string]: TableAccessor;
        }
);
