import { eq, SQL } from "drizzle-orm";
import { AnyPgColumn } from "drizzle-orm/pg-core";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { CollectionConfig, Properties, Property, ResolvedRelation, RelationProperty, Vector, BinaryProperty, hasForeignKeyOnTarget, type ResolvedBelongsTo, type ResolvedForeignKeyOnTarget, type ResolvedVia } from "@rebasepro/types";
import { getTableName, resolveCollectionRelations, findRelation, createRelationRef, DEFAULT_ONE_OF_TYPE, DEFAULT_ONE_OF_VALUE } from "@rebasepro/common";
import { isPrototypePollutingKey } from "@rebasepro/utils";
import { PostgresCollectionRegistry } from "./collections/PostgresCollectionRegistry";
import { DrizzleConditionBuilder } from "./utils/drizzle-conditions";
import { getPrimaryKeys, buildCompositeId } from "./services/collection-helpers";
import { logger } from "@rebasepro/server";

/**
 * Data transformation utilities for converting between frontend and database formats.
 */

/**
 * Typed result from `serializeDataToServer`.
 * Replaces the hidden `__inverseRelationUpdates` / `__joinPathRelationUpdates`
 * dunder-property mutation pattern with explicit, typed state management.
 */
export interface SerializedEntityData {
    /** Scalar column values ready for INSERT/UPDATE. */
    scalarData: Record<string, unknown>;
    /**
     * Inverse relation updates that must be applied to target tables.
     *
     * No address here: the row being written does not know its own. These are
     * applied by `PersistService`, which addresses them with the id it holds —
     * the one it was given for an update, or the one the INSERT returned — and
     * that is the authority. This item used to carry a `currentId` derived from
     * the *input* values, which nothing ever read.
     */
    inverseRelationUpdates: Array<{
        relationKey: string;
        relation: ResolvedRelation;
        newValue: unknown;
    }>;
    /** JoinPath relation updates that require multi-hop writes. */
    joinPathRelationUpdates: Array<{
        relationKey: string;
        relation: ResolvedVia;
        newTargetId: string | number | null;
    }>;
}
/**
 * Helper function to sanitize and convert dates to ISO strings
 */
export function sanitizeAndConvertDates(obj: unknown): unknown {
    if (obj === null || obj === undefined) {
        return null;
    }

    if (typeof obj === "number" && isNaN(obj)) {
        return null;
    }

    if (typeof obj === "string" && obj.toLowerCase() === "nan") {
        return null;
    }

    if (Array.isArray(obj)) {
        return obj.map(v => sanitizeAndConvertDates(v));
    }

    if (obj instanceof Date) {
        return obj.toISOString();
    }

    if (typeof obj === "object") {
        const newObj: Record<string, unknown> = {};
        for (const key in obj) {
            if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
            // `JSON.parse` creates `__proto__` as an *own* property, so it gets
            // past the check above — and `newObj[key] = …` then invokes the
            // prototype setter instead of creating a property. The row's
            // prototype becomes whatever the request body supplied, so
            // `row.isAdmin` answers `true` while `Object.keys(row)` shows
            // nothing of the sort. No column can be reached by these names.
            if (isPrototypePollutingKey(key)) continue;
            newObj[key] = sanitizeAndConvertDates((obj as Record<string, unknown>)[key]);
        }
        return newObj;
    }

    if (typeof obj === "string") {
        const isoDateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
        const jsDateRegex = /^\w{3} \w{3} \d{2} \d{4} \d{2}:\d{2}:\d{2} GMT[+-]\d{4} \(.+\)$/;
        if (isoDateRegex.test(obj) || jsDateRegex.test(obj)) {
            const date = new Date(obj);
            if (!isNaN(date.getTime())) {
                return date.toISOString();
            }
        }
    }

    return obj;
}

/**
 * Transform relations for database storage (relation objects to IDs)
 */
