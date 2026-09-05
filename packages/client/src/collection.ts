import { buildQueryString, FindParams, RebaseApiError, Transport } from "./transport";
import { RebaseWebSocketClient } from "./websocket";
import {
    FindAllParams,
    FindResult,
    IterateParams,
    LogicalCondition,
    SDKCollectionClient,
    SDKQueryBuilderInterface,
    WhereFilterOp,
    WhereValueFor,
    WriteOptions,
    isUnsupported,
    unsupportedMethod,
    type ComputedSortField
} from "@rebasepro/types";
import { collectAllPages, normalizeOrderBy, paginateFind, resolveFindWindow } from "@rebasepro/common";

import { SDKQueryBuilder } from "./sdk_query_builder";

/**
 * What `listen`/`listenById` say on a client that has no socket.
 *
 * One sentence, in one place: it used to live in `SDKQueryBuilder.listen` only,
 * so the same failure reached callers of `client.data.posts.listen` as
 * `undefined is not a function`.
 */
const NO_SOCKET =
    "Listen is only available when RebaseClient is configured with a websocketUrl, "
    + "and not when it was created with realtime: false.";

/**
 * Counts currently in flight, keyed by the exact request they issue. Entries
 * live only for the duration of the request — see `count()` for why.
 */
const inflightCounts = new Map<string, Promise<number>>();

/**
 * A live query result: a normal {@link FindResult} plus what an interface
 * needs to decide whether to show a "saving…" or "offline" affordance over it.
 *
 * The three flags are always `false` on a client without offline support —
 * every result there came straight from the server.
 */
export interface LiveResult<M extends Record<string, unknown>> extends FindResult<M> {
    /** The data came from the local database, not from a completed request. */
    fromCache: boolean;
    /** At least one row here carries a write the server has not accepted yet. */
    hasPendingWrites: boolean;
    /**
     * The local database may not hold every row the server would have
     * returned, so treat this as a best effort rather than a complete answer.
     */
    partial: boolean;
    /** The most recent revalidation failure, when the last one failed. */
    error?: Error;
}

/** Snapshot metadata for a single observed row. */
export interface RowSnapshotMeta {
    fromCache: boolean;
    hasPendingWrites: boolean;
}

export interface ObserveOptions {
    /**
     * Keep the subscription live off the realtime socket, so changes made by
     * other clients arrive without a refetch. On by default whenever realtime
     * is enabled on the client; pass `false` for a one-shot read that still
     * reports offline/pending metadata.
     */
    realtime?: boolean;
}

/**
 * The concrete, HTTP-backed implementation of the public
 * {@link SDKCollectionClient} contract — flat rows (no Entity wrapper), plus
 * fluent query-builder methods (`.where()`, `.orderBy()`, …).
 *
 * This is what `createRebaseClient().data.<collection>` returns. It is not a
 * separate API from {@link SDKCollectionClient}; it only widens it with
 * `count()` and the reactive `observe()` pair. Program against
 * {@link SDKCollectionClient} when you want a transport-agnostic type.
 */
export interface CollectionClient<
    M extends Record<string, unknown> = Record<string, unknown>,
    I = Partial<M>,
    U = Partial<M>
> extends SDKCollectionClient<M, I, U> {
    count(params?: FindParams<M>): Promise<number>;

    /**
     * Subscribe to a query's results.
     *
     * This is the reactive read primitive, and the one to reach for in a UI:
     * unlike `find()` it keeps emitting. On a client with `offline` enabled it
     * is local-first — the first emission comes from the local database, with
     * no request in the way — and re-emits on every local write, every queued
     * write reaching the server, and every rollback. With realtime enabled it
     * also re-emits on changes made by other clients.
     *
     * Emissions are de-duplicated: a refresh that changes nothing does not
     * call back.
     *
     * @returns An unsubscribe function.
     */
    observe(
        params: FindParams<M> | undefined,
        onResult: (result: LiveResult<M>) => void,
        onError?: (error: Error) => void,
        options?: ObserveOptions
    ): () => void;

    /** {@link CollectionClient.observe} for a single row. */
    observeById(
        id: string | number,
        onResult: (row: M | undefined, meta: RowSnapshotMeta) => void,
        onError?: (error: Error) => void,
        options?: ObserveOptions
    ): () => void;
}

