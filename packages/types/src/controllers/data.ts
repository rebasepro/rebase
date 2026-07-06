import { Entity, EntityValues } from "../types/entitys";
import { WhereFilterOp, FilterValues, OrderByTuple } from "../types/filter-operators";

export type WhereValue<T> = T | T[] | null;

export interface LogicalCondition {
    type: "and" | "or";
    conditions: (FilterCondition | LogicalCondition)[];
}

export interface FilterCondition {
    column: string;
    operator: WhereFilterOp;
    value: unknown;
}

/**
 * Parameters for querying a collection.
 *
 * @group Data
 */
export interface FindParams {
    /** Maximum number of items to return (default: 20) */
    limit?: number;
    /** Number of items to skip */
    offset?: number;
    /** Page number (1-indexed), alternative to offset */
    page?: number;
    /**
     * Filter conditions keyed by field name.
     * Each value is a `[WhereFilterOp, value]` tuple or an array of tuples
     * for multiple conditions on the same field.
     *
     * @example
     * { status: ["==", "active"] }
     * { age: [">=", 18] }
     * { role: ["in", ["admin", "editor"]] }
     * { age: [[">=", 18], ["<", 65]] }
     */
    where?: FilterValues<string>;
    /** Logical grouping conditions (AND/OR) */
    logical?: LogicalCondition;
    /**
     * Sort order as a `[field, direction]` tuple.
     * @example orderBy: ["created_at", "desc"]
     */
    orderBy?: OrderByTuple;
    /** Relations to include in the response */
    include?: string[];
    /** Full-text search string */
    searchString?: string;
}

/**
 * Paginated response from a collection query.
 * @group Data
 */
export interface FindResponse<M extends Record<string, unknown> = Record<string, unknown>> {
    /** Array of entitys matching the query */
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
 * Fluent Query Builder Interface supported on both client and server accessors.
 * @group Data
 */
export interface QueryBuilderInterface<M extends Record<string, unknown> = Record<string, unknown>> {
    where<K extends keyof M & string>(column: K, operator: WhereFilterOp, value: WhereValue<M[K]>): this;
    where(logicalCondition: LogicalCondition): this;
    orderBy(column: keyof M & string, direction?: "asc" | "desc"): this;
    limit(count: number): this;
    offset(count: number): this;
    search(searchString: string): this;
    include(...relations: string[]): this;
    find(): Promise<FindResponse<M>>;
    listen(onUpdate: (data: FindResponse<M>) => void, onError?: (error: Error) => void): () => void;
}

/**
 * A single collection's CRUD accessor.
 *
 * This is the unified API surface used in both:
 * - The generated SDK (`client.data.products.create(...)`)
 * - Framework callbacks (`context.data.products.create(...)`)
 *
 * @group Data
 */
export interface CollectionAccessor<M extends Record<string, unknown> = Record<string, unknown>> {
    /**
     * Find multiple records with optional filtering, pagination, and sorting.
     */
    find(params?: FindParams): Promise<FindResponse<M>>;

    /**
     * Find a single record by its ID.
     */
    findById(id: string | number): Promise<Entity<M> | undefined>;

    /**
     * Create a new record.
     * @param data The entity data to create.
     * @param id Optional specific ID to use for the new record.
     * @returns The created entity
     */
    create(data: Partial<EntityValues<M>>, id?: string | number): Promise<Entity<M>>;

    /**
     * Update an existing record by ID.
     * @returns The updated entity
     */
    update(id: string | number, data: Partial<EntityValues<M>>): Promise<Entity<M>>;

    /**
     * Delete a record by ID.
     */
    delete(id: string | number): Promise<void>;

    /**
     * Delete all records in this collection.
     */
    deleteAll?(): Promise<void>;

    /**
     * Subscribe to a collection for real-time updates.
     * Optional method, may not be supported by all implementations (like stateless HTTP clients).
     */
    listen?(params: FindParams | undefined, onUpdate: (response: FindResponse<M>) => void, onError?: (error: Error) => void): () => void;

    /**
     * Subscribe to a single record for real-time updates.
     * Optional method.
     */
    listenById?(id: string | number, onUpdate: (entity: Entity<M> | undefined) => void, onError?: (error: Error) => void): () => void;