export function serializeDataToServer<M extends Record<string, unknown>>(
    row: M,
    properties: Properties,
    collection?: CollectionConfig,
    registry?: PostgresCollectionRegistry
): SerializedEntityData {
    if (!row || !properties) return { scalarData: row ?? {},
inverseRelationUpdates: [],
joinPathRelationUpdates: [] };

    const result: Record<string, unknown> = {};

    // Get normalized relations if collection is provided
    const resolvedRelations = collection ? resolveCollectionRelations(collection) : {};

    // Track inverse relations that need to be handled separately
    const inverseRelationUpdates: Array<{
        relationKey: string;
        relation: ResolvedRelation;
        newValue: unknown;
    }> = [];
    const joinPathRelationUpdates: Array<{
        relationKey: string;
        relation: ResolvedVia;
        newTargetId: string | number | null;
    }> = [];

    // Pre-calculate all local keys used as foreign keys
    const foreignKeys = new Set<string>();
    Object.values(resolvedRelations).forEach(relation => {
        if (relation.kind === "belongsTo") foreignKeys.add(relation.localKey);
    });

    for (const [key, value] of Object.entries(row)) {
        // Same reasoning as `sanitizeAndConvertDates`: these keys come from the
        // request body, and no column answers to them.
        if (isPrototypePollutingKey(key)) continue;
        const property = properties[key as keyof M] as Property;

        // Coerce empty strings to null for any field that acts as a foreign key
        const effectiveValue = (foreignKeys.has(key) && value === "") ? null : value;

        if (!property) {
            result[key] = effectiveValue;
            continue;
        }


        // Handle relation properties specially
        if (property.type === "relation" && collection) {
            const relation = findRelation(resolvedRelations, key);
            if (relation) {
                if (relation.kind === "belongsTo") {
                    // Owning relation: Map relation object to FK column on current table
                    const serializedValue = serializePropertyToServer(effectiveValue, property);
                    if (serializedValue !== undefined) {
                        result[relation.localKey] = serializedValue;
                    }
                    // Don't add the original relation property to the result
                    continue;
                } else if (hasForeignKeyOnTarget(relation)) {
                    // Inverse relation: Need to update the target table's FK
                    const serializedValue = serializePropertyToServer(effectiveValue, property);
                    inverseRelationUpdates.push({
                        relationKey: key,
                        relation,
                        newValue: serializedValue
                    });
                    // Don't add the original relation property to the result
                    continue;
                } else if (relation.kind === "via") {
                    // A join chain is written through its own machinery, one
                    // row at a time for a to-one and as a set for a to-many.
                    // There used to be two arms here — "owning" and "inverse"
                    // joinPath — but a join chain has no owning side, so they
                    // only ever differed by which list they pushed to.
                    const serializedValue = serializePropertyToServer(effectiveValue, property);
                    if (relation.cardinality === "one") {
                        // Ordering matters: PersistService applies these BEFORE
                        // the main UPDATE, so the mapping reads the pre-update
                        // foreign key rather than a value the same save changed.
                        joinPathRelationUpdates.push({
                            relationKey: key,
                            relation,
                            newTargetId: serializedValue as string | number | null
                        });
                    } else {
                        inverseRelationUpdates.push({
                            relationKey: key,
                            relation,
                            newValue: serializedValue
                        });
                    }
                    continue;
                }
            }
        }

        result[key] = serializePropertyToServer(effectiveValue, property);
    }

    return {
        scalarData: result,
        inverseRelationUpdates,
        joinPathRelationUpdates
    };
}

/**
 * Serialize a single property value for database storage
 */
export function serializePropertyToServer(value: unknown, property: Property): unknown {
    if (value === null || value === undefined) {
        return value;
    }

    const propertyType = property.type;

    switch (propertyType) {
        case "relation":
            if (Array.isArray(value)) {
                return value.map(v => serializePropertyToServer(v, property));
            } else if (typeof value === "object" && value !== null && "id" in value) {
                return (value as Record<string, unknown>).id;
            }
            if (value === "") return null;
            return value;

        case "array":
            if (Array.isArray(value)) {
                if (property.of) {
                    return value.map(item => serializePropertyToServer(item, property.of as Property));
                } else if (property.oneOf) {
                    const typeField = property.oneOf.typeField ?? DEFAULT_ONE_OF_TYPE;
                    const valueField = property.oneOf.valueField ?? DEFAULT_ONE_OF_VALUE;
                    return value.map((e) => {
                        if (e === null) return null;
                        if (typeof e !== "object") return e;
                        const rec = e as Record<string, unknown>;
                        const type = rec[typeField] as string;
                        const childProperty = property.oneOf?.properties[type];
                        if (!type || !childProperty) return e;
                        return {
                            [typeField]: type,
                            [valueField]: serializePropertyToServer(rec[valueField], childProperty)
                        };
                    });
                }
                return value;
            }
            // Non-array value for an array property — coerce to avoid .map() crashes downstream
            logger.warn(`Expected array value for array property, got ${typeof value}. Coercing to empty array.`);
            return [];


        case "map":
            if (typeof value === "object" && property.properties) {
                const result: Record<string, unknown> = {};
                for (const [subKey, subValue] of Object.entries(value)) {
                    const subProperty = (property.properties as Properties)[subKey];
                    if (subProperty) {
                        result[subKey] = serializePropertyToServer(subValue, subProperty);
                    } else {
                        result[subKey] = subValue;
                    }
                }
                return result;
            }
            return value;
        case "vector": {
            if (value instanceof Vector) {
                return value.value;
            }
            if (value && typeof value === "object" && "value" in value && Array.isArray((value as { value: unknown }).value)) {
                return (value as { value: unknown[] }).value.map(Number);
            }
            if (Array.isArray(value)) {
                return value.map(Number);
            }
            return value;
        }

        case "binary": {
            const decoded = tryDecodeBase64DataUrl(value);
            if (decoded) return decoded;
            if (Buffer.isBuffer(value)) return value;
            return value;
        }

        case "string":
        default: {
            const decoded = tryDecodeBase64DataUrl(value);
            if (decoded) return decoded;
            return value;
        }
    }
}

