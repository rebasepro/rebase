import { Entity, EntityValues } from "../types/entities";

/**
 * Parameters for querying a collection.
 * Uses PostgREST-style filter syntax for consistency between
 * the SDK (HTTP) and framework (in-process) contexts.
 *
 * @group Data
 */
/**
 * A where-clause value for a single field.
 *
 * Supports three syntaxes:
 *  1. **Equality shorthand**: raw JS values — `null`, `"active"`, `42`, `true`
 *  2. **Tuple syntax**: `[operator, value]` — `[">", 18]`, `["in", ["a","b"]]`
 *  3. **PostgREST string**: `"eq.published"`, `"gte.18"`, `"in.(a,b)"`
 *
 * @group Data
 */
export type WhereFieldValue =
    | string
    | number
    | boolean
    | null
    | [WhereFilterOpShort, any]
    | [WhereFilterOpShort, any][];

export type WhereValue<T> = T | T[] | null;

export interface LogicalCondition {
    type: "and" | "or";
    conditions: (FilterCondition | LogicalCondition)[];
}

export interface FilterCondition {
    column: string;
    operator: FilterOperator;
    value: unknown;
}

/** Short operator strings accepted in the tuple syntax. */
export type WhereFilterOpShort =
    | "==" | "!=" | ">" | ">=" | "<" | "<="
    | "eq" | "neq" | "gt" | "gte" | "lt" | "lte"
    | "in" | "nin" | "not-in"
    | "array-contains" | "array-contains-any" | "cs" | "csa";

export interface FindParams {
    /** Maximum number of items to return (default: 20) */
    limit?: number;
    /** Number of items to skip */
    offset?: number;
    /** Page number (1-indexed), alternative to offset */
    page?: number;
    /**
     * Filter object. Supports multiple syntaxes per field:
     *
     * **Equality shorthand** — raw JS values (null, string, number, boolean):
     * ```ts
     * { company_profile_id: null }
     * { status: "active" }
     * { age: 18 }
     * ```
     *
     * **Tuple syntax** — `[operator, value]`:
     * ```ts
     * { age: [">=", 18] }
     * { role: ["in", ["admin", "editor"]] }
     * { deleted_at: ["!=", null] }
     * ```
     *
     * **PostgREST string syntax** (original format):
     * ```ts
     * { status: "eq.published" }
     * { age: "gte.18" }
     * { role: "in.(admin,editor)" }
     * ```
     */
    where?: Record<string, WhereFieldValue>;
    /** Logical grouping conditions (AND/OR) */
    logical?: LogicalCondition;
    /**
     * Sort order. Format: "field:direction".
     * @example "created_at:desc", "name:asc"
     */
    orderBy?: string;
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

export type FilterOperator = WhereFilterOpShort;

/**
 * Fluent Query Builder Interface supported on both client and server accessors.
 * @group Data
 */
export interface QueryBuilderInterface<M extends Record<string, unknown> = Record<string, unknown>> {
    where<K extends keyof M & string>(column: K, operator: FilterOperator, value: WhereValue<M[K]>): this;
    where(logicalCondition: LogicalCondition): this;
    orderBy(column: keyof M & string, ascending?: "asc" | "desc"): this;
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
    where<K extends keyof M & string>(column: K, operator: FilterOperator, value: WhereValue<M[K]>): QueryBuilderInterface<M>;
    where(logicalCondition: LogicalCondition): QueryBuilderInterface<M>;
    orderBy(column: keyof M & string, ascending?: "asc" | "desc"): QueryBuilderInterface<M>;
    limit(count: number): QueryBuilderInterface<M>;
    offset(count: number): QueryBuilderInterface<M>;
    search(searchString: string): QueryBuilderInterface<M>;
    include(...relations: string[]): QueryBuilderInterface<M>;
}

/**
 * The unified data access object.
 *
 * Access collections as dynamic properties: `data.products.find(...)`.
 * In the SDK this is backed by HTTP transport (typed, generated per-project).
 * In the framework this is backed by a Proxy + in-process database driver (dynamic).
 *
 * @example
 * // SDK
 * const client = createRebaseClient({ baseUrl: "..." });
 * await client.data.products.create({ name: "Camera", price: 299 });
 *
 * // Framework callback
 * callbacks: {
 *   afterSave({ context }) {
 *     await context.data.logs.create({ action: "saved", timestamp: new Date() });
 *   }
 * }
 *
 * @group Data
 */
export interface RebaseData {
    /**
     * Get a collection accessor by slug.
     * Alternative to dynamic property access for cases where
     * the collection name is a variable.
     *
     * @example
     * const accessor = data.collection("products");
     * await accessor.find({ limit: 10 });
     */
    collection(slug: string): CollectionAccessor;

    /**
     * Dynamic collection accessor.
     * Access any collection by its slug as a property.
     *
     * @example
     * data.products.find({ where: { status: "eq.published" } })
     */
    [collectionSlug: string]: CollectionAccessor | ((slug: string) => CollectionAccessor);
}
