import { toDriverAggregate, toDriverAggregateGroup } from "@rebasepro/types";
import {
    DataDriver,
    DEFAULT_VECTOR_LIST_LIMIT,
    FindParams,
    PaginationMeta,
    type AggregateGroup,
    type AggregateMeta,
    type AggregateParams,
    type AggregateResult,
    type ByIdReadOptions,
    type FilteredWriteParams,
    type RefreshOptions,
    type WhereFor
} from "@rebasepro/types";
import { cursorToStartAfter, decodeCursor, reconcileCursorOrder } from "./cursor";
import { resolveFindWindow } from "./paginate";
import { normalizeOrderBy } from "./sort-dialect";
import { deserializeFilter } from "./filter-dialect";

/**
 * One page of rows as a driver read served them, with its pagination.
 *
 * The rows are the driver's own objects: query metadata (`_matches`) and the
 * read's version (`__etag`, see `withETag`) still ride on them. The SDK
 * hands a caller a copy without either; the admin's view model reads both.
 */
export interface DriverRowPage<M extends Record<string, unknown> = Record<string, unknown>> {
    data: M[];
    meta: PaginationMeta;
}

/**
 * The rows of one table of a {@link DataDriver}: every read and write the
 * SDK (`buildSdkData`) and the admin's accessor over a driver are built on,
 * in one place, so the two read and write a table identically.
 *
 * A method is present exactly when the driver can serve it; `trash` always
 * is (a driver without a REST read reads it through `fetchCollection`).
 */
export interface DriverTableRows<M extends Record<string, unknown> = Record<string, unknown>> {
    /** A page of the table, counted where the driver can count (see the implementation). */
    find(params?: FindParams<M>): Promise<DriverRowPage<M>>;
    /** One row by its address; `include` reaches a driver with a REST read only. */
    findById(id: string | number, options?: ByIdReadOptions): Promise<M | undefined>;
    /** Insert a row (`save` with status `new`). */
    create(data: Partial<M>, id?: string | number): Promise<M>;
    /** Insert many rows, or upsert them (`saveMany`). */
    createMany?(
        data: Partial<M>[],
        options?: { upsert?: boolean; onConflict?: readonly string[]; where?: WhereFor<M>; ignoreDuplicates?: boolean }
    ): Promise<M[]>;
    /** Update a row by its address (`save` with status `existing`). */
    update(id: string | number, data: Partial<M>): Promise<M>;
    /** Update many rows by address in one transaction. */
    updateMany?(updates: { id: string | number; data: Partial<M> }[]): Promise<M[]>;
    /** Delete a row by its address (soft where the table soft-deletes). */
    delete(id: string | number): Promise<void>;
    /** Delete many rows by address in one transaction. */
    deleteMany?(ids: (string | number)[]): Promise<void>;
    /** Update every row a filter matches. */
    updateWhere?(query: FilteredWriteParams<M>, data: Partial<M>): Promise<M[]>;
    /** Delete every row a filter matches; answers how many. */
    deleteWhere?(query: FilteredWriteParams<M>): Promise<number>;
    /** Count the rows `find(params)` would read. */
    count?(params?: FindParams<M>): Promise<number>;
    /** Aggregate the matching rows, paged like the REST route when grouped. */
    aggregate?(params: AggregateParams<M>): Promise<AggregateResult>;
    /** Refresh a materialized view. */
    refresh?(options?: RefreshOptions): Promise<void>;
    /** The soft-deleted rows, and the hard delete. */
    trash: {
        find(params?: FindParams<M>): Promise<DriverRowPage<M>>;
        count(params?: FindParams<M>): Promise<number>;
        purge(id: string | number): Promise<void>;
        purgeMany?(ids: (string | number)[]): Promise<void>;
    };
    /** Subscribe to a page of the table: every frame is the page's rows. */
    listen?(params: FindParams<M> | undefined, onUpdate: (page: DriverRowPage<M>) => void, onError?: (error: Error) => void): () => void;
    /** Subscribe to one row: every frame is the row, or `undefined` once it is gone. */
    listenById?(id: string | number, onUpdate: (row: M | undefined) => void, onError?: (error: Error) => void, options?: ByIdReadOptions): () => void;
}

/** What a {@link createDriverTableRows} call reads and writes. */
export interface DriverTableRowsOptions {
    /**
     * Where the driver stores the table — asked on every call, because the
     * answer may be registered after the rows are built and can change while
     * they live. Absent: the slug.
     */
    storedPath?: () => string;
}

/** A driver row, typed as the rows of the table it was read from. */
function asRow<M extends Record<string, unknown>>(row: Record<string, unknown>): M {
    return row as M;
}

/**
 * The rows of table `slug` of `driver` — see {@link DriverTableRows}.
 *
 * @example
 * const posts = createDriverTableRows(driver, "posts");
 * const { data, meta } = await posts.find({ where: { status: ["==", "published"] } });
 */