/**
 * Transform IDs back to relation objects for frontend
 */
export async function parseDataFromServer<M extends Record<string, unknown>>(
    data: M,
    collection: CollectionConfig,
    db?: NodePgDatabase<Record<string, unknown>>,
    registry?: PostgresCollectionRegistry
): Promise<M> {
    const properties = collection.properties;
    if (!data || !properties) return data;

    // Get the normalized relations once
    const resolvedRelations = resolveCollectionRelations(collection);

    // Shared scalar + relation value normalization
    const result = normalizeScalarValues(data, properties, collection, resolvedRelations, { skipRelations: false });

    // Add relation properties that should be populated from FK values or inverse queries
    for (const [propKey, property] of Object.entries(properties)) {
        if (property.type === "relation" && !(propKey in result)) {
            // Find the normalized relation for this property
            const relation = findRelation(resolvedRelations, propKey);
            if (relation) {
                if (relation.kind === "belongsTo" && relation.localKey in data) {
                    // Owning relation: FK is in current table
                    const fkValue = data[relation.localKey as keyof M];
                    if (fkValue !== null && fkValue !== undefined) {
                        try {
                            const targetCollection = relation.target();
                            result[propKey] = createRelationRef(fkValue.toString(), targetCollection.slug);
                        } catch (e) {
                            logger.warn(`Could not resolve target collection for relation property: ${propKey}`, { error: e });
                        }
                    }
                } else if (hasForeignKeyOnTarget(relation) && db && registry) {
                    // Inverse relation: FK is in target table, need to query for it
                    try {
                        const targetCollection = relation.target();
                        const targetTable = registry.getTable(getTableName(targetCollection));
                        const pks = getPrimaryKeys(collection, registry!);
                        // What the target's foreign key holds. Ordinarily this
                        // row's id; for a link on a natural key, the value of
                        // the column it points at — which is on the row already,
                        // so this costs nothing extra.
                        const currentId = relation.sourceKey
                            ? (data as Record<string, unknown>)[relation.sourceKey] as string | number | undefined
                            : buildCompositeId(data, pks);

                        if (targetTable && currentId !== undefined && currentId !== null && currentId !== "") {
                            const foreignKeyColumn = targetTable[relation.foreignKeyOnTarget as keyof typeof targetTable] as AnyPgColumn;
                            if (foreignKeyColumn) {
                                // Query the target table to find row that references this row
                                const relatedRows = await db
                                    .select()
                                    .from(targetTable)
                                    .where(eq(foreignKeyColumn, currentId))
                                    .limit(relation.cardinality === "one" ? 1 : 100); // Limit for one-to-one vs one-to-many

                                if (relatedRows.length > 0) {
                                    if (relation.cardinality === "one") {
                                        // One-to-one: return single relation object
                                        const targetPks = getPrimaryKeys(targetCollection, registry!);
                                        const relatedRow = relatedRows[0] as Record<string, unknown>;
                                        result[propKey] = createRelationRef(buildCompositeId(relatedRow, targetPks), targetCollection.slug);
                                    } else {
                                        // One-to-many: return array of relation objects
                                        const targetPks = getPrimaryKeys(targetCollection, registry!);
                                        result[propKey] = relatedRows.map((row: Record<string, unknown>) =>
                                            createRelationRef(buildCompositeId(row, targetPks), targetCollection.slug)
                                        );
                                    }
                                }
                            }
                        }
                    } catch (e) {
                        logger.warn(`Could not resolve inverse relation property: ${propKey}`, { error: e });
                    }
                } else if (relation.kind === "via" && db && registry) {
                    // Join path relation: Multi-hop relation using joins
                    try {
                        const targetCollection = relation.target();
                        const pks = getPrimaryKeys(collection, registry!);
                        const currentId = buildCompositeId(data, pks);

                        if (currentId) {
                            // Build the join query following the join path
                            const sourceTable = registry.getTable(getTableName(collection));
                            if (!sourceTable) {
                                logger.warn(`Source table not found for collection: ${collection.slug}`);
                                continue;
                            }

                            let query = db.select().from(sourceTable);
                            let currentTable = sourceTable;

                            // Apply each join in the path
                            for (const join of relation.joinPath) {
                                const joinTable = registry.getTable(join.table);
                                if (!joinTable) {
                                    logger.warn(`Join table not found: ${join.table}`);
                                    break;
                                }

                                // Parse the join condition - handle both string and array formats
                                const fromColumn = Array.isArray(join.on.from) ? join.on.from[0] : join.on.from;
                                const toColumn = Array.isArray(join.on.to) ? join.on.to[0] : join.on.to;

                                const fromParts = fromColumn.split(".");
                                const toParts = toColumn.split(".");

                                const fromColName = fromParts[fromParts.length - 1];
                                const toColName = toParts[toParts.length - 1];

                                const fromCol = currentTable[fromColName as keyof typeof currentTable] as AnyPgColumn;
                                const toCol = joinTable[toColName as keyof typeof joinTable] as AnyPgColumn;

                                if (!fromCol || !toCol) {
                                    logger.warn(`Join columns not found: ${fromColumn} -> ${toColumn}`);
                                    break;
                                }

                                query = query.innerJoin(joinTable, eq(fromCol, toCol)) as unknown as typeof query;
                                currentTable = joinTable;
                            }

                            // Add where condition for the current row
                            if (pks.length === 1) {
                                const sourceIdField = sourceTable[pks[0].fieldName as keyof typeof sourceTable] as AnyPgColumn;
                                query = query.where(eq(sourceIdField, currentId)) as typeof query;
                            } else {
                                // For composite keys, we would need to map the split parts. For now log a warning.
                                logger.warn(`Join path resolution for composite primary keys is not yet fully supported: ${collection.slug}`);
                            }

                            // Build additional conditions array
                            const additionalFilters: SQL[] = [];

                            // Combine parent condition with additional filters using AND
                            let combinedWhere: SQL | undefined;

                            if (pks.length === 1) {
                                const sourceIdField = sourceTable[pks[0].fieldName as keyof typeof sourceTable] as AnyPgColumn;
                                combinedWhere = DrizzleConditionBuilder.combineConditionsWithAnd([
                                    eq(sourceIdField, currentId),
                                    ...additionalFilters
                                ].filter(Boolean) as SQL[]);
                            }

                            // Execute the query
                            const joinResults = await query.where(combinedWhere).limit(relation.cardinality === "one" ? 1 : 100);

                            if (joinResults.length > 0) {
                                const targetPks = getPrimaryKeys(targetCollection, registry!);
                                const targetTableName = relation.joinPath[relation.joinPath.length - 1].table;

                                if (relation.cardinality === "one") {
                                    // One-to-one: return single relation object
                                    const joinResult = joinResults[0] as Record<string, unknown>;
                                    const targetRow = (joinResult[targetTableName] || joinResult) as Record<string, unknown>;
                                    result[propKey] = createRelationRef(buildCompositeId(targetRow, targetPks), targetCollection.slug);
                                } else {
                                    // One-to-many: return array of relation objects
                                    result[propKey] = joinResults.map((joinResult: Record<string, unknown>) => {
                                        const targetRow = (joinResult[targetTableName] || joinResult) as Record<string, unknown>;
                                        return createRelationRef(buildCompositeId(targetRow, targetPks), targetCollection.slug);
                                    });
                                }
                            }
                        }
                    } catch (e) {
                        logger.warn(`Could not resolve join path relation property: ${propKey}`, { error: e });
                    }
                }
            }
        }
    }

    return result as M;
}

