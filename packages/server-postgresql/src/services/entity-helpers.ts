import { PgTable, AnyPgColumn } from "drizzle-orm/pg-core";
import { EntityCollection, Property } from "@rebasepro/types";
import { PostgresCollectionRegistry } from "../collections/PostgresCollectionRegistry";
import { getTableName } from "@rebasepro/common";

/**
 * Shared helper functions for entity operations.
 * These are used by EntityFetchService, EntityPersistService, and RelationService.
 *
 * All functions that need collection/table lookups require an explicit
 * `PostgresCollectionRegistry` instance — there is no global singleton.
 */

/**
 * Interface for Drizzle column metadata introspection.
 * Replaces unsafe `as unknown as Record<string, unknown>` double-cast chains.
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

export function getCollectionByPath(collectionPath: string, registry: PostgresCollectionRegistry): EntityCollection {
    const collection = registry.getCollectionByPath(collectionPath);
    if (!collection) {
        const registered = registry.getCollections().map(c => c.slug).join(", ");
        throw new Error(`Collection not found: ${collectionPath}. Registered collections: [${registered}]`);
    }
    return collection;
}

export function getTableForCollection(collection: EntityCollection, registry: PostgresCollectionRegistry): PgTable<any> {
    const tableName = getTableName(collection);
    const table = registry.getTable(tableName);
    if (!table) {
        throw new Error(`Table not found for collection '${collection.slug}' (table: ${tableName})`);
    }
    return table;
}

export function getPrimaryKeys(collection: EntityCollection, registry: PostgresCollectionRegistry): { fieldName: string; type: "string" | "number"; isUUID?: boolean }[] {
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
    const keys: { fieldName: string; type: "string" | "number"; isUUID?: boolean }[] = [];
    for (const [key, colRaw] of Object.entries(table)) {
        const col = colRaw as AnyPgColumn;
        if (col && typeof col === "object" && "primary" in col && col.primary) {
            const meta = getColumnMeta(col);
            const type = col.dataType === "number" || meta.columnType === "PgSerial" || meta.columnType === "PgInteger" ? "number" : "string";
            const isUUID = meta.columnType === "PgUUID";
            keys.push({ fieldName: key, type, isUUID });
        }
    }

    // Default to 'id' if no primary keys are found and it exists in the schema
    // This maintains backwards compatibility
    if (keys.length === 0 && "id" in table) {
        const idCol = table["id" as keyof typeof table] as AnyPgColumn;
        const idMeta = getColumnMeta(idCol);
        const type = idCol.dataType === "number" || idMeta.columnType === "PgSerial" || idMeta.columnType === "PgInteger" ? "number" : "string";
        const isUUID = idMeta.columnType === "PgUUID";
        keys.push({ fieldName: "id", type, isUUID });
    }

    return keys;
}

export function parseIdValues(idValue: string | number, primaryKeys: { fieldName: string; type: "string" | "number"; isUUID?: boolean }[]): Record<string, string | number> {
    const result: Record<string, string | number> = {};

    if (primaryKeys.length === 0) {
        return result;
    }

    if (primaryKeys.length === 1) {
        const pk = primaryKeys[0];
        if (pk.type === "number" && !pk.isUUID) {
            const parsed = typeof idValue === "number" ? idValue : parseInt(String(idValue), 10);
            if (isNaN(parsed)) {
                throw new Error(`Invalid numeric ID: ${idValue}`);
            }
            result[pk.fieldName] = parsed;
        } else {
            result[pk.fieldName] = String(idValue);
        }
        return result;
    }

    // Composite key - split by :::
    const parts = String(idValue).split(":::");
    if (parts.length !== primaryKeys.length) {
        throw new Error(`Composite ID parts mismatch. Expected ${primaryKeys.length}, got ${parts.length} for ID: ${idValue}`);
    }

    for (let i = 0; i < primaryKeys.length; i++) {
        const pk = primaryKeys[i];
        const val = parts[i];
        if (pk.type === "number" && !pk.isUUID) {
            const parsed = parseInt(val, 10);
            if (isNaN(parsed)) {
                throw new Error(`Invalid numeric ID component: ${val}`);
            }
            result[pk.fieldName] = parsed;
        } else {
            result[pk.fieldName] = val;
        }
    }

    return result;
}

export function buildCompositeId(values: Record<string, unknown>, primaryKeys: { fieldName: string; type: "string" | "number"; isUUID?: boolean }[]): string {
    if (primaryKeys.length === 0) {
        return "";
    }
    if (primaryKeys.length === 1) {
        return String(values[primaryKeys[0].fieldName] ?? "");
    }
    return primaryKeys.map(pk => String(values[pk.fieldName] ?? "")).join(":::");
}
