import type { VectorSearchParams } from "./data_driver";
import type { ComputedSortField } from "../types/search";
import { Entity, EntityValues } from "../types/entities";
import { WhereFilterOp, FieldPath, FilterValues, OrderByTuple } from "../types/filter-operators";

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
 * ## How the filter parameters combine
 *
 * `where`, `logical`, and `searchString` are **independent** and, when more
 * than one is present, are combined with **AND** — every clause must match.
 * Concretely the backend builds:
 *
 * ```text
 * (where filters, AND-ed together)
 *   AND (logical group)
 *   AND (searchString matches, OR-ed across searchable columns)
 * ```
 *
 * So `where` does **not** conflict with or override `logical` — they stack.
 * If you need `where` fields OR-ed with each other, move them into `logical`
 * instead. There is no way to OR `where` against `logical`; express anything
 * that isn't a plain AND of the three groups inside a single `logical` tree.
 *
 * ## Pagination precedence
 *
 * `limit`/`offset` and `page` describe the same window two ways. If **both
 * `offset` and `page` are provided, `page` wins** — the backend computes
 * `offset = (page - 1) * (limit ?? DEFAULT_LIST_LIMIT)` and ignores the
 * explicit `offset`. Pick one style per query.
 *
 * @group Data
 */
export interface FindParams<M extends Record<string, unknown> = Record<string, unknown>> {
    /**
     * Maximum number of items to return.
     *
     * Defaults to {@link DEFAULT_LIST_LIMIT}, and is clamped to
     * {@link MAX_LIST_LIMIT}. Both bounds are applied by the backend, so a
     * read is never unbounded whether or not a limit was asked for.
     */
    limit?: number;
    /**
     * Number of items to skip. Ignored when {@link FindParams.page} is also
     * set — `page` takes precedence.
     */
    offset?: number;
    /**
     * Page number (1-indexed), alternative to {@link FindParams.offset}.
     * When set, overrides `offset` as `(page - 1) * (limit ?? DEFAULT_LIST_LIMIT)`.
     */
    page?: number;
    /**
     * Filter conditions keyed by field name.
     * Each value is a `[WhereFilterOp, value]` tuple or an array of tuples
     * for multiple conditions on the same field. Multiple fields, and multiple
     * tuples on one field, are **AND-ed**; also AND-ed with `logical` and
     * `searchString` when present (see the interface docs).
     *
     * @example
     * { status: ["==", "active"] }
     * { age: [">=", 18] }
     * { role: ["in", ["admin", "editor"]] }
     * { age: [[">=", 18], ["<", 65]] }
     */
    where?: FilterValues<FieldPath<M>>;
    /**
     * Logical grouping conditions (AND/OR). Use this for anything `where`
     * can't express — notably OR-ing conditions. AND-ed with `where` and
     * `searchString` when present (see the interface docs).
     */
    logical?: LogicalCondition;
    /**
     * Sort order as a `[field, direction]` tuple.
     * @example orderBy: ["created_at", "desc"]
     */
    orderBy?: OrderByTuple<FieldPath<M> | ComputedSortField>;
    /**
     * Relations to include in the response.
     *
     * Deliberately `string[]` and not checked against `M`: a relation name
     * comes from the collection's `relations`, not from its columns, so nothing
     * in a generated row type can validate one.
     */
    include?: string[];
    /**
     * Text search string, AND-ed with `where`/`logical`. This is the value
     * behind the query builder's `.search()` method.
     *
     * What it compiles to depends on the collection. By default — matching
     * every collection that has not said otherwise — it is a case-insensitive
     * substring match OR-ed across the collection's top-level `string`
     * properties: it does not reach inside `map` or `array` properties, it does
     * not stem or rank, and it cannot use an index.
     *
     * A Postgres collection that declares a `search` block instead gets a
     * ranked full-text match over exactly the fields it named, and rows come
     * back with a {@link FindParams.orderBy}-able `_score`.
     */
    searchString?: string;