/**
 * Try to decode a `data:application/octet-stream;base64,...` data URL string
 * into a Buffer. Returns null if the value is not a matching data URL.
 */
function tryDecodeBase64DataUrl(value: unknown): Buffer | null {
    if (typeof value !== "string") return null;
    if (!value.startsWith("data:application/octet-stream;base64,")) return null;
    const base64Data = value.split(",")[1];
    return base64Data ? Buffer.from(base64Data, "base64") : null;
}

/**
 * Try to resolve an unknown value into a Buffer.
 * Handles native Buffers and `{ type: "Buffer", data: number[] }` objects (from JSON deserialization).
 * Returns null if the value is not a buffer.
 */
function tryResolveBuffer(value: unknown): Buffer | null {
    if (Buffer.isBuffer(value)) return value;
    if (typeof value === "object" && value !== null) {
        const rawVal = value as Record<string, unknown>;
        if (rawVal.type === "Buffer" && Array.isArray(rawVal.data)) {
            return Buffer.from(rawVal.data as number[]);
        }
    }
    return null;
}

/**
 * Convert a Buffer to a UTF-8 string if all bytes are printable ASCII,
 * otherwise return a base64 data URL.
 */
function bufferToStringOrBase64(buf: Buffer): string {
    for (let i = 0; i < buf.length; i++) {
        const b = buf[i];
        // Allow standard printable ASCII + common whitespace (\r, \n, \t)
        if ((b < 32 || b > 126) && b !== 9 && b !== 10 && b !== 13) {
            return `data:application/octet-stream;base64,${buf.toString("base64")}`;
        }
    }
    return buf.toString("utf8");
}

