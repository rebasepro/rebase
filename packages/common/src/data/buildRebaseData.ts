import {
    DataDriver,
    RebaseData,
    CollectionAccessor,
    FindParams,
    FindResponse,
    Entity,
    EntityValues,
    FilterValues,
    WhereFilterOp,
    WhereFieldValue
} from "@rebasepro/types";
import { toSnakeCase } from "@rebasepro/utils";
import { QueryBuilder } from "./query_builder";

/**
 * Convert where-clause filter object to the internal DataDriver FilterValues format.
 *
 * Supports multiple value formats:
 * - PostgREST string: { status: "eq.published", age: "gte.18" }
 * - Equality shorthand: { company_profile_id: null, status: "active", age: 18 }
 * - Tuple syntax: { age: [">=", 18], role: ["in", ["admin", "editor"]] }
 *
 * Internal:  { status: ["==", "published"], age: [">=", 18] }
 */
function convertWhereToFilter(where?: Record<string, WhereFieldValue>): FilterValues<string> | undefined {
    if (!where) return undefined;

    const operatorMap: Record<string, WhereFilterOp> = {
        "eq": "==",
        "neq": "!=",
        "gt": ">",
        "gte": ">=",
        "lt": "<",
        "lte": "<=",
        "in": "in",
        "nin": "not-in",
        "not-in": "not-in",
        "cs": "array-contains",
        "csa": "array-contains-any",
        "==": "==",
"!=": "!=",
        ">": ">",
">=": ">=",
        "<": "<",
"<=": "<=",
        "array-contains": "array-contains",
        "array-contains-any": "array-contains-any"
    };

    const filter: FilterValues<string> = {};

    for (const [field, rawValue] of Object.entries(where)) {
        // Handle null → equality
        if (rawValue === null) {
            filter[field] = ["==", null];
            continue;
        }

        // Handle boolean → equality
        if (typeof rawValue === "boolean") {
            filter[field] = ["==", rawValue];
            continue;
        }

        // Handle number → equality
        if (typeof rawValue === "number") {
            filter[field] = ["==", rawValue];
            continue;
        }

        // Handle tuple: [operator, value]
        if (Array.isArray(rawValue) && rawValue.length === 2) {
            const [rawOp, val] = rawValue;
            const mappedOp = operatorMap[rawOp] ?? "==";
            filter[field] = [mappedOp, val];
            continue;
        }

        // Handle PostgREST string format: "op.value"
        if (typeof rawValue === "string") {
            const dotIndex = rawValue.indexOf(".");
            if (dotIndex === -1) {
                // Plain string equality
                filter[field] = ["==", rawValue];
                continue;
            }

            const op = rawValue.substring(0, dotIndex);
            let value: unknown = rawValue.substring(dotIndex + 1);

            // Parse list values like "(admin,editor)"
            if (typeof value === "string" && value.startsWith("(") && value.endsWith(")")) {
                value = value.slice(1, -1).split(",").map((v: string) => v.trim());
            }

            // Parse null string
            if (value === "null") {
                value = null;
            }
            // Parse boolean strings
            else if (value === "true") {
                value = true;
            } else if (value === "false") {
                value = false;
            }
            // Try to parse numbers
            else if (typeof value === "string" && !isNaN(Number(value)) && value.trim() !== "") {
                value = Number(value);
            }

            const mappedOp = operatorMap[op];
            if (mappedOp) {
                filter[field] = [mappedOp, value];
            }
        }
    }

    return Object.keys(filter).length > 0 ? filter : undefined;
}

/**
 * Parse an orderBy string like "created_at:desc" into [field, direction].
 */
function parseOrderBy(orderBy?: string): [string, "asc" | "desc"] | undefined {
    if (!orderBy) return undefined;
    const parts = orderBy.split(":");
    const field = parts[0];
    const direction = (parts[1] as "asc" | "desc") || "asc";
    return [field, direction];
}

