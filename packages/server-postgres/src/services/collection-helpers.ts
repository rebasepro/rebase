import { PgTable, AnyPgColumn } from "drizzle-orm/pg-core";
import { CollectionConfig, Property } from "@rebasepro/types";
import { PostgresCollectionRegistry } from "../collections/PostgresCollectionRegistry";
import { getTableName } from "@rebasepro/common";

// Row identity is derived on both sides of the wire — the driver parses an
// incoming address into key columns, the admin derives one from a served row —
// so the implementation lives in `common` and both agree by construction.
export { buildCompositeId, parseIdValues, COMPOSITE_ID_SEPARATOR } from "@rebasepro/common";
export type { PrimaryKeyInfo } from "@rebasepro/common";
import type { PrimaryKeyInfo } from "@rebasepro/common";

/**
 * Shared helper functions for row operations.
 * These are used by FetchService, PersistService, and RelationService.
 *
 * All functions that need collection/table lookups require an explicit
 * `PostgresCollectionRegistry` instance — there is no global singleton.
 */

/**
 * Interface for Drizzle column metadata introspection.
 * Replaces unsafe `as Record<string, unknown>` double-cast chains.
 */
export interface DrizzleColumnMeta {
    columnType?: string;
    dataType?: string;
    primary?: boolean;
}

/** Safely extract Drizzle column metadata from a column object. */
export function getColumnMeta(col: AnyPgColumn): DrizzleColumnMeta {
    const raw = col as unknown as Record<string | symbol, unknown>;
    return {
        columnType: typeof raw.columnType === "string" ? raw.columnType : undefined,
        dataType: typeof raw.dataType === "string" ? raw.dataType : undefined,
        primary: typeof raw.primary === "boolean" ? raw.primary : undefined
    };
}

export function getCollectionByPath(collectionPath: string, registry: PostgresCollectionRegistry): CollectionConfig {
    const collection = registry.getCollectionByPath(collectionPath);
    if (!collection) {
        const registered = registry.getCollections().map(c => c.slug).join(", ");
        throw new Error(`Collection not found: ${collectionPath}. Registered collections: [${registered}]`);
    }
    return collection;
}

export function getTableForCollection(collection: CollectionConfig, registry: PostgresCollectionRegistry): PgTable<any> {
    const tableName = getTableName(collection);
    const table = registry.getTable(tableName);
    if (!table) {
        throw new Error(`Table not found for collection '${collection.slug}' (table: ${tableName})`);
    }
    return table;
}

export function getPrimaryKeys(collection: CollectionConfig, registry: PostgresCollectionRegistry): PrimaryKeyInfo[] {
    const table = getTableForCollection(collection, registry);

    // Fallback to explicitly defined isId properties
    if (collection.properties) {
        const idProps = Object.entries(collection.properties)
            .filter(([_, prop]) => "isId" in (prop as object) && Boolean((prop as { isId?: unknown }).isId))
            .map(([key, prop]) => ({
                fieldName: key,
                type: prop.type === "number" ? "number" as const : "string" as const,
                isUUID: (prop as { isId?: unknown }).isId === "uuid"
            }));

        if (idProps.length > 0) {
            return idProps;
        }
    }

    // Otherwise infer from Drizzle schema
    const keys: PrimaryKeyInfo[] = [];
    for (const [key, colRaw] of Object.entries(table)) {
        const col = colRaw as AnyPgColumn;
        if (col && typeof col === "object" && "primary" in col && col.primary) {
            const meta = getColumnMeta(col);
            const type = col.dataType === "number" || meta.columnType === "PgSerial" || meta.columnType === "PgInteger" ? "number" : "string";
            const isUUID = meta.columnType === "PgUUID";
            keys.push({ fieldName: key,
type,
isUUID });
        }
    }

    // Default to 'id' if no primary keys are found and it exists in the schema
    // This maintains backwards compatibility
    if (keys.length === 0 && "id" in table) {
        const idCol = table["id" as keyof typeof table] as AnyPgColumn;
        const idMeta = getColumnMeta(idCol);
        const type = idCol.dataType === "number" || idMeta.columnType === "PgSerial" || idMeta.columnType === "PgInteger" ? "number" : "string";
        const isUUID = idMeta.columnType === "PgUUID";
        keys.push({ fieldName: "id",
type,
isUUID });
    }

    return keys;
}