export function parsePropertyFromServer(value: unknown, property: Property, collection: CollectionConfig, propertyKey?: string): unknown {
    if (value === null || value === undefined) return value;

    switch (property.type) {
        case "binary": {
            const buf = tryResolveBuffer(value);
            if (buf) {
                return `data:application/octet-stream;base64,${buf.toString("base64")}`;
            }
            return value;
        }

        case "string": {
            if (typeof value === "string") return value;

            // Handle Buffer objects (e.g. from PostgreSQL bytea columns)
            const buf = tryResolveBuffer(value);
            if (buf) {
                return bufferToStringOrBase64(buf);
            }

            if (typeof value === "object" && value !== null) {
                try {
                    return JSON.stringify(value);
                } catch {
                    return String(value);
                }
            }
            return String(value);
        }

        case "relation":
            // Transform ID back to relation object with type information
            if (typeof value === "string" || typeof value === "number") {
                // Normalization stamps the resolved relation onto the property;
                // fall back to the collection's map for a property that never
                // went through the registry.
                let relationDef: ResolvedRelation | undefined = (property as RelationProperty).resolvedRelation;
                if (!relationDef && propertyKey) {
                    relationDef = findRelation(resolveCollectionRelations(collection), propertyKey);
                }

                if (!relationDef) {
                    logger.warn(`ResolvedRelation not defined in property for key: ${propertyKey || "unknown"}`);
                    return value;
                }

                try {
                    const targetCollection = relationDef.target();
                    return createRelationRef(value.toString(), targetCollection.slug);
                } catch (e) {
                    logger.warn(`Could not resolve target collection for relation property: ${propertyKey || "unknown"}`, { error: e });
                    return value;
                }
            }
            return value;

        case "array":
            if (Array.isArray(value)) {
                if (property.of) {
                    return value.map(item => parsePropertyFromServer(item, property.of as Property, collection));
                } else if (property.oneOf) {
                    const typeField = property.oneOf.typeField ?? DEFAULT_ONE_OF_TYPE;
                    const valueField = property.oneOf.valueField ?? DEFAULT_ONE_OF_VALUE;
                    return value.map((e) => {
                        if (e === null) return null;
                        if (typeof e !== "object") return e;
                        const rec = e as Record<string, unknown>;
                        const type = rec[typeField] as string;
                        const childProperty = property.oneOf?.properties[type];
                        if (!type || !childProperty) return e;
                        return {
                            [typeField]: type,
                            [valueField]: parsePropertyFromServer(rec[valueField], childProperty, collection)
                        };
                    });
                }
            } else {
                // Non-array value from DB for an array property — coerce to avoid .map() crashes
                logger.warn(`Expected array value from DB for array property, got ${typeof value}. Coercing to array.`);
                return typeof value === "string" ? [value] : [];
            }
            return value;

        case "map":
            if (typeof value === "object" && property.properties) {
                const result: Record<string, unknown> = {};
                for (const [subKey, subValue] of Object.entries(value)) {
                    const subProperty = (property.properties as Properties)[subKey];
                    if (subProperty) {
                        result[subKey] = parsePropertyFromServer(subValue, subProperty, collection);
                    } else {
                        result[subKey] = subValue;
                    }
                }
                return result;
            }
            return value;

        case "number":
            if (typeof value === "string") {
                const parsed = parseFloat(value);
                return isNaN(parsed) ? null : parsed;
            }
            return value;

        case "vector": {
            let nums: number[] = [];
            if (typeof value === "string") {
                nums = value.slice(1, -1).split(",").map(Number);
            } else if (Array.isArray(value)) {
                nums = value.map(Number);
            } else if (value instanceof Vector) {
                nums = value.value;
            } else if (typeof value === "object" && value !== null && "value" in value) {
                const valObj = value as { value: unknown };
                if (Array.isArray(valObj.value)) {
                    nums = valObj.value.map(Number);
                }
            }
            return {
                __type: "Vector",
                value: nums
            };
        }

        case "date": {
            let date: Date | undefined;
            if (value instanceof Date) {
                date = value;
            } else if (typeof value === "string" || typeof value === "number") {
                const parsedDate = new Date(value);
                if (!isNaN(parsedDate.getTime())) {
                    date = parsedDate;
                }
            }
            if (date) {
                return {
                    __type: "date",
                    value: date.toISOString()
                };
            }
            return null;
        }

        default: {
            // Fallback for buffers in case they are mapped to something other than string
            const buf = tryResolveBuffer(value);
            if (buf) {
                return bufferToStringOrBase64(buf);
            }
            return value;
        }
    }
}

