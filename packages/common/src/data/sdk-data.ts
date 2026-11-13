import {
    DataDriver,
    FindAllParams,
    FindParams,
    FindResult,
    IterateParams,
    LogicalCondition,
    OrderByTuple,
    PageWalkOptions,
    RebaseApiError,
    RebaseClientError,
    RebaseSdkData,
    RelationAggregateSort,
    SDKQueryBuilderInterface,
    SDKTableClient,
    WhereFilterOp,
    WhereValueFor,
    sortKeyToString,
    unsupportedMethod,
    type AggregateParams,
    type AggregateResult,
    type BatchOperation,
    type BatchResult,
    type ByIdReadOptions,
    type ComputedSortField,
    type FieldPath,
    type FilteredWriteParams,
    type IncludeSpec,
    type NonColumnFieldPath,
    type NullsPlacement,
    type RefreshOptions,
    type RestoreOptions,
    type TrashClient,
    type UpdateValues,
    type UpsertOptions,
    type WhereFor,
    type WriteOptions
} from "@rebasepro/types";
import { toSnakeCase } from "@rebasepro/utils";
import { mergeIncludeSpecs } from "./include-spec";
import { collectAllPages, paginateFind } from "./paginate";
import { normalizeOrderBy } from "./sort-dialect";
import { createDriverTableRows, type DriverTableRows, type SdkWriteCheck } from "./driver-rows";

/**
 * The developer SDK's data layer over a driver: `rebase.data`, a hook's
 * `context.data`, a cron's or a function's data plane. Built on the driver's
 * rows ({@link createDriverTableRows}) — the same rows the HTTP API serves
 * for the same query, handed to the caller as plain objects.
 *
 * @module
 */

/**
 * The key an aggregate comes back under — `@rebasepro/types`' derivation,
 * which the REST parser and the HTTP client use too.
 */
export { aggregateAlias } from "@rebasepro/types";

/**
 * What a client says when its data source cannot subscribe.
 *
 * Named rather than inlined so the sentence a caller sees does not depend on
 * which adapter happened to build the client.
 */
const noRealtime = (slug: string): string =>
    `Realtime is not available for "${slug}": its data source does not support subscriptions.`;

/** What a client says when its data source cannot count. */
const noCount = (slug: string): string =>
    `Counting is not available for "${slug}": its data source does not support it.`;

/** What `softDelete: true` names the field a delete stamps; a restore clears it. */
const DEFAULT_SOFT_DELETE_FIELD = "deletedAt";

/**
 * What a client says when its data source cannot aggregate.
 *
 * A stub rather than a fallback that fetches and reduces in JavaScript: that
 * would be wrong under a `limit` and unaffordable without one, and it would look
 * like it had worked.
 */
const noAggregate = (slug: string): string =>
    `Aggregates are not available for "${slug}": its data source does not implement them.`;

/** What a client says when its data source has no materialized views to refresh. */
const noRefresh = (slug: string): string =>
    `"${slug}" cannot be refreshed: its data source has no materialized views.`;

/**
 * The row a caller is handed: a copy of the driver's row without the search
 * metadata it carried (`_matches`). A copy, so a caller mutating it does not
 * reach the driver's cache; and the copy carries no `__etag` (non-enumerable),
 * so an in-process row never claims a version.
 */
function sdkRow<M extends Record<string, unknown>>(row: M): M {
    const { _matches: _dropped, ...values } = row;
    return values as M;
}

/**
 * Fluent query builder for the flat SDK data layer: resolves to
 * `FindResult<M>` (flat rows), as the browser client's builder does.
 */
class SdkQueryBuilder<M extends Record<string, unknown> = Record<string, unknown>> implements SDKQueryBuilderInterface<M> {
    private params: FindParams = { where: {} };

    constructor(private client: SDKTableClient<M>) {}

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