export function createDriverTableRows<M extends Record<string, unknown> = Record<string, unknown>>(
    driver: DataDriver,
    slug: string,
    options: DriverTableRowsOptions = {}
): DriverTableRows<M> {
    const storedPath = options.storedPath ?? (() => slug);

    /**
     * One page of the table, and its count. `withDeleted: "only"` reads the
     * trash (see `trash` below) through the same pipeline, so a trashed page
     * is paged, counted and shaped exactly as a live one.
     */
    async function findRows(params?: FindParams<M>, withDeleted?: "only"): Promise<DriverRowPage<M>> {
        // Ensure filters are in canonical [op, value] format even if passed as PostgREST strings
        const filter = params?.where ? deserializeFilter(params.where as Record<string, unknown>) : undefined;
        const window = resolveFindWindow(params);
        const { offset, driverOffset } = window;
        // A vector search nobody bounded reads the nearest
        // DEFAULT_VECTOR_LIST_LIMIT rows, as it does over HTTP — not 50
        // rows ordered by distance. The `page` stride stays the plain one,
        // as the HTTP parser's does.
        const limit = params?.limit === undefined && params?.vectorSearch
            ? DEFAULT_VECTOR_LIST_LIMIT
            : window.limit;

        // Keyset paging, through the same codec and the same driver
        // comparison the HTTP route uses. The in-process accessor is a
        // transport like any other: a walk that seeked differently here
        // than over the wire would be a difference the types cannot see.
        const cursor = params?.after ? decodeCursor(params.after) : undefined;
        const sort = cursor
            ? reconcileCursorOrder(cursor, normalizeOrderBy(params?.orderBy))
            : normalizeOrderBy(params?.orderBy);
        // A cursor issued for an unsorted read carries an empty sort; the
        // HTTP route hands the driver none at all, and so does this.
        const orderBy = sort && sort.length > 0 ? sort : undefined;
        const startAfter = cursor ? cursorToStartAfter(cursor) : undefined;

        // One relation shape, whatever the call looks like: the REST pipeline
        // is the published contract — the shape the HTTP API serves for this
        // same query, and what `RestFetchService` documents — so every read
        // goes through it when the driver has one. Drivers without one (every
        // browser driver) read through `fetchCollection`.
        //
        // One row past the page, when seeking — and when not counting.
        //
        // `hasMore` on an offset page is `offset + rows.length < total`, and
        // under a cursor that arithmetic is simply false: every seeked page
        // runs at offset 0, so it compares one page against the whole
        // collection and says "more" forever. Without a count there is
        // nothing to compare against at all. Asking for `limit + 1` and
        // looking at whether the extra row arrived is the answer both have —
        // and it costs nothing, where the count it replaces is a second
        // query over every matching row.
        //
        // Counted only where the HTTP listing counts (`RestApiGenerator.readPage`).
        // A distinct read collapses rows the count would count one by one,
        // so its total described a different set from the one served, and
        // `hasMore` — derived from it — offered pages that did not exist.
        // A vector search with a threshold is a distance computed for every
        // row of the table, beside a page an index serves in a millisecond.
        const seeking = startAfter !== undefined;
        const counting = driver.count !== undefined
            && params?.count !== "none"
            && params?.distinct !== true
            && params?.vectorSearch?.threshold === undefined;
        const probing = seeking || !counting;
        const probeLimit = probing ? limit + 1 : limit;

        // The page and its count in one transaction where the driver can
        // run them so — see `DataDriver.readTogether`.
        const read = async (reader: DataDriver) => {
            const fetchService = reader.restFetchService;
            const fetched = fetchService
                ? await fetchService.fetchCollectionForRest(
                    storedPath(),
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
                        offset: seeking ? undefined : driverOffset,
                        startAfter,
                        orderBy,
                        searchString: params?.searchString,
                        searchExplain: params?.searchExplain,
                        // Left out, `.vectorSearch(…).find()` in a function
                        // or a cron read the newest rows in id order, with
                        // no `_distance` and no error.
                        vectorSearch: params?.vectorSearch,
                        fields: params?.fields,
                        distinct: params?.distinct,
                        ...(withDeleted ? { withDeleted } : {})
                    },
                    params?.include
                )
                : await reader.fetchCollection<M>({
                    path: storedPath(),
                    limit: probeLimit,
                    offset: seeking ? undefined : driverOffset,
                    startAfter,
                    filter,
                    logical: params?.logical,
                    orderBy,
                    searchString: params?.searchString,
                    searchExplain: params?.searchExplain,
                    vectorSearch: params?.vectorSearch,
                    include: params?.include,
                    fields: params?.fields,
                    distinct: params?.distinct,
                    ...(withDeleted ? { withDeleted } : {})
                });
            // The same narrowing the rows were read with. Counting only by
            // `filter` reported the whole collection beside a narrowed
            // page, and `hasMore` was derived from it — so the list offered
            // a next page that did not exist.
            const counted = counting && reader.count
                ? await reader.count({
                    path: storedPath(),
                    filter,
                    logical: params?.logical,
                    searchString: params?.searchString,
                    vectorSearch: params?.vectorSearch,
                    ...(withDeleted ? { withDeleted } : {})
                })
                : undefined;
            return { fetched, counted };
        };
        // One read without a count: nothing to keep on one snapshot with it.
        const { fetched, counted } = counting && driver.readTogether
            ? await driver.readTogether(read)
            : await read(driver);

        // The probe row is evidence, not data — it is never served.
        const rows = probing ? fetched.slice(0, limit) : fetched;

        // Without a count, the rows up to the end of this page: all a
        // driver that cannot count has ever been able to report.
        const total = counted ?? rows.length + offset;
        const hasMore = probing ? fetched.length > limit : offset + rows.length < total;

        // The cursor for the *next* page, from the last row served. Issued
        // by the driver, which is the only layer that knows which columns
        // address a row; absent where it cannot describe one, and the
        // caller then pages by offset.
        const last = rows[rows.length - 1] as Record<string, unknown> | undefined;
        const nextCursor = (hasMore && last && driver.restFetchService?.cursorFor)
            ? driver.restFetchService.cursorFor(storedPath(), last, orderBy)
            : undefined;

        return {
            data: rows.map(row => asRow<M>(row)),
            meta: { total, limit, offset, hasMore, ...(nextCursor && { nextCursor }) }
        };
    }

    async function countRows(params?: FindParams<M>, withDeleted?: "only"): Promise<number> {
        const count = driver.count;
        if (!count) throw new Error(`Counting is not available for "${slug}": its data source does not support it.`);
        const filter = params?.where ? deserializeFilter(params.where as Record<string, unknown>) : undefined;
        // Every narrowing `find()` applies has to apply here too, or the
        // count describes a different query than the one it is reported
        // against.
        return count.call(driver, {
            path: storedPath(),
            filter,
            logical: params?.logical,
            searchString: params?.searchString,
            // A threshold drops rows, so it narrows the count as it narrows
            // the read — as `GET /count` does.
            vectorSearch: params?.vectorSearch,
            ...(withDeleted ? { withDeleted } : {})
        });
    }

    return {
        find: (params?: FindParams<M>) => findRows(params),

        async findById(id: string | number, byIdOptions?: ByIdReadOptions): Promise<M | undefined> {
            // Same contract as `find` above: one row read the same way the
            // table read is, so `find()[0]` and `findById()` agree.
            const fetchService = driver.restFetchService;
            const row = fetchService
                ? await fetchService.fetchOneForRest(storedPath(), id, byIdOptions?.include)
                : await driver.fetchOne<M>({ path: storedPath(), id });
            return row ? asRow<M>(row) : undefined;
        },

        // Present only when the driver's fetch service implements it — the SDK
        // turns an absent one into a stub that names the capability.
        aggregate: driver.restFetchService?.aggregate
            ? async (params: AggregateParams<M>): Promise<AggregateResult> => {
                // Paged the way the REST route pages it: one group past the
                // `limit`, so `meta.hasMore` is known rather than guessed from a
                // page that happened to come back full. No default limit here —
                // an in-process caller that names none gets every group, as it
                // always did — so `meta` is only for a call that named one.
                const grouped = (params.groupBy?.length ?? 0) > 0;
                const limit = grouped ? params.limit : undefined;
                const rows: AggregateResult = await driver.restFetchService!.aggregate!(storedPath(), {
                    aggregates: params.select.map(select => select.where
                        ? { ...toDriverAggregate(select), filter: deserializeFilter(select.where as Record<string, unknown>) }
                        : toDriverAggregate(select)),
                    groupBy: params.groupBy?.map(group => toDriverAggregateGroup(group as string | AggregateGroup)),
                    filter: params.where
                        ? deserializeFilter(params.where as Record<string, unknown>)
                        : undefined,
                    logical: params.logical,
                    searchString: params.searchString,
                    limit: limit !== undefined ? limit + 1 : params.limit,
                    offset: params.offset,
                    // The sort the HTTP route forwards. Dropped here, an
                    // in-process `aggregate({ orderBy: ["sum_total", "desc"] })`
                    // came back in group-key order instead.
                    orderBy: normalizeOrderBy(params.orderBy)
                });
                if (limit === undefined) return rows;
                const page: AggregateResult = rows.slice(0, limit);
                const meta: AggregateMeta = { limit, offset: params.offset ?? 0, hasMore: rows.length > limit };
                Object.defineProperty(page, "meta", { value: meta, enumerable: false });
                return page;
            }
            : undefined,

        refresh: driver.refreshView
            ? (refreshOptions?: RefreshOptions) => driver.refreshView!(storedPath(), refreshOptions)
            : undefined,

        async create(data: Partial<M>, id?: string | number): Promise<M> {
            return asRow<M>(await driver.save<M>({ path: storedPath(), values: data, id, status: "new" }));
        },

        createMany: driver.saveMany
            ? async (data, createOptions): Promise<M[]> => {
                const rows = await driver.saveMany!<M>({
                    path: storedPath(),
                    rows: data,
                    upsert: createOptions?.upsert,
                    // Dropped here, an `upsert` on a natural key silently
                    // became an upsert on the primary key — which for a serial
                    // id is a plain insert, so the re-runnable import the
                    // option exists for duplicated every row instead.
                    onConflict: createOptions?.onConflict,
                    ...(createOptions?.where ? { conflictWhere: deserializeFilter(createOptions.where as Record<string, unknown>) } : {}),
                    ...(createOptions?.ignoreDuplicates ? { ignoreDuplicates: true } : {})
                });
                return rows.map(row => asRow<M>(row));
            }
            : undefined,

        async update(id: string | number, data: Partial<M>): Promise<M> {
            return asRow<M>(await driver.save<M>({ path: storedPath(), values: data, id, status: "existing" }));
        },

        async delete(id: string | number): Promise<void> {
            // The address only. A server driver reads the row it deletes; the
            // `values: {}` this used to send was recorded by history as the
            // deleted row, and was all a `beforeDelete` had to judge.
            return driver.delete({ row: { id, path: storedPath() } });
        },

        // Present only when the driver is: exposing these unconditionally and
        // looping single writes underneath would give a caller neither the
        // atomicity nor the single round trip they reached for a batch to get,
        // while looking exactly like it had.
        updateMany: driver.updateMany
            ? async (updates): Promise<M[]> => {
                const rows = await driver.updateMany!<M>({
                    path: storedPath(),
                    updates: updates.map(u => ({ id: u.id, values: u.data }))
                });
                return rows.map(row => asRow<M>(row));
            }
            : undefined,

        deleteMany: driver.deleteMany
            ? async (ids): Promise<void> => {
                await driver.deleteMany!<M>({ path: storedPath(), ids });
            }
            : undefined,

        updateWhere: driver.updateWhere
            ? async (query, data): Promise<M[]> => {
                const rows = await driver.updateWhere!<M>({
                    path: storedPath(),
                    filter: query.where ? deserializeFilter(query.where as Record<string, unknown>) : undefined,
                    logical: query.logical,
                    values: data
                });
                return rows.map(row => asRow<M>(row));
            }
            : undefined,

        deleteWhere: driver.deleteWhere
            ? (query) => driver.deleteWhere!<M>({
                path: storedPath(),
                filter: query.where ? deserializeFilter(query.where as Record<string, unknown>) : undefined,
                logical: query.logical
            })
            : undefined,

        count: driver.count ? (params?: FindParams<M>) => countRows(params) : undefined,

        // `?deleted=only` and `?hard=true`, in-process. A restore is an
        // ordinary `update` (the soft-delete field back to `null`), which the
        // driver already lets reach a trashed row, so it is not here.
        trash: {
            find: (params?: FindParams<M>) => findRows(params, "only"),
            count: (params?: FindParams<M>) => countRows(params, "only"),
            purge: (id: string | number) => driver.delete({ row: { id, path: storedPath() }, hard: true }),
            purgeMany: driver.deleteMany
                ? async (ids: (string | number)[]): Promise<void> => {
                    await driver.deleteMany!<M>({ path: storedPath(), ids, hard: true });
                }
                : undefined
        },

        listen: driver.listenCollection
            ? (params, onUpdate, onError) => {
                const { limit, offset, driverOffset } = resolveFindWindow(params);
                return driver.listenCollection!<M>({
                    path: storedPath(),
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
                    // that refusal.
                    vectorSearch: params?.vectorSearch,
                    onUpdate: (rows) => {
                        onUpdate({
                            data: rows.map(row => asRow<M>(row)),
                            meta: {
                                // No count is issued on this path, so the total
                                // is unknown; the lower bound is the rows in
                                // hand plus the ones paged past to reach them.
                                total: offset + rows.length,
                                limit,
                                offset,
                                hasMore: rows.length >= limit
                            }
                        });
                    },
                    onError
                });
            }
            : undefined,

        listenById: driver.listenOne
            ? (id, onUpdate, onError, byIdOptions) => driver.listenOne!<M>({
                path: storedPath(),
                id,
                include: byIdOptions?.include,
                onUpdate: (row) => onUpdate(row ? asRow<M>(row) : undefined),
                onError
            })
            : undefined
    };
}