function createDriverAccessor<M extends Record<string, unknown> = Record<string, unknown>>(
    driver: DataDriver,
    slug: string
): CollectionAccessor<M> {
    const accessor: CollectionAccessor<M> = {
        async find(params?: FindParams): Promise<FindResponse<M>> {
            const orderParsed = parseOrderBy(params?.orderBy);
            const entities = await driver.fetchCollection<M>({
                path: slug,
                limit: params?.limit,
                offset: params?.offset,
                filter: convertWhereToFilter(params?.where),
                orderBy: orderParsed?.[0],
                order: orderParsed?.[1],
                searchString: params?.searchString
            });
            const limit = params?.limit ?? 20;
            const offset = params?.offset ?? 0;
            return {
                data: entities,
                meta: {
                    total: entities.length,
                    limit,
                    offset,
                    hasMore: entities.length >= limit
                }
            };
        },

        async findById(id: string | number): Promise<Entity<M> | undefined> {
            return driver.fetchEntity<M>({ path: slug,
entityId: id });
        },

        async create(data: Partial<EntityValues<M>>, id?: string | number): Promise<Entity<M>> {
            return driver.saveEntity<M>({
                path: slug,
                values: data,
                entityId: id,
                status: "new"
            });
        },

        async update(id: string | number, data: Partial<EntityValues<M>>): Promise<Entity<M>> {
            return driver.saveEntity<M>({
                path: slug,
                values: data,
                entityId: id,
                status: "existing"
            });
        },

        async delete(id: string | number): Promise<void> {
            return driver.deleteEntity({
                entity: { id,
path: slug,
values: {} as Record<string, unknown> }
            });
        },

        deleteAll: driver.deleteAll
            ? async (): Promise<void> => {
                return driver.deleteAll!(slug);
            }
            : undefined,

        count: driver.countEntities
            ? async (params?: FindParams): Promise<number> => {
                return driver.countEntities!({
                    path: slug,
                    filter: convertWhereToFilter(params?.where)
                });
            }
            : undefined,

        listen: driver.listenCollection
            ? (params: FindParams | undefined, onUpdate: (response: FindResponse<M>) => void, onError?: (error: Error) => void) => {
                const orderParsed = parseOrderBy(params?.orderBy);
                const limit = params?.limit ?? 20;
                const offset = params?.offset ?? 0;
                return driver.listenCollection!<M>({
                    path: slug,
                    limit: params?.limit,
                    offset: params?.offset,
                    filter: convertWhereToFilter(params?.where),
                    orderBy: orderParsed?.[0],
                    order: orderParsed?.[1],
                    searchString: params?.searchString,
                    onUpdate: (entities) => {
                        onUpdate({
                            data: entities,
                            meta: {
                                total: entities.length,
                                limit,
                                offset,
                                hasMore: entities.length >= limit
                            }
                        });
                    },
                    onError
                });
            } : undefined,

        listenById: driver.listenEntity
            ? (id: string | number, onUpdate: (entity: Entity<M> | undefined) => void, onError?: (error: Error) => void) => {
                return driver.listenEntity!<M>({
                    path: slug,
                    entityId: id,
                    onUpdate: (entity) => onUpdate(entity ?? undefined),
                    onError
                });
            } : undefined,

        // Fluent Query Builder
        where(column: keyof M & string, operator: WhereFilterOp, value: unknown) {
            return new QueryBuilder<M>(accessor).where(column, operator, value);
        },
        orderBy(column: keyof M & string, ascending?: "asc" | "desc") {
            return new QueryBuilder<M>(accessor).orderBy(column, ascending);
        },
        limit(count: number) {
            return new QueryBuilder<M>(accessor).limit(count);
        },
        offset(count: number) {
            return new QueryBuilder<M>(accessor).offset(count);
        },
        search(searchString: string) {
            return new QueryBuilder<M>(accessor).search(searchString);
        },
        include(...relations: string[]) {
            return new QueryBuilder<M>(accessor).include(...relations);
        }
    };

    return accessor;
}

/**
 * Build a `RebaseData` object from a `DataDriver` using JavaScript Proxy.
 *
 * This is the key bridge: any property access like `data.products` returns
 * a `CollectionAccessor` backed by the underlying DataDriver, without
 * needing per-collection code generation.
 *
 * @example
 * const data = buildRebaseData(driver);
 * await data.products.create({ name: "Camera", price: 299 });
 * const { data: items } = await data.products.find({ where: { status: "eq.published" } });
 */
export function buildRebaseData(driver: DataDriver): RebaseData {
    const cache = new Map<string, CollectionAccessor>();

    function getAccessor(slug: string): CollectionAccessor {
        let accessor = cache.get(slug);
        if (!accessor) {
            accessor = createDriverAccessor(driver, slug);
            cache.set(slug, accessor);
        }
        return accessor;
    }

    const target = {
        collection: getAccessor
    } as RebaseData;

    return new Proxy(target, {
        get(_target, prop: string | symbol) {
            if (prop === "collection") return getAccessor;
            // Ignore Symbol properties (e.g. Symbol.toPrimitive, Symbol.iterator)
            if (typeof prop === "symbol") return undefined;
            // Ignore internal JS properties
            if (prop === "then" || prop === "toJSON" || prop === "$$typeof") return undefined;

            // Convert camelCase property names to snake_case slugs
            const slug = toSnakeCase(prop);
            return getAccessor(slug);
        }
    });
}
