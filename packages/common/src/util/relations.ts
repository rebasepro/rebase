import { CollectionConfig, getDataSourceCapabilities, Property, ResolvedRelation, RelationProperty } from "@rebasepro/types";
import { toSnakeCase } from "@rebasepro/utils";

import { resolveRelation } from "./resolve-relation";

/**
 * Whether the target rows are shared with other parents — a many-to-many, or a
 * multi-hop `via` chain.
 *
 * Decides what a write "through" the relation may touch: a shared target
 * belongs to every parent that links it, so the parent owns the *link* and not
 * the row. The backend enforces that (an unlink rather than a delete) and the
 * admin renders it (remove-from-parent rather than delete).
 *
 * Now a field on the resolved relation rather than a re-derivation, so both
 * sides read the same answer instead of each computing one.
 */
export function isJunctionBackedRelation(relation: ResolvedRelation): boolean {
    return relation.shared;
}

/** WeakMap cache — same collection instance always yields the same relation map. */
const _resolvedRelationsCache = new WeakMap<CollectionConfig, Record<string, ResolvedRelation>>();

/**
 * Every relation a collection declares, keyed by the name it is addressed by.
 *
 * A relation reaches the map from either of two places — the collection's
 * `relations` array, or a `relation` property that declares one inline — and is
 * keyed by its resolved `relationName`, which is what a nested path segment,
 * an `include` key and an admin tab all match against.
 *
 * Resolution no longer swallows failures. It used to wrap each relation in a
 * `try/catch` that dropped anything it could not work out, so a
 * mis-declared relation silently vanished instead of being reported; with the
 * kind declared, the only remaining failure is a `target` that does not resolve,
 * which is worth hearing about.
 */
export function resolveCollectionRelations(
    collection: CollectionConfig
): Record<string, ResolvedRelation> {
    const cached = _resolvedRelationsCache.get(collection);
    if (cached) return cached;

    if (!getDataSourceCapabilities(collection.engine).supportsRelations) return {};

    const relations: Record<string, ResolvedRelation> = {};

    for (const relation of collection.relations ?? []) {
        const resolved = resolveRelation(relation, collection);
        relations[resolved.relationName] = resolved;
    }

    // A property declaring a relation inline is registered under the property
    // key as well: the fetch layer hydrates the result back onto that key, and
    // it is the name the admin addresses the field by.
    for (const [propertyKey, property] of Object.entries(collection.properties ?? {})) {
        if ((property as Property)?.type !== "relation") continue;
        const declared = (property as RelationProperty).relation;
        if (!declared || relations[propertyKey]) continue;

        relations[propertyKey] = resolveRelation(declared, collection, propertyKey);
    }

    _resolvedRelationsCache.set(collection, relations);
    return relations;
}

export function getTableName(collection: CollectionConfig): string {
    if (getDataSourceCapabilities(collection.engine).supportsRelations) {
        return collection.table ?? toSnakeCase(collection.slug) ?? toSnakeCase(collection.name);
    }
    return toSnakeCase(collection.slug) ?? toSnakeCase(collection.name);
}

export function getTableVarName(tableName: string): string {
    return tableName.replace(/_([a-z])/g, (_, char) => char.toUpperCase());
}

export function getEnumVarName(tableName: string, propName: string): string {
    const tableVar = getTableVarName(tableName);
    const propVar = propName.charAt(0).toUpperCase() + propName.slice(1);
    return `${tableVar}${propVar}`;
}

export function getColumnName(fullColumn: string): string {
    return fullColumn.includes(".") ? fullColumn.split(".").pop()! : fullColumn;
}

/**
 * Look up a relation by key with forgiving normalization.
 *
 * `resolveCollectionRelations` stores each relation under a single canonical
 * key (no aliases). This helper tries the given key as-is, then falls back to
 * slug form (underscores → hyphens) and snake_case form (hyphens → underscores)
 * so that callers that receive a key from external input (URL path segments,
 * user-provided config, etc.) can still find the right entry.
 */
export function findRelation(
    resolvedRelations: Record<string, ResolvedRelation>,
    key: string
): ResolvedRelation | undefined {
    // Exact match first
    if (resolvedRelations[key]) return resolvedRelations[key];

    // Try slug form (e.g. "company_id" → "company-id")
    const slugKey = key.replace(/_/g, "-");
    if (slugKey !== key && resolvedRelations[slugKey]) return resolvedRelations[slugKey];

    // Try snake_case form (e.g. "company-id" → "company_id")
    const snakeKey = key.replace(/-/g, "_");
    if (snakeKey !== key && resolvedRelations[snakeKey]) return resolvedRelations[snakeKey];

    return undefined;
}
