import { buildQueryString, FindParams, RebaseApiError, Transport } from "./transport";
import { RebaseWebSocketClient } from "./websocket";
import {
    FindResult,
    LogicalCondition,
    SDKCollectionClient,
    SDKQueryBuilderInterface,
    WhereFilterOp,
    WhereValue
} from "@rebasepro/types";

import { SDKQueryBuilder } from "./sdk_query_builder";

/**
 * The concrete, HTTP-backed implementation of the public
 * {@link SDKCollectionClient} contract — flat rows (no Entity wrapper), plus
 * fluent query-builder methods (`.where()`, `.orderBy()`, …).
 *
 * This is what `createRebaseClient().data.<collection>` returns. It is not a
 * separate API from {@link SDKCollectionClient}; it only widens it with
 * `count()`. Program against {@link SDKCollectionClient} when you want a
 * transport-agnostic type.
 */
export interface CollectionClient<M extends Record<string, unknown> = Record<string, unknown>> extends SDKCollectionClient<M> {
    count(params?: FindParams): Promise<number>;
}

export function createCollectionClient<M extends Record<string, unknown> = Record<string, unknown>>(transport: Transport, slug: string, ws?: RebaseWebSocketClient): CollectionClient<M> {
    const basePath = `/data/${slug}`;

    const client: CollectionClient<M> = {
        async find(params?: FindParams): Promise<FindResult<M>> {
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

        async create(data: Partial<M>, id?: string | number) {
            const body: Record<string, unknown> = { ...data };
            if (id !== undefined) {
                body.id = id;
            }
            const raw = await transport.request<Record<string, unknown>>(basePath, {
                method: "POST",
                body: JSON.stringify(body)
            });
            return raw as M;
        },

        async update(id: string | number, data: Partial<M>) {
            try {
                const raw = await transport.request<Record<string, unknown>>(`${basePath}/${encodeURIComponent(String(id))}`, {
                    method: "PUT",
                    body: JSON.stringify(data)
                });
                return raw as M;
            } catch (err) {
                if (err instanceof RebaseApiError && err.status === 404) {
                    return undefined;
                }
                throw err;
            }
        },

        async delete(id: string | number) {
            try {
                return await transport.request<void>(`${basePath}/${encodeURIComponent(String(id))}`, {
                    method: "DELETE"
                });
            } catch (err) {
                if (err instanceof RebaseApiError && err.status === 404) {
                    return undefined;
                }
                throw err;
            }
        },

        async count(params?: FindParams): Promise<number> {
            const countParams: FindParams = {
                ...params,
                limit: undefined,
                offset: undefined
            };
            const qs = buildQueryString(countParams);
            const raw = await transport.request<{ count: number }>(basePath + "/count" + qs, { method: "GET" });
            return raw.count ?? 0;
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
        client.listen = (params: FindParams | undefined, onUpdate: (response: FindResult<M>) => void, onError?: (error: Error) => void) => {
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
