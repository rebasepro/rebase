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
    WhereValue,
    WriteOptions
} from "@rebasepro/types";
import { collectAllPages, paginateFind, resolveFindWindow } from "@rebasepro/common";

import { SDKQueryBuilder } from "./sdk_query_builder";

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

        async createMany(data: Partial<M>[], options?: { upsert?: boolean }) {
            if (!Array.isArray(data)) {
                throw new TypeError("createMany expects an array of records.");
            }
            if (data.length === 0) return [];

            const raw = await transport.request<{ data: Record<string, unknown>[] }>(`${basePath}/bulk`, {
                method: "POST",
                body: JSON.stringify({
                    rows: data,
                    ...(options?.upsert ? { upsert: true } : {})
                })
            });
            return (raw.data || []) as M[];
        },

        /**
         * Still `PUT`, deliberately, even though the server now serves `PATCH`
         * on the same handler and `PATCH` is the honest verb for a merge.
         *
         * The two are interchangeable server-side, so switching buys nothing at
         * runtime — and it costs compatibility in the direction that fails
         * quietly. A 0.14 client talking to a 0.13 server would send `PATCH` to
         * a route that does not exist and get a **404**, which is
         * indistinguishable from "that row is gone". Every write would look like
         * a missing record.
         *
         * `PATCH` is what the OpenAPI spec advertises, so anyone generating a
         * client gets the correct verb; this stays on `PUT` until the oldest
         * supported server is one that serves both.
         */
        async update(id: string | number, data: Partial<M>) {
            const raw = await transport.request<Record<string, unknown>>(`${basePath}/${encodeURIComponent(String(id))}`, {
                method: "PUT",
                body: JSON.stringify(data)
            });
            return raw as M;
        },

        async delete(id: string | number) {
            await transport.request<void>(`${basePath}/${encodeURIComponent(String(id))}`, {
                method: "DELETE"
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
            const raw = await transport.request<{ count: number }>(basePath + "/count" + qs, { method: "GET" });
            return raw.count ?? 0;
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
            const live = options?.realtime !== false && client.listen
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
                const next = row === undefined ? "\0missing" : JSON.stringify(row);
                if (signature !== undefined && next === signature) return;
                signature = next;
                onResult(row, { fromCache: false, hasPendingWrites: false });
            };

            client.findById(id).then((row) => deliver(row, false)).catch((error) => {
                if (!closed) onError?.(error as Error);
            });
            const live = options?.realtime !== false && client.listenById
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
            return builder.where(columnOrCondition as keyof M & string, operator!, value as WhereValue<M[keyof M & string]>);
        },
        orderBy(column: keyof M & string, direction?: "asc" | "desc") {
            return new SDKQueryBuilder<M>(client).orderBy(column, direction);
        },
        limit(count: number) {
            return new SDKQueryBuilder<M>(client).limit(count);
        },
        offset(count: number) {
            return new SDKQueryBuilder<M>(client).offset(count);
        },
        search(searchString: string) {
            return new SDKQueryBuilder<M>(client).search(searchString);
        },
        include(...relations: string[]) {
            return new SDKQueryBuilder<M>(client).include(...relations);
        }
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
                    orderBy: params?.orderBy?.[0],
                    order: params?.orderBy?.[1],
                    searchString: params?.searchString
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