export function createCollectionClient<M extends Record<string, unknown> = Record<string, unknown>>(transport: Transport, slug: string, ws?: RebaseWebSocketClient): CollectionClient<M> {
    const basePath = `/data/${slug}`;

    const client: CollectionClient<M> = {
        async find(params?: FindParams<M>): Promise<FindResult<M>> {
            const qs = buildQueryString(params);
            const raw = await transport.request<{
                data: Record<string, unknown>[];
                meta: FindResult<M>["meta"]
            }>(basePath + qs, { method: "GET" });
            return {
                data: (raw.data || []) as M[],
                meta: raw.meta
            };
        },

        // The pagination engine lives in `@rebasepro/common`, shared with the
        // in-process accessor: `iterate()` has to mean the same thing whichever
        // transport the caller happens to be holding.
        iterate(params?: IterateParams<M>) {
            return paginateFind<M>((p) => client.find(p), params, slug);
        },

        findAll(params?: FindAllParams<M>) {
            return collectAllPages<M>((p) => client.find(p), params, slug);
        },

        async findById(id: string | number) {
            try {
                const raw = await transport.request<Record<string, unknown>>(`${basePath}/${encodeURIComponent(String(id))}`, { method: "GET" });
                if (!raw) return undefined;
                return raw as M;
            } catch (err) {
                if (err instanceof RebaseApiError && err.status === 404) {
                    return undefined;
                }
                throw err;
            }
        },

        async get(id: string | number) {
            const row = await client.findById(id);
            if (row === undefined) {
                // 404 rather than a bespoke code: it is the same outcome the
                // transport would have surfaced, and row-level security makes
                // "no such row" and "not yours" the same answer on purpose.
                throw new RebaseApiError(
                    `No record with id ${JSON.stringify(String(id))} in "${slug}".`,
                    { status: 404, code: "NOT_FOUND" }
                );
            }
            return row;
        },

        async create(data: Partial<M>, id?: string | number, options?: WriteOptions) {
            const body: Record<string, unknown> = { ...data };
            if (id !== undefined) {
                body.id = id;
            }
            const raw = await transport.request<Record<string, unknown>>(basePath, {
                method: "POST",
                body: JSON.stringify(body),
                ...(options?.idempotencyKey
                    ? { headers: { "Idempotency-Key": options.idempotencyKey } }
                    : {})
            });
            return raw as M;
        },

        async createMany(data: Partial<M>[], options?: { upsert?: boolean } & WriteOptions) {
            if (!Array.isArray(data)) {
                throw new TypeError("createMany expects an array of records.");
            }
            if (data.length === 0) return [];

            const raw = await transport.request<{ data: Record<string, unknown>[] }>(`${basePath}/bulk`, {
                method: "POST",
                body: JSON.stringify({
                    rows: data,
                    ...(options?.upsert ? { upsert: true } : {})
                }),
                ...(options?.idempotencyKey
                    ? { headers: { "Idempotency-Key": options.idempotencyKey } }
                    : {})
            });
            return (raw.data || []) as M[];
        },

        /**
         * `PATCH`, the verb for a merge — `update(id, data: Partial<M>)` sends
         * only the keys the caller named and the server merges the rest.
         *
         * It was `PUT` for a while, on a route that served both so older
         * clients kept working. The alias is gone: the OpenAPI spec, the SDK
         * and the route now name one verb, and a spec-validating gateway in
         * front of the API sees the operation the server actually implements.
         */
        async update(id: string | number, data: Partial<M>) {
            const raw = await transport.request<Record<string, unknown>>(`${basePath}/${encodeURIComponent(String(id))}`, {
                method: "PATCH",
                body: JSON.stringify(data)
            });
            return raw as M;
        },

        async updateMany(updates: { id: string | number; data: Partial<M> }[], options?: WriteOptions) {
            if (!Array.isArray(updates)) {
                throw new TypeError("updateMany expects an array of { id, data } entries.");
            }
            if (updates.length === 0) return [];

            const raw = await transport.request<{ data: Record<string, unknown>[] }>(`${basePath}/bulk`, {
                method: "PATCH",
                body: JSON.stringify({ updates }),
                ...(options?.idempotencyKey
                    ? { headers: { "Idempotency-Key": options.idempotencyKey } }
                    : {})
            });
            return (raw.data || []) as M[];
        },

        async delete(id: string | number) {
            await transport.request<void>(`${basePath}/${encodeURIComponent(String(id))}`, {
                method: "DELETE"
            });
        },

        /**
         * `POST .../bulk/delete`, not `DELETE .../bulk`.
         *
         * The honest verb would take the ids in a DELETE body, and that is the
         * one request shape the HTTP ecosystem handles unreliably: bodies on
         * DELETE are permitted but widely dropped by proxies and CDNs, and
         * several OpenAPI generators ignore `requestBody` on a DELETE
         * operation, so a generated client would send the request without its
         * ids. A backend deployed behind arbitrary ingress cannot take that
         * bet. Same reason `:batchDelete` exists in Google's API guidelines.
         */
        async deleteMany(ids: (string | number)[], options?: WriteOptions) {
            if (!Array.isArray(ids)) {
                throw new TypeError("deleteMany expects an array of ids.");
            }
            if (ids.length === 0) return;

            await transport.request<void>(`${basePath}/bulk/delete`, {
                method: "POST",
                body: JSON.stringify({ ids }),
                ...(options?.idempotencyKey
                    ? { headers: { "Idempotency-Key": options.idempotencyKey } }
                    : {})
            });
        },

        async count(params?: FindParams<M>): Promise<number> {
            const countParams: FindParams<M> = {
                ...params,
                limit: undefined,
                offset: undefined,
                // A count reads no relation data, so `include` can only add
                // joins — and a join that does not match drops rows, which
                // would make the total disagree with the `find()` it describes.
                // Same reasoning as limit/offset: parameters that cannot affect
                // the answer are not forwarded.
                include: undefined
            };
            const qs = buildQueryString(countParams);

            // One count per query in flight, not one per caller.
            //
            // A count is a property of the query, and every concurrent caller
            // asking the same question wants the same answer — so they can
            // share the one request. This is not a micro-optimisation: a live
            // subscription re-counts on every push (see `listen` below), and
            // `listenCollection` deliberately collapses identical queries onto
            // a single socket subscription while keeping one callback per
            // subscriber. Each push therefore woke N subscribers, and each of
            // them issued its own identical count. A table showing one relation
            // column fired one count per visible cell, on every update.
            //
            // The entry is dropped as soon as it settles, so this merges
            // concurrent calls only and never serves a cached total.
            const key = basePath + "/count" + qs;
            const inflight = inflightCounts.get(key);
            if (inflight) return inflight;

            const request = transport
                .request<{ count: number }>(key, { method: "GET" })
                .then((raw) => raw.count ?? 0);
            inflightCounts.set(key, request);
            try {
                return await request;
            } finally {
                inflightCounts.delete(key);
            }
        },

        // Reactive reads. Without the offline layer there is no local database
        // to read from, so this is a fetch plus — when realtime is available —
        // the live subscription that keeps it current.
        observe(
            params: FindParams<M> | undefined,
            onResult: (result: LiveResult<M>) => void,
            onError?: (error: Error) => void,
            options?: ObserveOptions
        ) {
            let closed = false;
            // Two sources race into one callback: the one-shot fetch below and
            // the subscription beside it. Whichever resolves last used to win,
            // so a socket update that landed first was overwritten by the
            // fetch's older snapshot and stayed wrong until the next change.
            // `listenCollection` replays cached rows synchronously to a second
            // subscriber, so a second component observing the same query hit
            // that ordering every time.
            let liveDelivered = false;
            let signature: string | undefined;

            const deliver = (result: FindResult<M>, fromLive: boolean) => {
                if (closed) return;
                // Once the socket has spoken, the fetch issued alongside it is
                // older news — delivering it would move the app backwards.
                if (fromLive) liveDelivered = true;
                else if (liveDelivered) return;
                // The de-duplication `observe()` documents. Keyed on the rows
                // and the total, the same two things the offline layer keys on,
                // so both implementations mean the same thing by "changed".
                const next = `${result.meta?.total ?? ""}|${JSON.stringify(result.data)}`;
                if (signature !== undefined && next === signature) return;
                signature = next;
                onResult({ ...result, fromCache: false, hasPendingWrites: false, partial: false });
            };

            client.find(params).then((result) => deliver(result, false)).catch((error) => {
                if (!closed) onError?.(error as Error);
            });
            // `observe()` degrades to the single fetch above rather than
            // throwing, so it asks the capability question explicitly — the
            // method itself is always there now.
            const live = options?.realtime !== false && !isUnsupported(client.listen)
                ? client.listen(params, (result) => deliver(result, true), onError)
                : undefined;
            return () => {
                closed = true;
                live?.();
            };
        },

        observeById(
            id: string | number,
            onResult: (row: M | undefined, meta: RowSnapshotMeta) => void,
            onError?: (error: Error) => void,
            options?: ObserveOptions
        ) {
            let closed = false;
            let liveDelivered = false;
            let signature: string | undefined;

            // Same ordering and de-duplication rules as `observe`, for one row.
            const deliver = (row: M | undefined, fromLive: boolean) => {
                if (closed) return;
                if (fromLive) liveDelivered = true;
                else if (liveDelivered) return;
                const next = row === undefined ? "\u0000missing" : JSON.stringify(row);
                if (signature !== undefined && next === signature) return;
                signature = next;
                onResult(row, { fromCache: false, hasPendingWrites: false });
            };

            client.findById(id).then((row) => deliver(row, false)).catch((error) => {
                if (!closed) onError?.(error as Error);
            });
            const live = options?.realtime !== false && !isUnsupported(client.listenById)
                ? client.listenById(id, (row) => deliver(row, true), onError)
                : undefined;
            return () => {
                closed = true;
                live?.();
            };
        },

        // Fluent builder instantiation
        where(columnOrCondition: string | LogicalCondition, operator?: WhereFilterOp, value?: unknown) {
            const builder = new SDKQueryBuilder<M>(client);
            if (typeof columnOrCondition === "object") {
                return builder.where(columnOrCondition);
            }
            return builder.where(columnOrCondition as keyof M & string, operator!, value as WhereValueFor<WhereFilterOp, M[keyof M & string]>);
        },
        orderBy(column: (keyof M & string) | ComputedSortField, direction?: "asc" | "desc") {
            return new SDKQueryBuilder<M>(client).orderBy(column, direction);
        },
        limit(count: number) {
            return new SDKQueryBuilder<M>(client).limit(count);
        },
        offset(count: number) {
            return new SDKQueryBuilder<M>(client).offset(count);
        },
        search(searchString: string, options?: { explain?: boolean }) {
            return new SDKQueryBuilder<M>(client).search(searchString, options);
        },
        vectorSearch(
            property: string,
            vector: number[],
            options?: { distance?: "cosine" | "l2" | "inner_product"; threshold?: number }
        ) {
            return new SDKQueryBuilder<M>(client).vectorSearch(property, vector, options);
        },
        include(...relations: string[]) {
            return new SDKQueryBuilder<M>(client).include(...relations);
        },

        // `listen`/`listenById` are part of the contract, so they are always
        // here to call. Without a socket they are stubs that say why, rather
        // than absent properties every call site had to null-check — a check
        // that was indistinguishable from "does this transport support
        // realtime?", which is `isUnsupported()` and is what the admin panel
        // actually asks before choosing to poll instead.
        listen: unsupportedMethod(NO_SOCKET),
        listenById: unsupportedMethod(NO_SOCKET)
    };

    if (ws) {
        client.listen = (params: FindParams<M> | undefined, onUpdate: (response: FindResult<M>) => void, onError?: (error: Error) => void) => {
            let active = true;
            let lastUpdateId = 0;
            // The last total a `count()` actually returned. A later count that
            // fails says nothing about how big the collection is, so it must
            // not be allowed to replace this with the length of one page.
            let lastKnownTotal: number | undefined;
            const window = resolveFindWindow(params);
            const unsub = ws.listenCollection(
                {
                    path: slug,
                    filter: params?.where,
                    // The group used to be dropped here, so a subscription
                    // filtered with `or(...)` was pushed every row instead.
                    logical: params?.logical,
                    limit: params?.limit,
                    // `offset` used to be stringified into `startAfter`, which
                    // is a cursor *row*, not a row count — so the server was
                    // handed "20" where it expected a keyset value, and the
                    // offset it does understand never arrived at all.
                    offset: window.driverOffset,
                    // The list form, so a multi-key sort reaches the socket
                    // whole. Indexing `[0]`/`[1]` here read a tuple-of-tuples as
                    // a field name and a direction, and a live subscription came
                    // back in a different order from the same query fetched.
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
                    vectorSearch: params?.vectorSearch
                },
                (incomingRows: Record<string, unknown>[]) => {
                    const currentUpdateId = ++lastUpdateId;
                    // What the server pages by when the caller names no limit.
                    // A hardcoded 20 here described a window the rows had not
                    // come from, and any app sizing its next request off
                    // `meta.limit` was told the wrong number.
                    const requestedLimit = window.limit;
                    const offset = window.offset;

                    // WS client already delivers flat rows — just cast
                    const rows = incomingRows as M[];

                    const emit = (total: number, hasMore: boolean) => {
                        if (!active || currentUpdateId !== lastUpdateId) return;
                        onUpdate({
                            data: rows,
                            meta: {
                                total,
                                limit: requestedLimit,
                                offset,
                                hasMore
                            }
                        });
                    };

                    // With no count to go on, the only defensible total is a
                    // lower bound: the rows on this page plus the ones paged
                    // past to reach them. Reporting `rows.length` claimed a
                    // collection read at offset 10 held two rows.
                    const emitWithoutCount = () => emit(
                        offset + rows.length,
                        rows.length >= requestedLimit
                    );

                    if (client.count) {
                        client.count(params)
                            .then((total) => {
                                lastKnownTotal = total;
                                emit(total, offset + rows.length < total);
                            })
                            .catch(() => {
                                // A count that failed is not evidence about the
                                // size of the collection. Keep the last real
                                // answer; only guess if there has never been one.
                                if (lastKnownTotal !== undefined) {
                                    emit(lastKnownTotal, offset + rows.length < lastKnownTotal);
                                } else {
                                    emitWithoutCount();
                                }
                            });
                    } else {
                        emitWithoutCount();
                    }
                },
                onError
            );

            return () => {
                active = false;
                unsub();
            };
        };

        client.listenById = (id: string | number, onUpdate: (data: M | undefined) => void, onError?: (error: Error) => void) => {
            return ws.listenOne(
                {
                    path: slug,
                    id: String(id)
                },
                (row: Record<string, unknown> | null) => {
                    if (row) {
                        onUpdate(row as M);
                    } else {
                        onUpdate(undefined);
                    }
                },
                onError
            );
        };
    }

    return client;
}