/**
 * Shared internal helper: normalizes scalar column values from a DB row
 * into frontend format. Handles FK-column preservation, type coercion
 * (dates, numbers, NaN), and property filtering.
 *
 * @param skipRelations  When `true`, relation-typed properties are omitted
 *                       from the result (used by `normalizeDbValues` where
 *                       Drizzle's relational API already hydrates them).
 */
/**
 * Keys a query computes and attaches to a row, rather than reads from a column.
 *
 * An explicit set rather than a `_` prefix rule: a user's column may perfectly
 * well be called `_internal`, and passing it through here would put a value on
 * the row that no property describes and nothing downstream knows how to type.
 */
const QUERY_METADATA_KEYS = new Set(["_score", "_distance"]);

function normalizeScalarValues<M extends Record<string, unknown>>(
    data: M,
    properties: Properties,
    collection: CollectionConfig,
    resolvedRelations: Record<string, ResolvedRelation>,
    options: { skipRelations: boolean }
): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    // Identify FK columns used only for relations and not exposed as properties
    const internalFKColumns = new Set<string>();
    Object.values(resolvedRelations).forEach(relation => {
        if (relation.kind === "belongsTo" && !properties[relation.localKey]) {
            internalFKColumns.add(relation.localKey);
        }
    });

    for (const [key, value] of Object.entries(data)) {
        // Keep internal FK columns as primitives
        if (internalFKColumns.has(key)) {
            result[key] = value === null ? null : (typeof value === "number" ? value : String(value));
            continue;
        }

        // Query-computed metadata, which by definition is not a column and so
        // has no property to be found. Dropped here until now — which meant
        // `_distance` was computed for every vector search on this path and
        // then discarded before the caller ever saw it.
        if (QUERY_METADATA_KEYS.has(key)) {
            result[key] = value;
            continue;
        }

        const property = properties[key as keyof M] as Property;
        if (!property) continue; // Skip DB columns not defined in properties

        if (options.skipRelations && property.type === "relation") continue;

        result[key] = parsePropertyFromServer(value, property, collection, key);
    }

    return result;
}

/**
 * Lightweight value normalization for db.query results.
 * Only handles type coercion (dates, numbers, NaN) and property filtering.
 * Does NOT query the database for relations — those are already resolved
 * by Drizzle's relational query API.
 *
 * Use this instead of `parseDataFromServer` when processing results from
 * `db.query.findFirst/findMany` which return pre-hydrated relation data.
 */
export function normalizeDbValues<M extends Record<string, unknown>>(
    data: M,
    collection: CollectionConfig
): M {
    const properties = collection.properties;
    if (!data || !properties) return data;

    const resolvedRelations = resolveCollectionRelations(collection);
    return normalizeScalarValues(data, properties, collection, resolvedRelations, { skipRelations: true }) as M;
}