    /**
     * Count the number of records matching the given filter.
     */
    count?(params?: FindParams): Promise<number>;

    // Fluent Query Builder
    where<K extends keyof M & string>(column: K, operator: WhereFilterOp, value: WhereValue<M[K]>): QueryBuilderInterface<M>;
    where(logicalCondition: LogicalCondition): QueryBuilderInterface<M>;
    orderBy(column: keyof M & string, direction?: "asc" | "desc"): QueryBuilderInterface<M>;
    limit(count: number): QueryBuilderInterface<M>;
    offset(count: number): QueryBuilderInterface<M>;
    search(searchString: string): QueryBuilderInterface<M>;
    include(...relations: string[]): QueryBuilderInterface<M>;
}

// =============================================================================
// SDK-facing types — flat rows, no Entity wrapper
// =============================================================================

/**
 * Pagination metadata returned with collection queries.
 * @group Data
 */
export interface PaginationMeta {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
}

/**
 * Paginated response from a collection query (SDK-facing).
 * Returns flat rows instead of Entity-wrapped objects.
 *
 * @example
 * const { data, meta } = await rebase.data.posts.find();
 * console.log(data[0].title); // direct access — no .values
 * console.log(meta.total);
 *
 * @group Data
 */
export interface FindResult<M extends Record<string, unknown> = Record<string, unknown>> {
    /** Array of flat rows matching the query */
    data: M[];
    /** Pagination metadata */
    meta: PaginationMeta;
}

/**
 * Fluent Query Builder Interface for the SDK client.
 * Returns `FindResult<M>` (flat rows) instead of `FindResponse<M>` (Entity-wrapped).
 *
 * @group Data
 */
export interface SDKQueryBuilderInterface<M extends Record<string, unknown> = Record<string, unknown>> {
    where<K extends keyof M & string>(column: K, operator: WhereFilterOp, value: WhereValue<M[K]>): this;
    where(logicalCondition: LogicalCondition): this;
    orderBy(column: keyof M & string, direction?: "asc" | "desc"): this;
    limit(count: number): this;
    offset(count: number): this;
    search(searchString: string): this;
    include(...relations: string[]): this;
    find(): Promise<FindResult<M>>;
    count(): Promise<number>;
    listen(onUpdate: (data: FindResult<M>) => void, onError?: (error: Error) => void): () => void;
}

/**
 * SDK collection client — returns flat rows, no Entity wrapper.
 *
 * This is the public API surface for app developers using
 * `createRebaseClient()`. CMS internals use `CollectionAccessor` instead.
 *
 * @example
 * const { data: posts } = await rebase.data.posts.find();
 * console.log(posts[0].title);       // flat access
 * console.log(posts[0].id);          // id at top level
 *
 * const post = await rebase.data.posts.findById(1);
 * console.log(post?.title);          // no .values needed
 *
 * @group Data
 */
export interface SDKCollectionClient<M extends Record<string, unknown> = Record<string, unknown>> {
    /**
     * Find multiple records with optional filtering, pagination, and sorting.
     */
    find(params?: FindParams): Promise<FindResult<M>>;

    /**
     * Find a single record by its ID.
     */
    findById(id: string | number): Promise<M | undefined>;

    /**
     * Create a new record.
     * @param data The record data to create.
     * @param id Optional specific ID to use for the new record.
     * @returns The created row
     */
    create(data: Partial<M>, id?: string | number): Promise<M>;

    /**
     * Update an existing record by ID.
     * @returns The updated row, or `undefined` if the record does not exist.
     */
    update(id: string | number, data: Partial<M>): Promise<M | undefined>;

    /**
     * Delete a record by ID.
     * @returns Resolves, or returns `undefined` if the record does not exist.
     */
    delete(id: string | number): Promise<void | undefined>;

    /**
     * Delete all records in this collection.
     */
    deleteAll?(): Promise<void>;

    /**
     * Subscribe to a collection for real-time updates.
     */
    listen?(params: FindParams | undefined, onUpdate: (response: FindResult<M>) => void, onError?: (error: Error) => void): () => void;

