import { buildQueryString, FindParams, RebaseApiError, Transport } from "./transport";
import { RebaseWebSocketClient } from "./websocket";
import {
    FindResult,
    LogicalCondition,
    SDKCollectionClient,
    SDKQueryBuilderInterface,
    WhereFilterOp,
    WhereValue,
    WriteOptions
} from "@rebasepro/types";

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
                offset: undefined
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
            const emit = (result: FindResult<M>) => {
                if (closed) return;
                onResult({ ...result, fromCache: false, hasPendingWrites: false, partial: false });
            };
            client.find(params).then(emit).catch((error) => {
                if (!closed) onError?.(error as Error);
            });
            const live = options?.realtime !== false && client.listen
                ? client.listen(params, emit, onError)
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
            const emit = (row: M | undefined) => {
                if (closed) return;
                onResult(row, { fromCache: false, hasPendingWrites: false });
            };
            client.findById(id).then(emit).catch((error) => {
                if (!closed) onError?.(error as Error);
            });
            const live = options?.realtime !== false && client.listenById
                ? client.listenById(id, emit, onError)
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
            const unsub = ws.listenCollection(
                {
                    path: slug,
                    filter: params?.where,
                    limit: params?.limit,
                    startAfter: params?.offset ? String(params.offset) : undefined,
                    orderBy: params?.orderBy?.[0],
                    order: params?.orderBy?.[1],
                    searchString: params?.searchString
                },
                (incomingRows: Record<string, unknown>[]) => {
                    const currentUpdateId = ++lastUpdateId;
                    const requestedLimit = params?.limit || 20;
                    const offset = params?.offset || 0;

                    // WS client already delivers flat rows — just cast
                    const rows = incomingRows as M[];

                    // Heuristic metadata (used as fallback if count call fails)
                    const heuristicTotal = rows.length;
                    const heuristicHasMore = rows.length >= requestedLimit;

                    // Try to get authoritative count; fall back to heuristic
                    if (client.count) {
                        client.count(params)
                            .then((total) => {
                                if (active && currentUpdateId === lastUpdateId) {
                                    onUpdate({
                                        data: rows,
                                        meta: {
                                            total,
                                            limit: requestedLimit,
                                            offset,
                                            hasMore: offset + rows.length < total
                                        }
                                    });
                                }
                            })
                            .catch(() => {
                                // Count failed — use heuristic meta
                                if (active && currentUpdateId === lastUpdateId) {
                                    onUpdate({
                                        data: rows,
                                        meta: {
                                            total: heuristicTotal,
                                            limit: requestedLimit,
                                            offset,
                                            hasMore: heuristicHasMore
                                        }
                                    });
                                }
                            });
                    } else {
                        // No count method — fire immediately with heuristic meta
                        onUpdate({
                            data: rows,
                            meta: {
                                total: heuristicTotal,
                                limit: requestedLimit,
                                offset,
                                hasMore: heuristicHasMore
                            }
                        });
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
