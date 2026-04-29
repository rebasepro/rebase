import { Transport, FindParams, FindResponse, buildQueryString } from "./transport";
import { RebaseWebSocketClient } from "./websocket";
import { Entity, FilterValues, WhereFilterOp, CollectionAccessor, WhereFieldValue } from "@rebasepro/types";

import { FilterOperator, QueryBuilder } from "./query_builder";

function parseWhereFilter(where?: Record<string, WhereFieldValue>): FilterValues<Record<string, unknown>> | undefined {
    if (!where) return undefined;
    const filters: Record<string, [WhereFilterOp, unknown]> = {};
    for (const [key, rawValue] of Object.entries(where)) {
        // Handle null → equality
        if (rawValue === null) {
            filters[key] = ["==", null];
            continue;
        }

        // Handle boolean → equality
        if (typeof rawValue === "boolean") {
            filters[key] = ["==", rawValue];
            continue;
        }

        // Handle number → equality
        if (typeof rawValue === "number") {
            filters[key] = ["==", rawValue];
            continue;
        }

        // Handle tuple: [operator, value]
        if (Array.isArray(rawValue) && rawValue.length === 2) {
            const [rawOp, val] = rawValue;
            const OP_TO_FILTER: Record<string, WhereFilterOp> = {
                "eq": "==", "neq": "!=",
                "gt": ">", "gte": ">=",
                "lt": "<", "lte": "<=",
                "==": "==", "!=": "!=",
                ">": ">", ">=": ">=",
                "<": "<", "<=": "<=",
                "in": "in", "nin": "not-in", "not-in": "not-in",
                "cs": "array-contains", "csa": "array-contains-any",
                "array-contains": "array-contains", "array-contains-any": "array-contains-any",
            };
            filters[key] = [OP_TO_FILTER[rawOp] ?? "==", val];
            continue;
        }

        // Handle string (original PostgREST format)
        const value = String(rawValue);
        const dotIndex = value.indexOf(".");
        if (dotIndex > 0) {
            const opStr = value.substring(0, dotIndex);
            const valStr = value.substring(dotIndex + 1);
            let op: WhereFilterOp = "==";
            let val: string | number | boolean | null | string[] = valStr;
            
            switch (opStr) {
                case "eq": op = "=="; break;
                case "neq": op = "!="; break;
                case "gt": op = ">"; break;
                case "gte": op = ">="; break;
                case "lt": op = "<"; break;
                case "lte": op = "<="; break;
                case "in": 
                    op = "in";
                    val = valStr.startsWith("(") && valStr.endsWith(")") 
                        ? valStr.slice(1, -1).split(",").map(v => v.trim())
                        : valStr.split(",");
                    break;
                case "nin": 
                    op = "not-in";
                    val = valStr.startsWith("(") && valStr.endsWith(")") 
                        ? valStr.slice(1, -1).split(",").map(v => v.trim())
                        : valStr.split(",");
                    break;
                case "cs": op = "array-contains"; break;
                case "csa": 
                    op = "array-contains-any";
                    val = valStr.startsWith("(") && valStr.endsWith(")") 
                        ? valStr.slice(1, -1).split(",").map(v => v.trim())
                        : valStr.split(",");
                    break;
                default: op = "=="; val = value;
            }
            // Simple type inference for parsing from URL-like strings
            if (val === "true") val = true;
            else if (val === "false") val = false;
            else if (val === "null") val = null;
            else if (typeof val === "string" && /^[0-9]+(\.[0-9]+)?$/.test(val) && key !== "id" && !key.endsWith("_id")) val = Number(val);
            
            filters[key] = [op, val];
        } else {
            filters[key] = ["==", value];
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
        id: row.id,
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
    // Fluent Query Builder
    where(column: keyof M & string, operator: FilterOperator, value: unknown): QueryBuilder<M>;
    orderBy(column: keyof M & string, ascending?: "asc" | "desc"): QueryBuilder<M>;
    limit(count: number): QueryBuilder<M>;
    offset(count: number): QueryBuilder<M>;
    search(searchString: string): QueryBuilder<M>;
    include(...relations: string[]): QueryBuilder<M>;
}

export function createCollectionClient<M extends Record<string, unknown> = Record<string, unknown>>(transport: Transport, slug: string, ws?: RebaseWebSocketClient): CollectionClient<M> {
    const basePath = `/data/${slug}`;

    return {
        async find(params?: FindParams) {
            const qs = buildQueryString(params);
            const raw = await transport.request<{ data: Record<string, unknown>[]; meta: Record<string, unknown> }>(basePath + qs, { method: "GET" });
            return {
                data: (raw.data || []).map((row: Record<string, unknown>) => rowToEntity<M>(row, slug)),
                meta: raw.meta
            };
        },

        async findById(id: string | number) {
            const raw = await transport.request<Record<string, unknown>>(`${basePath}/${encodeURIComponent(String(id))}`, { method: "GET" });
            if (!raw) return undefined;
            return rowToEntity<M>(raw, slug);
        },

        async create(data: Partial<M>, id?: string | number) {
            const body: Record<string, unknown> = { ...data };
            if (id !== undefined) {
                body.id = id;
            }
            const raw = await transport.request<Record<string, unknown>>(basePath, {
                method: "POST",
                body: JSON.stringify(body),
            });
            return rowToEntity<M>(raw, slug);
        },

        async update(id: string | number, data: Partial<M>) {
            const raw = await transport.request<Record<string, unknown>>(`${basePath}/${encodeURIComponent(String(id))}`, {
                method: "PUT",
                body: JSON.stringify(data),
            });
            return rowToEntity<M>(raw, slug);
        },

        async delete(id: string | number) {
            return transport.request<void>(`${basePath}/${encodeURIComponent(String(id))}`, {
                method: "DELETE",
            });
        },

        ...(ws && {
            listen(params: FindParams | undefined, onUpdate: (data: { data: Entity<M>[]; meta: Record<string, unknown> }) => void, onError?: (error: Error) => void) {
                return ws.listenCollection(
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
                        const requestedLimit = params?.limit || 20;
                        onUpdate({
                            data: entities as Entity<M>[],
                            meta: {
                                total: entities.length,
                                limit: requestedLimit,
                                offset: params?.offset || 0,
                                hasMore: entities.length >= requestedLimit
                            }
                        });
                    },
                    onError
                );
            },

            listenById(id: string | number, onUpdate: (data: Entity<M> | undefined) => void, onError?: (error: Error) => void) {
                return ws.listenEntity(
                    { path: slug, entityId: String(id) },
                    (entity: Entity | null) => {
                        if (entity) {
                            onUpdate(entity as Entity<M>);
                        } else {
                            onUpdate(undefined);
                        }
                    },
                    onError
                );
            }
        }),

        // Fluent builder instantiation
        where(column: keyof M & string, operator: FilterOperator, value: unknown) {
            return new QueryBuilder<M>(this as unknown as CollectionClient<M>).where(column, operator, value);
        },
        orderBy(column: keyof M & string, ascending?: "asc" | "desc") {
            return new QueryBuilder<M>(this as unknown as CollectionClient<M>).orderBy(column, ascending);
        },
        limit(count: number) {
            return new QueryBuilder<M>(this as unknown as CollectionClient<M>).limit(count);
        },
        offset(count: number) {
            return new QueryBuilder<M>(this as unknown as CollectionClient<M>).offset(count);
        },
        search(searchString: string) {
            return new QueryBuilder<M>(this as unknown as CollectionClient<M>).search(searchString);
        },
        include(...relations: string[]) {
            return new QueryBuilder<M>(this as unknown as CollectionClient<M>).include(...relations);
        }
    };
}