    /** Aggregate the matching rows. See {@link SDKTableClient.aggregate}. */
    async aggregate(
        params: Omit<AggregateParams<M>, "where" | "logical" | "searchString">
    ): Promise<AggregateResult> {
        return this.client.aggregate({
            ...params,
            where: this.params.where as AggregateParams<M>["where"],
            logical: this.params.logical as AggregateParams<M>["logical"],
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
 * Refuse a write option this door cannot honour, by name, before anything is
 * written.
 *
 * The in-process accessor implements the same `SDKTableClient` as the HTTP
 * client, whose `ifMatch` is "Honoured on `update` and `delete`" — and its
 * writes took no options at all, so `rebase.data.posts.update(id, data, {
 * ifMatch: staleEtag })` overwrote the row and resolved. A precondition the
 * caller wrote, dropped without a word, is the worst thing a door can do with
 * it. The driver's `save` has no precondition and no idempotency store to hand
 * these to, so they are refused rather than ignored. An `undefined` value is no
 * option, as it is over HTTP: `etagOf(row)` is `undefined` for a row that
 * carries no version, and that means "write unconditionally".
 */
function refuseUnhonouredWriteOptions(method: string, slug: string, options?: WriteOptions): void {
    const unsupported = (["ifMatch", "idempotencyKey"] as const).filter((key) => options?.[key]);
    if (unsupported.length === 0) return;
    throw new RebaseClientError(
        `${method}() on "${slug}" in-process (context.data, rebase.data) cannot honour ` +
        `${unsupported.join(" or ")}: this door has no ` +
        `${unsupported.includes("ifMatch") ? "precondition check" : "idempotency store"}, and ignoring ` +
        "the option would write as though it had been checked. Drop it here, or send the write through " +
        "the HTTP client, which honours it.",
        { code: "UNSUPPORTED_OPTION", details: { method, options: unsupported } }
    );
}

/**
 * A table's driver rows as the flat {@link SDKTableClient} — the same API
 * the browser client has: every row handed back is a {@link sdkRow}, every
 * capability the driver lacks is a stub that names it, and every argument
 * the HTTP client checks is checked here too.
 */
function toSdkTableClient<M extends Record<string, unknown>>(
    snap: DriverTableRows<M>,
    slug: string
): SDKTableClient<M> {
    const client: SDKTableClient<M> = {
        async find(params?: FindParams<M>): Promise<FindResult<M>> {
            const res = await snap.find(params);
            return { data: res.data.map(sdkRow), meta: res.meta };
        },
        // Pagination is shared with the HTTP client rather than reimplemented:
        // both transports satisfy the same `SDKTableClient`, so a walk that
        // behaved differently in-process than over the wire would be a bug the
        // type system could not see.
        iterate(params?: IterateParams<M>) {
            return paginateFind<M>((p) => client.find(p), params, slug);
        },
        findAll(params?: FindAllParams<M>) {
            return collectAllPages<M>((p) => client.find(p), params, slug);
        },
        async findById(id: string | number, options?: ByIdReadOptions): Promise<M | undefined> {
            const s = await snap.findById(id, options);
            return s ? sdkRow(s) : undefined;
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
            return sdkRow(s);
        },
        async create(data: Partial<M>, id?: string | number, options?: WriteOptions): Promise<M> {
            refuseUnhonouredWriteOptions("create", slug, options);
            return sdkRow(await snap.create(data as Partial<M>, id));
        },
        async createMany(
            data: Partial<M>[],
            options?: { upsert?: boolean; onConflict?: readonly string[]; where?: WhereFor<M>; ignoreDuplicates?: boolean } & WriteOptions
        ): Promise<M[]> {
            refuseUnhonouredWriteOptions("createMany", slug, options);
            if (!Array.isArray(data)) {
                throw new RebaseClientError("createMany expects an array of records.", { code: "INVALID_BULK_BODY" });
            }
            if (data.length === 0) return [];
            if (!snap.createMany) {
                throw new Error(
                    "Bulk writes are not supported by this collection's data source. " +
                    "Fall back to create() per record."
                );
            }
            const rows = await snap.createMany(data as Partial<M>[], {
                upsert: options?.upsert,
                onConflict: options?.onConflict,
                where: options?.where,
                ignoreDuplicates: options?.ignoreDuplicates
            });
            return rows.map(sdkRow);
        },
        /**
         * One row through the bulk path, because the bulk path is where the
         * conflict target lives.
         *
         * `DriverTableRows` has no single-row upsert and adding one would
         * mean a second way to say the same thing to the same driver method —
         * `saveMany` already takes `upsert` and `onConflict`, and a batch of
         * one is exactly an upsert of one.
         */
        async upsert(data: Partial<M>, options?: UpsertOptions<M>): Promise<M> {
            refuseUnhonouredWriteOptions("upsert", slug, options);
            if (!snap.createMany) {
                throw new Error(
                    "Upsert is not supported by this collection's data source: it needs a bulk write, " +
                    "which this driver does not implement. Fall back to create() or update()."
                );
            }
            const rows = await snap.createMany(
                [data as Partial<M>],
                { upsert: true, onConflict: options?.onConflict, where: options?.where, ignoreDuplicates: options?.ignoreDuplicates }
            );
            const row = rows[0];
            // Without a conflict rule a row always comes back; with one, a
            // stored row the rule kept is the `undefined` the overload types.
            if (!row && !options?.where && !options?.ignoreDuplicates) throw new Error(`Upsert into "${slug}" returned no row.`);
            return (row ? sdkRow(row) : undefined) as M;
        },
        async update(id: string | number, data: Partial<M> | UpdateValues<Partial<M>>, options?: WriteOptions): Promise<M> {
            refuseUnhonouredWriteOptions("update", slug, options);
            return sdkRow(await snap.update(id, data as Partial<M>));
        },
        async updateMany(
            updates: { id: string | number; data: Partial<M> | UpdateValues<Partial<M>> }[],
            options?: WriteOptions
        ): Promise<M[]> {
            refuseUnhonouredWriteOptions("updateMany", slug, options);
            if (!Array.isArray(updates)) {
                throw new RebaseClientError("updateMany expects an array of { id, data } entries.", { code: "INVALID_BULK_BODY" });
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
data: u.data as Partial<M> }))
            );
            return rows.map(sdkRow);
        },
        async delete(id: string | number, options?: WriteOptions): Promise<void> {
            refuseUnhonouredWriteOptions("delete", slug, options);
            return snap.delete(id);
        },
        async updateWhere(query: FilteredWriteParams<M>, data: Partial<M> | UpdateValues<Partial<M>>, options?: WriteOptions): Promise<M[]> {
            refuseUnhonouredWriteOptions("updateWhere", slug, options);
            if (!snap.updateWhere) {
                throw new Error(
                    "Filtered updates are not supported by this collection's data source. " +
                    "Read the rows, then updateMany() them."
                );
            }
            return (await snap.updateWhere(query, data as Partial<M>)).map(sdkRow);
        },
        async deleteWhere(query: FilteredWriteParams<M>, options?: WriteOptions): Promise<number> {
            refuseUnhonouredWriteOptions("deleteWhere", slug, options);
            if (!snap.deleteWhere) {
                throw new Error(
                    "Filtered deletes are not supported by this collection's data source. " +
                    "Read the rows, then deleteMany() their ids."
                );
            }
            return snap.deleteWhere(query);
        },
        async deleteMany(ids: (string | number)[], options?: WriteOptions): Promise<void> {
            refuseUnhonouredWriteOptions("deleteMany", slug, options);
            if (!Array.isArray(ids)) {
                throw new RebaseClientError("deleteMany expects an array of ids.", { code: "INVALID_BULK_BODY" });
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
        // The three are non-optional on `SDKTableClient`: where the
        // underlying accessor cannot serve one, a stub says so when called
        // rather than being absent. `isUnsupported()` is how an adapter asks
        // the capability question — the admin's Entity accessor has to.
        count: snap.count
            ? (params?: FindParams<M>) => snap.count!(params)
            : unsupportedMethod(noCount(slug)),
        listen: snap.listen
            ? (params: FindParams<M> | undefined, onUpdate: (r: FindResult<M>) => void, onError?: (e: Error) => void) =>
                snap.listen!(params, (res) => onUpdate({ data: res.data.map(sdkRow), meta: res.meta }), onError)
            : unsupportedMethod(noRealtime(slug)),
        listenById: snap.listenById
            ? (id: string | number, onUpdate: (r: M | undefined) => void, onError?: (e: Error) => void, options?: ByIdReadOptions) =>
                snap.listenById!(id, (s) => onUpdate(s ? sdkRow(s) : undefined), onError, options)
            : unsupportedMethod(noRealtime(slug)),
        // No driver counts live; the HTTP client's socket does.
        listenCount: unsupportedMethod(noRealtime(slug)),
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
            : unsupportedMethod(noAggregate(slug)),
        refresh: snap.refresh
            ? (options?: RefreshOptions) => snap.refresh!(options)
            : unsupportedMethod(noRefresh(slug)),
        trash: toSdkTrashClient(snap, slug, () => client)
    };
    return client;
}

/**
 * {@link SDKTableClient.trash} over a table's driver rows'
 * {@link DriverTableRows.trash}: the same API the browser client has. A
 * restore is the client's own `update`/`updateMany` setting the soft-delete
 * field to `null`, so it keeps their refusals and their answer.
 */
function toSdkTrashClient<M extends Record<string, unknown>>(
    snap: DriverTableRows<M>,
    slug: string,
    client: () => SDKTableClient<M>
): TrashClient<M> {
    const trash = snap.trash;
    const field = (options?: RestoreOptions<M>): string => options?.field ?? DEFAULT_SOFT_DELETE_FIELD;
    return {
        async find(params?: FindParams<M>): Promise<FindResult<M>> {
            const res = await trash.find(params);
            return { data: res.data.map(sdkRow), meta: res.meta };
        },
        count: (params?: FindParams<M>) => trash.count(params),
        restore: (id: string | number, options?: RestoreOptions<M>) =>
            client().update(id, { [field(options)]: null } as Partial<M>, writeOptionsOf(options)),
        restoreMany(ids: (string | number)[], options?: RestoreOptions<M>) {
            if (!Array.isArray(ids)) {
                return Promise.reject(new RebaseClientError(
                    "trash.restoreMany expects an array of ids.", { code: "INVALID_BULK_BODY" }
                ));
            }
            const data = { [field(options)]: null } as Partial<M>;
            return client().updateMany(ids.map((id) => ({ id, data })), writeOptionsOf(options));
        },
        async purge(id: string | number, options?: WriteOptions): Promise<void> {
            refuseUnhonouredWriteOptions("trash.purge", slug, options);
            await trash.purge(id);
        },
        async purgeMany(ids: (string | number)[], options?: WriteOptions): Promise<void> {
            refuseUnhonouredWriteOptions("trash.purgeMany", slug, options);
            if (!Array.isArray(ids)) {
                throw new RebaseClientError("trash.purgeMany expects an array of ids.", { code: "INVALID_BULK_BODY" });
            }
            if (ids.length === 0) return;
            if (!trash.purgeMany) {
                throw new Error(
                    "Bulk deletes are not supported by this collection's data source. " +
                    "Fall back to trash.purge() per record."
                );
            }
            await trash.purgeMany(ids);
        }
    };
}

/** A {@link RestoreOptions} without its `field`: the write options it carries. */
function writeOptionsOf<M extends Record<string, unknown>>(options?: RestoreOptions<M>): WriteOptions | undefined {
    if (!options) return undefined;
    const { field: _field, ...rest } = options;
    return rest;
}

/** What {@link buildSdkData} reads a driver with. */
export interface SdkDataOptions {
    /**
     * The slug a property of the proxy names (`data.myNotes`). Absent, a
     * property is its snake_case (`my_notes`). The server passes
     * `createAccessorSlugResolver` over its table registry, so a table is
     * reachable under the accessor its generated type has.
     */
    resolveAccessor?: (property: string) => string;

    /**
     * Where the driver stores the table a slug names, when that is not the
     * slug — a Firestore collection declared at another `path`. Asked on
     * every call (the answer may be registered later); absent, or answering
     * `undefined`, the slug is the stored path. Rows are served as stored.
     */
    resolveDataPath?: (slug: string) => string | undefined;

    /**
     * Asked before every write, `batch()` included, and expected to throw to
     * refuse it — see {@link SdkWriteCheck}. A caller-scoped server driver
     * passes the column write rules, so `context.data` writes on the API's
     * terms; `dataAsAdmin` passes none.
     */
    checkWrite?: SdkWriteCheck;
}

/**
 * Build a flat {@link RebaseSdkData} from a `DataDriver`.
 *
 * This is the developer-facing SDK data layer used by backend hooks,
 * functions, crons and scripts (`context.data` / `rebase.data` /
 * `rebase.dataAsAdmin`). It returns flat rows — identical in shape to the
 * frontend SDK client, down to how a relation is served: a foreign key stays
 * a foreign key, and a relation named in `include` arrives as the target's
 * own columns.
 *
 * `options.resolveAccessor` names the slug a property is (see
 * `createAccessorSlugResolver`); absent, `data.myNotes` is `my_notes`.
 *
 * `DB` types the result from a generated `Database` — `buildSdkData<Database>(driver)`
 * is the plane `context.data` is in a project that registered it. One object
 * serves every `Database` — each accessor is resolved by name when it is read —
 * so it describes the result and changes nothing it does. Only an explicit type
 * argument sets it (`NoInfer`): inferred from where the result is assigned, it
 * would be whatever that place declares. Untyped by default.
 *
 * @example
 * const data = buildSdkData(driver);
 * await data.products.create({ name: "Camera", price: 299 });
 * const { data: items } = await data.products.find({ where: { status: ["==", "published"] } });
 */
export function buildSdkData<DB = unknown>(
    driver: DataDriver,
    options?: SdkDataOptions
): RebaseSdkData<NoInfer<DB>> {
    const cache = new Map<string, SDKTableClient>();

    function getAccessor(slug: string): SDKTableClient {
        let accessor = cache.get(slug);
        if (!accessor) {
            const rows = createDriverTableRows(driver, slug, {
                storedPath: () => options?.resolveDataPath?.(slug) ?? slug,
                ...(options?.checkWrite ? { checkWrite: options.checkWrite } : {})
            });
            accessor = toSdkTableClient(rows, slug);
            cache.set(slug, accessor);
        }
        return accessor;
    }

    const slugOf = (accessor: string): string => options?.resolveAccessor?.(accessor) ?? toSnakeCase(accessor);

    // `client.batch()` in-process: the same operations, each table named by
    // its accessor and sent as its slug.
    const batch = async (operations: BatchOperation[]): Promise<BatchResult> => {
        if (!Array.isArray(operations)) {
            throw new RebaseClientError("batch expects an array of operations.", { code: "INVALID_BULK_BODY" });
        }
        if (operations.length === 0) return { data: [], meta: { operations: 0 } };
        if (!driver.batchWrite) {
            throw new RebaseClientError("This data source cannot write a batch atomically.", { code: "BATCH_UNSUPPORTED" });
        }
        for (const operation of operations) {
            if (!("values" in operation) || !operation.values) continue;
            options?.checkWrite?.(slugOf(operation.table), { ...operation.values }, operation.op === "update" ? "existing" : "new");
        }
        const data = await driver.batchWrite({
            operations: operations.map(operation => ({
                op: operation.op,
                path: slugOf(operation.table),
                ...("id" in operation ? { id: operation.id } : {}),
                ...("values" in operation ? { values: operation.values as Record<string, unknown> } : {}),
                ...(operation.op === "upsert" && operation.onConflict ? { onConflict: operation.onConflict } : {}),
                ...(operation.ref ? { ref: operation.ref } : {})
            }))
        });
        return { data, meta: { operations: operations.length } };
    };

    const target = { table: getAccessor, batch } as RebaseSdkData<DB>;

    return new Proxy(target, {
        get(_target, prop: string | symbol) {
            if (prop === "table") return getAccessor;
            if (prop === "batch") return batch;
            if (typeof prop === "symbol") return undefined;
            if (prop === "then" || prop === "toJSON" || prop === "$$typeof") return undefined;
            return getAccessor(slugOf(prop));
        }
    });
}