    /**
     * Nearest-neighbour search over a `vector` property.
     *
     * Postgres only, and only for a collection that declares a property of
     * type `vector`. Rows come back ordered by distance, closest first, each
     * carrying a `_distance`. Combines with `where` and `logical`, which are
     * applied as filters before the ordering — so this is "the nearest rows
     * that also match", not "the nearest rows, then filtered".
     *
     * Supplying the query vector is the caller's job: rebase stores and
     * searches embeddings, it does not compute them.
     */
    vectorSearch?: VectorSearchParams;
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
    where<K extends keyof M & string>(column: K, operator: WhereFilterOp, value: WhereValue<M[K]>): this;
    where(logicalCondition: LogicalCondition): this;
    orderBy(column: (keyof M & string) | ComputedSortField, direction?: "asc" | "desc"): this;
    limit(count: number): this;
    offset(count: number): this;
    search(searchString: string): this;

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
 * A single collection's CRUD accessor for the **admin panel** — every method
 * resolves to `Snapshot`-wrapped rows (`FindResponse<M>` / `Snapshot<M>`).
 *
 * @internal App developers do **not** use this. The public, symmetric surface
 * is {@link SDKCollectionClient} (flat rows), exposed as `client.data.products`
 * in the SDK and `context.data.products` in framework callbacks. This
 * Snapshot-flavored accessor backs the admin panel view-model only.
 *
 * @group Data
 */
export interface CollectionAccessor<M extends Record<string, unknown> = Record<string, unknown>> {
    /**
     * Find multiple records with optional filtering, pagination, and sorting.
     */
    find(params?: FindParams<M>): Promise<FindResponse<M>>;

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
     * Create many records in a single transaction.
     *
     * See {@link SDKCollectionClient.createMany}. Optional: not every driver can
     * write in bulk, and callers should fall back to `create` per record.
     */
    createMany?(data: Partial<EntityValues<M>>[], options?: { upsert?: boolean }): Promise<Entity<M>[]>;

    /**
     * Update an existing record by ID.
     * @returns The updated entity
     */
    update(id: string | number, data: Partial<EntityValues<M>>): Promise<Entity<M>>;

    /**
     * Update many records in a single transaction.
     *
     * See {@link SDKCollectionClient.updateMany}. Optional, as `createMany` is.
     */
    updateMany?(updates: { id: string | number; data: Partial<EntityValues<M>> }[]): Promise<Entity<M>[]>;

    /**
     * Delete many records in a single transaction.
     *
     * See {@link SDKCollectionClient.deleteMany}. Optional, as `createMany` is.
     */
    deleteMany?(ids: (string | number)[]): Promise<void>;

    /**
     * Delete a record by ID.
     */
    delete(id: string | number): Promise<void>;

    /**
     * Subscribe to a collection for real-time updates.
     * Optional method, may not be supported by all implementations (like stateless HTTP clients).
     */
    listen?(params: FindParams<M> | undefined, onUpdate: (response: FindResponse<M>) => void, onError?: (error: Error) => void): () => void;

    /**
     * Subscribe to a single record for real-time updates.
     * Optional method.
     */
    listenById?(id: string | number, onUpdate: (entity: Entity<M> | undefined) => void, onError?: (error: Error) => void): () => void;

    /**
     * Count the number of records matching the given filter.
     *
     * Optional on this contract because a data source need not support it, and
     * required on `CollectionClient` — the HTTP implementation always has it.
     * So `client.data.posts.count()` compiles in the browser while the same
     * call through a `context.data` accessor needs `count?.()`, which is the
     * one place the two halves of this API are not interchangeable.
     */
    count?(params?: FindParams<M>): Promise<number>;

