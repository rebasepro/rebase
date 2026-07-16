import { PgTable, AnyPgColumn } from "drizzle-orm/pg-core";
import { CollectionConfig, Property } from "@rebasepro/types";
import { PostgresCollectionRegistry } from "../collections/PostgresCollectionRegistry";
import { getTableName } from "@rebasepro/common";
import { logger } from "@rebasepro/server";

// Row identity is derived on both sides of the wire — the driver parses an
// incoming address into key columns, the admin derives one from a served row —
// so the implementation lives in `common` and both agree by construction.
export { buildCompositeId, parseIdValues, COMPOSITE_ID_SEPARATOR } from "@rebasepro/common";
export type { PrimaryKeyInfo } from "@rebasepro/common";
import { buildCompositeId, COMPOSITE_ID_SEPARATOR, getDeclaredPrimaryKeys } from "@rebasepro/common";
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

/**
 * Collections whose key the *browser* cannot resolve, and what it will do
 * instead.
 *
 * The two sides resolve keys from different evidence. This driver reads, in
 * order: properties marked `isId`, the primary keys of the Drizzle schema, then
 * a column literally named `id`. The admin shares the `CollectionConfig` — it
 * compiles the same collection files into its bundle — but never the Drizzle
 * schema, so the middle tier is invisible to it.
 *
 * Nothing can normalize this at runtime: the server does not serve the admin
 * its collections, so a key resolved here cannot be handed over there. The
 * config files are the only thing both sides read, so the fix is an edit to
 * them, and the most this can do is say exactly which edit.
 *
 * Two shapes, and the second is the dangerous one:
 *
 * - No `isId`, no `id` property → the admin resolves no address, warns in the
 *   console, and rows cannot be opened or linked.
 * - No `isId`, but an `id` property that is *not* the key → the admin addresses
 *   rows by `id` while this driver reads the address as the real key. Nothing
 *   errors: the addresses look right and route wrong.
 */
export function findUnresolvableKeyCollections(
    collections: CollectionConfig[],
    registry: PostgresCollectionRegistry
): { collection: CollectionConfig; keys: PrimaryKeyInfo[]; shadowedByIdProperty: boolean }[] {
    const findings: { collection: CollectionConfig; keys: PrimaryKeyInfo[]; shadowedByIdProperty: boolean }[] = [];

    for (const collection of collections) {
        // Declared `isId` is the tier both sides share: if it is there, they agree.
        if (getDeclaredPrimaryKeys(collection).length > 0) continue;

        let keys: PrimaryKeyInfo[];
        try {
            keys = getPrimaryKeys(collection, registry);
        } catch {
            // No registered table — nothing resolved here either, so there is no
            // disagreement to report.
            continue;
        }
        if (keys.length === 0) continue;

        // A single key named `id` is the last tier on both sides: they agree
        // without anything being declared.
        if (keys.length === 1 && keys[0].fieldName === "id") continue;

        findings.push({
            collection,
            keys,
            shadowedByIdProperty: Boolean(collection.properties?.id)
        });
    }

    return findings;
}

/**
 * Report the collections from {@link findUnresolvableKeyCollections} at boot,
 * with the edit that fixes each one.
 *
 * Grouped by failure, not by collection: the shadowed case is a routing bug and
 * the silent case is a missing feature, and they deserve different urgency.
 */
export function warnOnKeysTheAdminCannotResolve(
    collections: CollectionConfig[],
    registry: PostgresCollectionRegistry
): void {
    const findings = findUnresolvableKeyCollections(collections, registry);
    if (findings.length === 0) return;

    const edit = (f: { collection: CollectionConfig; keys: PrimaryKeyInfo[] }) =>
        `${f.collection.slug}: mark ${f.keys.map(k => `\`${k.fieldName}\``).join(" and ")} with ` +
        `\`isId: ${f.keys[0].isUUID ? "\"uuid\"" : f.keys[0].type === "number" ? "\"increment\"" : "true"}\``;

    const shadowed = findings.filter(f => f.shadowedByIdProperty);
    const silent = findings.filter(f => !f.shadowedByIdProperty);

    if (shadowed.length > 0) {
        logger.warn(
            `⚠️ These collections declare no \`isId\`, and their key is only in the drizzle schema — but they ` +
            `do have a property called \`id\`. The admin has no way to know \`id\` is not the key, so it will ` +
            `address rows by it while this server reads the address as the real key: the links look right and ` +
            `route wrong. Nothing will error.\n\n` +
            shadowed.map(f => `  • ${edit(f)}`).join("\n") + "\n"
        );
    }

    if (silent.length > 0) {
        logger.warn(
            `⚠️ These collections declare no \`isId\`, and their key is only in the drizzle schema, which the ` +
            `admin never sees. It will resolve no address for their rows, so detail links, caching and ` +
            `relations will not work for them:\n\n` +
            silent.map(f => `  • ${edit(f)}`).join("\n") + "\n"
        );
    }
}

/**
 * The address of a row: derived from the collection's primary keys, because a
 * row does not carry one — it is exactly its columns.
 *
 * Falls back to a literal `id` column, which covers the two cases where the
 * keys cannot be resolved: a row that reached us from somewhere other than the
 * postgres driver, and a collection whose table the registry cannot look up
 * (`getPrimaryKeys` throws for an unregistered table rather than returning
 * nothing). Returns `""` when there is no key and no `id` — callers decide what
 * that means, since "unaddressable" is a different answer in a notification
 * (broadcast a wildcard) than in a save (fail).
 */
export function deriveRowAddress(
    row: Record<string, unknown>,
    collection: CollectionConfig,
    registry: PostgresCollectionRegistry
): string {
    try {
        const composite = buildCompositeId(row, getPrimaryKeys(collection, registry));
        // An all-empty composite is indistinguishable from a missing key, and
        // `buildCompositeId` returns "" for no keys at all.
        if (composite && composite.split(COMPOSITE_ID_SEPARATOR).some(part => part !== "")) {
            return composite;
        }
    } catch {
        /* unresolvable table or keys — fall through to the literal column */
    }
    if (row.id !== undefined && row.id !== null) return String(row.id);
    return "";
}

