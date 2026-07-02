import { buildQueryString, FindParams, RebaseApiError, Transport } from "./transport";
import { RebaseWebSocketClient } from "./websocket";
import {
    CollectionAccessor,
    Entity,
    FindResponse,
    LogicalCondition,
    WhereFilterOp,
    WhereValue
} from "@rebasepro/types";

import { QueryBuilder } from "./query_builder";

/**
 * Wrap a flat row (returned by the REST API as `{ id, ...fields }`) into
 * a proper `Entity<M>` structure expected by the core framework.
 * The `id` is kept inside `values` as well, since collection properties
 * may define an `isId` field that the form binds to `formex.values`.
 */
function rowToEntity<M extends Record<string, unknown>>(row: Record<string, unknown>, slug: string): Entity<M> {
    return {
        id: row.id as string | number,
        path: slug,
        values: row as M
    };
}

/**
 * CollectionClient extends `CollectionAccessor` from `@rebasepro/types` so that
 * `client.data` can be passed directly to the core Rebase component.
 *
 * Additionally it exposes fluent query builder methods like `.where()`, `.orderBy()`.
 */
export interface CollectionClient<M extends Record<string, unknown> = Record<string, unknown>> extends CollectionAccessor<M> {
    where<K extends keyof M & string>(column: K, operator: WhereFilterOp, value: WhereValue<M[K]>): QueryBuilder<M>;
    where(logicalCondition: LogicalCondition): QueryBuilder<M>;

    orderBy(column: keyof M & string, direction?: "asc" | "desc"): QueryBuilder<M>;

    limit(count: number): QueryBuilder<M>;

    offset(count: number): QueryBuilder<M>;

    search(searchString: string): QueryBuilder<M>;

    include(...relations: string[]): QueryBuilder<M>;

    count(params?: FindParams): Promise<number>;
}

export function createCollectionClient<M extends Record<string, unknown> = Record<string, unknown>>(transport: Transport, slug: string, ws?: RebaseWebSocketClient): CollectionClient<M> {
    const basePath = `/data/${slug}`;

    const client: CollectionClient<M> = {
        async find(params?: FindParams): Promise<FindResponse<M>> {
            const qs = buildQueryString(params);
            const raw = await transport.request<{
                data: Record<string, unknown>[];
                meta: FindResponse<M>["meta"]
            }>(basePath + qs, { method: "GET" });
            return {
                data: (raw.data || []).map((row: Record<string, unknown>) => rowToEntity<M>(row, slug)),
                meta: raw.meta
            };
        },

        async findById(id: string | number) {
            try {
                const raw = await transport.request<Record<string, unknown>>(`${basePath}/${encodeURIComponent(String(id))}`, { method: "GET" });
                if (!raw) return undefined;
                return rowToEntity<M>(raw, slug);
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
            return rowToEntity<M>(raw, slug);
        },

        async update(id: string | number, data: Partial<M>) {
            const raw = await transport.request<Record<string, unknown>>(`${basePath}/${encodeURIComponent(String(id))}`, {
                method: "PUT",
                body: JSON.stringify(data)
            });
            return rowToEntity<M>(raw, slug);
        },

        async delete(id: string | number) {
            return transport.request<void>(`${basePath}/${encodeURIComponent(String(id))}`, {
                method: "DELETE"
            });
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
            const builder = new QueryBuilder<M>(client as unknown as CollectionAccessor<M>);
            if (typeof columnOrCondition === "object") {
                return builder.where(columnOrCondition);
            }
            return builder.where(columnOrCondition as keyof M & string, operator!, value as WhereValue<M[keyof M & string]>);
        },
        orderBy(column: keyof M & string, direction?: "asc" | "desc") {
            return new QueryBuilder<M>(client).orderBy(column, direction);
        },
        limit(count: number) {
            return new QueryBuilder<M>(client).limit(count);
        },
        offset(count: number) {
            return new QueryBuilder<M>(client).offset(count);
        },
        search(searchString: string) {
            return new QueryBuilder<M>(client).search(searchString);
        },
        include(...relations: string[]) {
            return new QueryBuilder<M>(client).include(...relations);
        }
    };

    if (ws) {
        client.listen = (params: FindParams | undefined, onUpdate: (response: FindResponse<M>) => void, onError?: (error: Error) => void) => {
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
                (entities: Entity[]) => {
                    const currentUpdateId = ++lastUpdateId;
                    const requestedLimit = params?.limit || 20;
                    const offset = params?.offset || 0;

                    // Immediately fire update with heuristic metadata
                    onUpdate({
                        data: entities as Entity<M>[],
                        meta: {
                            total: entities.length,
                            limit: requestedLimit,
                            offset,
                            hasMore: entities.length >= requestedLimit
                        }
                    });

                    // Asynchronously fetch the actual count from the server to get accurate total/hasMore
                    if (client.count) {
                        client.count(params)
                            .then((total) => {
                                if (active && currentUpdateId === lastUpdateId) {
                                    onUpdate({
                                        data: entities as Entity<M>[],
                                        meta: {
                                            total,
                                            limit: requestedLimit,
                                            offset,
                                            hasMore: offset + entities.length < total
                                        }
                                    });
                                }
                            })
                            .catch(() => {
                                // Silent fallback on count error
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

        client.listenById = (id: string | number, onUpdate: (data: Entity<M> | undefined) => void, onError?: (error: Error) => void) => {
            return ws.listenEntity(
                {
                    path: slug,
                    entityId: String(id)
                },
                (entity: Entity | null) => {
                    if (entity) {
                        onUpdate(entity as Entity<M>);
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