    // Fluent Query Builder
    where<K extends keyof M & string>(column: K, operator: WhereFilterOp, value: WhereValue<M[K]>): QueryBuilderInterface<M>;
    where(logicalCondition: LogicalCondition): QueryBuilderInterface<M>;
    orderBy(column: (keyof M & string) | ComputedSortField, direction?: "asc" | "desc"): QueryBuilderInterface<M>;
    limit(count: number): QueryBuilderInterface<M>;
    offset(count: number): QueryBuilderInterface<M>;
    search(searchString: string): QueryBuilderInterface<M>;

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
    /**
     * Flat rows matching the query, each carrying whatever the query computed
     * for it — see {@link QueryComputedFields}.
     */
    data: (M & QueryComputedFields)[];
    /** Pagination metadata */
    meta: PaginationMeta;
}

/**
 * Values a query attaches to a row that are not columns of it.
 *
 * Both are absent unless the query asked for the thing that produces them, so
 * both are optional — and reading one on a query that did not ask returns
 * `undefined` rather than a wrong number.
 *
 * They live here rather than on the row type because a generated row type
 * describes a *table*, and neither of these is in one. Without this, a caller
 * who sorted by relevance could not then read the relevance.
 *
 * A `type` alias, deliberately, not an `interface`. TypeScript grants an
 * implicit index signature to a type alias and withholds it from an interface,
 * so `Row & QueryComputedFields` stops being assignable to
 * `Record<string, unknown>` the moment this becomes an interface. Seven casts
 * in one downstream app broke on exactly that.
 *
 * @group Data
 */
export type QueryComputedFields = {
    /**
     * Relevance, when the collection declares a {@link SearchConfig} and the
     * query carried a search string. Higher is better; the scale is not
     * comparable between two different search strings.
     */
    _score?: number;
    /**
     * Distance to the query vector, when the query used
     * {@link FindParams.vectorSearch}. Lower is closer, and the rows are
     * already ordered by it.
     */
    _distance?: number;
};

/**
 * Which column an iteration seeks on, for keyset ("seek") pagination.
 *
 * Either the column name on its own — sorted ascending — or the column plus an
 * explicit direction. The column must be **unique** and must be the column the
 * query is ordered by; see {@link PageWalkOptions.cursor}.
 *
 * @group Data
 */
export type CursorSpec<M extends Record<string, unknown> = Record<string, unknown>> =
    | (Extract<keyof M, string>)
    | { field: Extract<keyof M, string>; direction?: "asc" | "desc" };

/**
 * How {@link SDKCollectionClient.iterate} / {@link SDKCollectionClient.findAll}
 * walk a collection, layered on top of the normal `find()` parameters.
 *
 * @group Data
 */
export interface PageWalkOptions<M extends Record<string, unknown> = Record<string, unknown>> {
    /**
     * Rows fetched per request. Defaults to 200; values below 1 are clamped up.
     * This is the request size, not a result cap — the iteration keeps going
     * until the server says there is nothing left.
     */
    pageSize?: number;
    /**
     * Paginate by **seeking on a column** instead of by offset.
     *
     * Offset paging — the default — re-counts rows on every request, so a row
     * inserted or deleted *while the iteration runs* shifts the window and the
     * walk silently skips or repeats rows. Seeking is immune to that: each page
     * asks for rows strictly after the last one seen, so concurrent writes
     * before the cursor cannot move it.
     *
     * Prefer this whenever the collection has a unique, sortable column
     * (typically its primary key). The column must be unique — a repeated value
     * at a page boundary either skips rows or stalls, and the iterator throws
     * rather than looping — and the query is ordered by it, so a `cursor` and a
     * conflicting `orderBy` is an error, not a silent override.
     *
     * Implemented with the parameters `find()` already takes (an `orderBy` plus
     * a `>` / `<` filter on the cursor column), so it works on every transport
     * and needs nothing new from the server.
     *
     * @example
     * for await (const job of client.data.jobs.iterate({ cursor: "id" })) { … }
     */
    cursor?: CursorSpec<M>;
    /**
     * Hard ceiling on the number of requests one walk may make, so a server
     * that never stops saying `hasMore` cannot spin forever. Defaults to
     * 10 000 pages; hitting it throws.
     */
    maxPages?: number;
}

/**
 * Parameters accepted by {@link SDKCollectionClient.iterate} — everything
 * `find()` takes except the window itself (`limit`, `offset`, `page`), which
 * the iterator owns, plus the walk options.
 *
 * @group Data
 */
export type IterateParams<M extends Record<string, unknown> = Record<string, unknown>> =
    Omit<FindParams<M>, "limit" | "offset" | "page"> & PageWalkOptions<M>;

/**
 * Parameters accepted by {@link SDKCollectionClient.findAll}: the iteration
 * parameters plus the ceiling that keeps a whole collection from being pulled
 * into memory unnoticed.
 *
 * @group Data
 */
export type FindAllParams<M extends Record<string, unknown> = Record<string, unknown>> =
    IterateParams<M> & {
        /**
         * Most rows to materialise. Defaults to 10 000. Exceeding it **throws**
         * — a truncated array returned as if it were the whole answer is the
         * kind of quiet wrong that shows up months later in a report. Pass
         * `Infinity` to opt out deliberately, or use `iterate()` to stream.
         */
        maxRows?: number;
    };

/**
 * Fluent Query Builder Interface for the SDK client.
 * Returns `FindResult<M>` (flat rows) instead of `FindResponse<M>` (Entity-wrapped).
 *
 * @group Data
 */
export interface SDKQueryBuilderInterface<M extends Record<string, unknown> = Record<string, unknown>> {
    where<K extends keyof M & string>(column: K, operator: WhereFilterOp, value: WhereValue<M[K]>): this;
    where(logicalCondition: LogicalCondition): this;
    orderBy(column: (keyof M & string) | ComputedSortField, direction?: "asc" | "desc"): this;
    limit(count: number): this;
    offset(count: number): this;
    search(searchString: string): this;

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
    find(): Promise<FindResult<M>>;
    count(): Promise<number>;
    listen(onUpdate: (data: FindResult<M>) => void, onError?: (error: Error) => void): () => void;
}

/**
 * SDK collection client — returns flat rows, no Entity wrapper.
 *
 * This is the public API surface for app developers using
 * `createRebaseClient()`. admin internals use `CollectionAccessor` instead.
 *
 * Type parameters:
 * - `M` — the **Row** shape returned by reads (`find`, `findById`, `listen`).
 * - `I` — the **Insert** shape accepted by {@link create}. Defaults to
 *   `Partial<M>`; the generated SDK supplies a dedicated `Insert` type where
 *   required columns are required and auto-generated / read-only columns are
 *   omitted, so `create({})` on a table with required fields is a compile error.
 * - `U` — the **Update** shape accepted by {@link update}. Defaults to
 *   `Partial<M>`; the generated SDK supplies a dedicated `Update` type.
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
/**
 * Per-request options for a write.
 * @group Data
 */
export interface WriteOptions {
    /**
     * Names this write, so re-sending it is recognised instead of repeated.
     *
     * A client that does not see a response cannot know whether the write
     * committed. Retrying is therefore the only option, and without a key the
     * server has no way to tell a retry from a second, genuinely new write — so
     * it performs it again. On a table with a server-assigned id that is a
     * duplicate row, because the id the client chose was never used.
     *
     * Set by the offline queue on every replay. Honoured for 24 hours and scoped
     * to the authenticated user; a server that cannot store keys ignores it
     * rather than refusing the write.
     */
    idempotencyKey?: string;
}

export interface SDKCollectionClient<
    M extends Record<string, unknown> = Record<string, unknown>,
    I = Partial<M>,
    U = Partial<M>
> {
    /**
     * Find multiple records with optional filtering, pagination, and sorting.
     */
    find(params?: FindParams<M>): Promise<FindResult<M>>;

    /**
     * Walk every record matching a query, one row at a time, fetching pages as
     * the consumer consumes them.
     *
     * This is the pagination primitive: `find()` returns one window, `iterate()`
     * returns all of them without the caller hand-rolling the
     * `limit` / `offset += ` / "am I done yet" loop. Nothing is buffered — rows
     * are yielded as each page arrives, so a million-row walk costs one page of
     * memory. `break` stops the walk and no further requests are made.
     *
     * Termination is driven by the server's `meta.hasMore`, never by comparing
     * a page's length against the requested limit — a final page that happens
     * to be exactly full is indistinguishable that way, and a walk that stops
     * there drops rows. An empty page also ends the walk, and
     * {@link PageWalkOptions.maxPages} bounds a server that never stops saying
     * there is more.
     *
     * ## Consistency
     *
     * By default this pages by **offset**, which is only as stable as the table
     * is still: a row inserted or deleted ahead of the cursor between two
     * requests shifts every later window, so the walk can skip a row or hand
     * back the same one twice. That is inherent to offset paging, not a bug
     * here. On a collection with a unique sortable column, pass
     * {@link PageWalkOptions.cursor} to seek on it instead — the walk then
     * asks for rows strictly after the last one it saw, which concurrent writes
     * cannot perturb.
     *
     * @example
     * for await (const job of client.data.jobs.iterate({
     *     where: { status: ["==", "queued"] },
     *     cursor: "id",
     *     pageSize: 500
     * })) {
     *     await handle(job);
     * }
     */
    iterate(params?: IterateParams<M>): AsyncIterableIterator<M>;

    /**
     * {@link iterate}, collected into an array.
     *
     * Convenient when the result is known to be small and awkward to stream.
     * Because "known to be small" is an assumption and not a fact, the result is
     * capped — 10 000 rows by default — and going over the cap **throws**
     * rather than returning a short array that reads like a complete one. Raise
     * {@link FindAllParams.maxRows} when the data really is bigger, or switch to
     * `iterate()` and stream it.
     *
     * The offset-drift caveat on {@link iterate} applies here too.
     *
     * @throws When more rows match than `maxRows` allows.
     *
     * @example
     * const overdue = await client.data.invoices.findAll({
     *     where: { due_at: ["<", today] },
     *     cursor: "id"
     * });
     */
    findAll(params?: FindAllParams<M>): Promise<M[]>;

    /**
     * Find a single record by its ID.
     */
    findById(id: string | number): Promise<M | undefined>;

    /**
     * Create a new record.
     * @param data The record data to create (the collection's `Insert` shape).
     * @param id Optional specific id, sent as an `id` column. This is for tables
     *   whose key *is* `id`: the value goes in as that column. For a table keyed
     *   on anything else (a `sku`, a composite key), there is no `id` column to
     *   receive it — put the key in `data` instead, where it belongs among the
     *   columns.
     * @returns The created row
     */
    create(data: I, id?: string | number, options?: WriteOptions): Promise<M>;

    /**
     * Write many records in a single request and a single transaction.
     *
     * Built for imports and ETL, where one call per row means one HTTP round
     * trip and one transaction per row. Every record still runs the normal
     * pipeline — callbacks, relations, row-level security — and the batch is
     * all-or-nothing: if any record is rejected, none of them land and the
     * error names the offending index.
     *
     * A record carrying its primary key updates that row; one without inserts.
     * With `{ upsert: true }` each record is written as INSERT ... ON CONFLICT
     * DO UPDATE on the primary key instead, which is what makes a re-runnable
     * import idempotent.
     *
     * Batches are capped server-side (1000 rows by default) because one batch
     * holds its locks for the whole transaction — chunk larger jobs.
     *
     * Pass {@link WriteOptions.idempotencyKey} on anything that may be retried.
     * A client that never sees the response cannot know whether the batch
     * committed, and without a key the server cannot tell the retry from a
     * second genuine import — so it performs it again, duplicating every row in
     * the batch rather than just one.
     *
     * @returns The written rows, in the order given.
     *
     * @example
     * ```ts
     * for (const chunk of chunks(rows, 1000)) {
     *     await client.data.products.createMany(chunk, { upsert: true });
     * }
     * ```
     */
    createMany(data: I[], options?: { upsert?: boolean } & WriteOptions): Promise<M[]>;

    /**
     * Update an existing record by ID.
     * @param data The fields to update (the collection's `Update` shape).
     * @returns The updated row.
     * @throws {RebaseApiError} with status 404 when the record does not exist.
     */
    update(id: string | number, data: U): Promise<M>;

    /**
     * Update many records in a single request and a single transaction.
     *
     * The counterpart to {@link createMany}, and the reason it exists is the
     * same: one call per row means one HTTP round trip and one transaction per
     * row. Every record still runs the normal pipeline — callbacks, relations,
     * row-level security — and the batch is all-or-nothing, so a rejected
     * record leaves none of them written and the error names the offending
     * index.
     *
     * Each entry is `{ id, data }` rather than a flat row carrying its own key.
     * That is deliberate: on a table keyed on something other than `id` — a
     * `sku`, a composite key — a flat row cannot say whether a column is the
     * address or a value to write. Naming the address separately mirrors
     * single-row `update(id, data)` exactly and leaves nothing to infer.
     *
     * An id that matches no row fails the batch with a 404 rather than being
     * skipped, for the same reason `update()` does: silently updating four of
     * five rows is worse than updating none.
     *
     * Batches share `createMany`'s server-side cap (1000 rows by default),
     * because one batch holds its locks for the whole transaction.
     *
     * Pass {@link WriteOptions.idempotencyKey} on anything that may be retried.
     * An update replayed in full is naturally idempotent, but one interleaved
     * with another writer's is not — the key is what stops a lost ACK from
     * re-applying a stale batch over newer data.
     *
     * @returns The updated rows, in the order given.
     *
     * @example
     * ```ts
     * await client.data.orders.updateMany([
     *     { id: "o-1", data: { status: "shipped" } },
     *     { id: "o-2", data: { status: "shipped" } }
     * ]);
     * ```
     */
    updateMany(updates: { id: string | number; data: U }[], options?: WriteOptions): Promise<M[]>;

    /**
     * Delete a record by ID.
     * @throws {RebaseApiError} with status 404 when the record does not exist.
     */
    delete(id: string | number): Promise<void>;

    /**
     * Delete many records in a single request and a single transaction.
     *
     * Takes ids, not a filter. A filter-shaped bulk delete is a different and
     * far more dangerous operation — the failure mode is an omitted or
     * mistyped condition emptying a table, and it cannot be reviewed at the
     * call site the way an explicit list can. Read first, then pass the ids you
     * meant.
     *
     * `beforeDelete` and `afterDelete` fire per row, exactly as they do for
     * single deletes, and returning `false` from `beforeDelete` fails the batch
     * rather than quietly dropping one row from it. All-or-nothing, so an id
     * that matches no row 404s the whole call.
     *
     * Shares `createMany`'s row cap.
     *
     * @example
     * ```ts
     * const stale = await client.data.sessions.findAll({
     *     where: { expires_at: ["<", cutoff] }
     * });
     * await client.data.sessions.deleteMany(stale.map(s => s.id as string));
     * ```
     */
    deleteMany(ids: (string | number)[], options?: WriteOptions): Promise<void>;

    /**
     * The low-level realtime subscription: raw server pushes, nothing else.
     *
     * **Prefer `observe()`** on a client from `@rebasepro/client`, which wraps
     * this one and is what a UI actually wants — it emits from the local
     * database first when offline is enabled, re-emits on local writes and
     * rollbacks, and de-duplicates emissions so a refresh that changes nothing
     * does not call back. `listen` does none of that; it forwards what the
     * socket sends.
     *
     * Optional because it is only present when realtime is enabled. `observe()`
     * is not — it degrades to a single fetch — which is the other reason to
     * reach for it instead.
     */
    listen?(params: FindParams<M> | undefined, onUpdate: (response: FindResult<M>) => void, onError?: (error: Error) => void): () => void;

    /** {@link listen} for a single row. Prefer `observeById()`. */
    listenById?(id: string | number, onUpdate: (row: M | undefined) => void, onError?: (error: Error) => void): () => void;

    /**
     * Count the number of records matching the given filter.
     */
    count?(params?: FindParams<M>): Promise<number>;

    // Fluent Query Builder
    where<K extends keyof M & string>(column: K, operator: WhereFilterOp, value: WhereValue<M[K]>): SDKQueryBuilderInterface<M>;
    where(logicalCondition: LogicalCondition): SDKQueryBuilderInterface<M>;
    orderBy(column: (keyof M & string) | ComputedSortField, direction?: "asc" | "desc"): SDKQueryBuilderInterface<M>;
    limit(count: number): SDKQueryBuilderInterface<M>;
    offset(count: number): SDKQueryBuilderInterface<M>;
    search(searchString: string): SDKQueryBuilderInterface<M>;
    /**
     * Order rows by nearest-neighbour distance to `vector`, closest first.
     * Postgres only, over a `type: "vector"` property. See
     * {@link SDKQueryBuilderInterface.vectorSearch}.
     */
    vectorSearch(
        property: string,
        vector: number[],
        options?: { distance?: "cosine" | "l2" | "inner_product"; threshold?: number }
    ): SDKQueryBuilderInterface<M>;
    include(...relations: string[]): SDKQueryBuilderInterface<M>;
}

/**
 * The unified data access object for the **admin panel** (Entity-shaped).
 *
 * Access collections as dynamic properties: `data.products.find(...)`. Each
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
             * The index signature is `CollectionAccessor` alone, for the reason
             * spelled out on {@link RebaseSdkData}: unioning in the `collection`
             * method's own signature is unnecessary across an intersection, and it
             * costs `data.products.find()` — the access this `@example` documents.
             *
             * @example
             * data.products.find({ where: { status: ["==", "published"] } })
             */
            [collectionSlug: string]: CollectionAccessor;
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
 * Every accessor returns flat rows (the table's columns) via
 * {@link SDKCollectionClient} — access fields directly (`row.title`), never
 * `row.values.title`. The admin uses {@link RebaseData} (Entity) instead.
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
/**
 * Extract the `Row` shape from a generated `Database[slug]` entry, falling
 * back to an open record when the entry is untyped.
 * @group Data
 */
export type RowOf<T> = T extends { Row: infer R extends Record<string, unknown> } ? R : Record<string, unknown>;

/**
 * Extract the `Insert` shape from a generated `Database[slug]` entry (the
 * input accepted by `create`), falling back to `Partial<Row>`.
 * @group Data
 */
export type InsertOf<T> = T extends { Insert: infer I extends Record<string, unknown> } ? I : Partial<RowOf<T>>;

/**
 * Extract the `Update` shape from a generated `Database[slug]` entry (the
 * input accepted by `update`), falling back to `Partial<Row>`.
 * @group Data
 */
export type UpdateOf<T> = T extends { Update: infer U extends Record<string, unknown> } ? U : Partial<RowOf<T>>;

/**
 * Note on the untyped branch below: its index signature is
 * `SDKCollectionClient`, NOT `SDKCollectionClient | ((slug: string) => …)`.
 *
 * The union looks like it is needed so `collection` — a method on this same
 * object — satisfies the index signature. It is not, because `collection` is
 * declared in a *separate* member of the intersection, and TypeScript only
 * requires named properties to be assignable to an index signature declared
 * alongside them. Including the function arm cost the documented accessor:
 *
 *     rebase.dataAsAdmin.projects.find()
 *     //                          ^ Property 'find' does not exist on type
 *     //                            'SDKCollectionClient | ((slug: string) => …)'
 *
 * Every project without a generated `Database` type lands on this branch, so
 * property-style access — the form used by the `@example` below, by the
 * scaffolded function template, and by the 0.13 migration note — did not
 * compile for any of them. Do not restore the arm; use `collection(slug)` if a
 * caller genuinely needs the by-slug function.
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
        ? { [K in keyof DB]: SDKCollectionClient<RowOf<DB[K]>, InsertOf<DB[K]>, UpdateOf<DB[K]>> }
        : {
            /**
             * Dynamic flat collection accessor.
             * Access any collection by its slug as a property.
             *
             * @example
             * data.products.find({ where: { status: ["==", "published"] } })
             */
            [collectionSlug: string]: SDKCollectionClient;
        }
);
