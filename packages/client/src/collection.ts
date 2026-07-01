import { buildQueryString, FindParams, RebaseApiError, Transport } from "./transport";
import { RebaseWebSocketClient } from "./websocket";
import {
    CollectionAccessor,
    Entity,
    FilterOperator,
    FilterValues,
    FindResponse,
    LogicalCondition,
    WhereFieldValue,
    WhereFilterOp,
    WhereValue
} from "@rebasepro/types";

import { QueryBuilder } from "./query_builder";

function parseWhereFilter(where?: Record<string, WhereFieldValue>): FilterValues<string> | undefined {
    if (!where) return undefined;
    const filters: Record<string, any> = {};

    const OP_TO_FILTER: Record<string, WhereFilterOp> = {
        "eq": "==",
        "neq": "!=",
        "gt": ">",
        "gte": ">=",
        "lt": "<",
        "lte": "<=",
        "==": "==",
        "!=": "!=",
        ">": ">",
        ">=": ">=",
        "<": "<",
        "<=": "<=",
        "in": "in",
        "nin": "not-in",
        "not-in": "not-in",
        "cs": "array-contains",
        "csa": "array-contains-any",
        "array-contains": "array-contains",
        "array-contains-any": "array-contains-any"
    };

    const parseSingle = (rawValue: any, _fieldKey: string): [WhereFilterOp, unknown] => {
        if (rawValue === null) return ["==", null];
        if (typeof rawValue === "boolean") return ["==", rawValue];
        if (typeof rawValue === "number") return ["==", rawValue];

        if (Array.isArray(rawValue) && rawValue.length === 2 && typeof rawValue[0] === "string") {
            const [rawOp, val] = rawValue;
            return [OP_TO_FILTER[rawOp] ?? "==", val];
        }

        const value = String(rawValue);
        const dotIndex = value.indexOf(".");
        if (dotIndex > 0) {
            const opStr = value.substring(0, dotIndex);
            const valStr = value.substring(dotIndex + 1);
            if (opStr in OP_TO_FILTER) {
                const op = OP_TO_FILTER[opStr];
                let val: string | number | boolean | null | string[] = valStr;
                if (op === "in" || op === "not-in" || op === "array-contains-any") {
                    val = valStr.startsWith("(") && valStr.endsWith(")")
                        ? valStr.slice(1, -1).split(",").map(v => v.trim())
                        : valStr.split(",");
                }
                if (val === "true") val = true;
                else if (val === "false") val = false;
                else if (val === "null") val = null;
                return [op, val];
            }
        }

        let val: any = value;
        if (val === "true") val = true;
        else if (val === "false") val = false;
        else if (val === "null") val = null;
        return ["==", val];
    };

    for (const [key, rawValue] of Object.entries(where)) {
        if (Array.isArray(rawValue) && rawValue.length > 0 && Array.isArray(rawValue[0])) {
            filters[key] = rawValue.map(r => parseSingle(r, key));
        } else {
            filters[key] = parseSingle(rawValue, key);
        }
    }
    return filters;
}

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
    where<K extends keyof M & string>(column: K, operator: FilterOperator, value: WhereValue<M[K]>): QueryBuilder<M>;
    where(logicalCondition: LogicalCondition): QueryBuilder<M>;

    orderBy(column: keyof M & string, ascending?: "asc" | "desc"): QueryBuilder<M>;

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
        where(columnOrCondition: string | LogicalCondition, operator?: FilterOperator, value?: unknown) {
            const builder = new QueryBuilder<M>(client as unknown as CollectionAccessor<M>);
            if (typeof columnOrCondition === "object") {
                return builder.where(columnOrCondition);
            }
            return builder.where(columnOrCondition as keyof M & string, operator!, value as WhereValue<M[keyof M & string]>);
        },
        orderBy(column: keyof M & string, ascending?: "asc" | "desc") {
            return new QueryBuilder<M>(client).orderBy(column, ascending);
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
                    filter: parseWhereFilter(params?.where),
                    limit: params?.limit,
                    startAfter: params?.offset ? String(params.offset) : undefined,
                    orderBy: params?.orderBy?.split(":")[0],
                    order: params?.orderBy?.split(":")[1] as "asc" | "desc",
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