    /**
     * Subscribe to a single record for real-time updates.
     */
    listenById?(id: string | number, onUpdate: (row: M | undefined) => void, onError?: (error: Error) => void): () => void;

    /**
     * Count the number of records matching the given filter.
     */
    count?(params?: FindParams): Promise<number>;

    // Fluent Query Builder
    where<K extends keyof M & string>(column: K, operator: WhereFilterOp, value: WhereValue<M[K]>): SDKQueryBuilderInterface<M>;
    where(logicalCondition: LogicalCondition): SDKQueryBuilderInterface<M>;
    orderBy(column: keyof M & string, direction?: "asc" | "desc"): SDKQueryBuilderInterface<M>;
    limit(count: number): SDKQueryBuilderInterface<M>;
    offset(count: number): SDKQueryBuilderInterface<M>;
    search(searchString: string): SDKQueryBuilderInterface<M>;
    include(...relations: string[]): SDKQueryBuilderInterface<M>;
}

/**
 * The unified data access object for the **admin CMS** (Entity-shaped).
 *
 * Access collections as dynamic properties: `data.products.find(...)`. Each
 * accessor returns `Entity`-wrapped records (`{ id, path, values }`) — the
 * view-model the CMS renders. This is what `useData()` / the admin
 * `RebaseContext.data` are backed by.
 *
 * App developers do NOT use this — they use {@link RebaseSdkData} (flat rows),
 * which is what the SDK client and backend `context.data` expose.
 *
 * @group Data
 */
export type RebaseData<DB = unknown> = {
    /**
     * Get a collection accessor by slug.
     * Alternative to dynamic property access for cases where
     * the collection name is a variable.
     *
     * @example
     * const accessor = data.collection("products");
     * await accessor.find({ limit: 10 });
     */
    collection<M extends Record<string, unknown> = Record<string, unknown>>(slug: string): CollectionAccessor<M>;
} & (
    DB extends Record<string, unknown>
        ? { [K in keyof DB]: CollectionAccessor<DB[K] extends { Row: infer R extends Record<string, unknown> } ? R : Record<string, unknown>> }
        : {
            /**
             * Dynamic collection accessor.
             * Access any collection by its slug as a property.
             *
             * @example
             * data.products.find({ where: { status: ["==", "published"] } })
             */
            [collectionSlug: string]: CollectionAccessor | ((slug: string) => CollectionAccessor);
        }
);

/**
 * The unified data access object for the **SDK** — flat rows, no Entity wrapper.
 *
 * This is the symmetric developer-facing data API, identical in shape on both
 * sides of the stack:
 * - The frontend SDK client (`client.data.products.find()`)
 * - Backend framework callbacks & scripts (`context.data.products.find()`)
 *
 * Every accessor returns flat rows (`{ id, ...columns }`) via
 * {@link SDKCollectionClient} — access fields directly (`row.title`), never
 * `row.values.title`. The admin CMS uses {@link RebaseData} (Entity) instead.
 *
 * @example
 * // Frontend SDK
 * const { data: posts } = await client.data.posts.find();
 * console.log(posts[0].title);        // flat — no .values
 *
 * // Backend callback — identical shape
 * callbacks: {
 *   beforeSave: async ({ context }) => {
 *     const product = await context.data.products.findById(id);
 *     console.log(product?.price);     // flat — no .values
 *   }
 * }
 *
 * @group Data
 */
export type RebaseSdkData<DB = unknown> = {
    /**
     * Get a flat collection accessor by slug.
     *
     * @example
     * const accessor = data.collection("products");
     * await accessor.find({ limit: 10 });
     */
    collection<M extends Record<string, unknown> = Record<string, unknown>>(slug: string): SDKCollectionClient<M>;
} & (
    DB extends Record<string, unknown>
        ? { [K in keyof DB]: SDKCollectionClient<DB[K] extends { Row: infer R extends Record<string, unknown> } ? R : Record<string, unknown>> }
        : {
            /**
             * Dynamic flat collection accessor.
             * Access any collection by its slug as a property.
             *
             * @example
             * data.products.find({ where: { status: ["==", "published"] } })
             */
            [collectionSlug: string]: SDKCollectionClient | ((slug: string) => SDKCollectionClient);
        }
);
