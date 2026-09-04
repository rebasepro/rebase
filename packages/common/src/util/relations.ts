import { CollectionConfig, isRelationalCollectionConfig, Property, ResolvedRelation, RelationProperty } from "@rebasepro/types";
import { toSnakeCase, toWireKey } from "@rebasepro/utils";

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

    if (!isRelationalCollectionConfig(collection)) return {};

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

/**
 * The path of the collection a relation property points at, derived from the
 * property alone.
 *
 * A preview holds a property and a value and no collection, so it cannot call
 * `resolveRelationProperty`. It does not need to: both forms that carry a
 * target — the stamped `resolvedRelation` and the inline `relation` — name it
 * directly. Only the third form, a relation declared by name in the
 * collection's `relations` array, is out of reach, and that one has no target
 * to read without the collection anyway.
 *
 * This is what lets a preview render a relation column that arrived as a bare
 * foreign key: the id says *which* row, the declared target says *which
 * collection*, and `RelationPreview` fetches the rest. Without it a scalar id
 * is indistinguishable from a value of the wrong type.
 */
export function getRelationTargetPath(property: RelationProperty): string | undefined {
    const stamped = property.resolvedRelation?.targetSlug;
    if (stamped) return stamped;

    const target = property.relation?.target;
    if (typeof target !== "function") return undefined;
    try {
        return target()?.slug;
    } catch (_e) {
        // A thunk reaching into a module that has not finished initialising:
        // there is no target to name yet, and a preview is not worth throwing over.
        return undefined;
    }
}

/**
 * The table a collection reads and writes.
 *
 * `table` when it is set, otherwise `toSnakeCase(slug)` — which is what made it
 * safe to drop `table` from the required fields on the config type: the runtime
 * had always derived it, and the type was demanding a value it did not need.
 *
 * The `||` chain is load-bearing. `toSnakeCase(undefined)` returns `""`, not
 * `undefined`, so the previous `??` chain short-circuited on the empty string
 * and the name fallback could never run — a safety net that read like one and
 * caught nothing. It was unreachable while `slug` was required; it stops being
 * unreachable the moment anything constructs a config without one.
 */
export function getTableName(collection: CollectionConfig): string {
    const declared = isRelationalCollectionConfig(collection) ? collection.table : undefined;
    return declared || toSnakeCase(collection.slug) || toSnakeCase(collection.name);
}

/**
 * A JavaScript identifier: what a generated `export const <name> =` needs.
 *
 * Deliberately the same shape the two schema generators already define
 * privately — this is the third place that needed it, and the first two guard
 * property keys and member accesses while nothing guarded the variable name
 * itself.
 */
const JS_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * The variable name a generated table is bound to.
 *
 * Camel-cases underscores, and then guarantees the result is a legal
 * identifier. It did only the first, so a table name that is legal in Postgres
 * and not in JavaScript produced a `schema.generated.ts` that does not parse:
 *
 *   `2024_archive`       → `export const 2024Archive = pgTable(…)`
 *                          "An identifier or keyword cannot immediately follow
 *                           a numeric literal"
 *   `reporting.events`   → `export const reporting.events = pgTable(…)`
 *                          "',' expected"
 *
 * That file is imported by the server, so the failure is not one broken
 * collection — `rebase build` and `db push` fail at tsc for the whole
 * directory. And it is reachable from a documented flow: `rebase init` against
 * a database holding a table called `2024_archive` writes a collection file
 * that parses and a schema file that does not.
 *
 * **A no-op for every name that already worked**, which is what makes changing
 * a derived name safe here: the only inputs whose output changes are the ones
 * that produced a syntax error, and nothing can be running against those.
 * Separators become camel case rather than disappearing, so `reporting.events`
 * and `reporting_events` do not collide into one variable.
 */
export function getTableVarName(tableName: string): string {
    const camel = tableName.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase());
    if (JS_IDENTIFIER.test(camel)) return camel;

    const sanitised = camel
        // Any other separator gets the same treatment `_` did, so two tables
        // differing only by separator keep differing.
        .replace(/[^A-Za-z0-9_$]+([A-Za-z0-9])?/g, (_, char?: string) =>
            (char ? char.toUpperCase() : ""))
        // A leading digit is legal in Postgres and not in JavaScript. Prefixed
        // rather than stripped, so `2024_archive` and `archive` stay distinct.
        .replace(/^([0-9])/, "t$1");

    return JS_IDENTIFIER.test(sanitised) ? sanitised : `t${sanitised}`;
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
 * The field key a database column is served and addressed under.
 *
 * A column has two names and they are not the same name. `author_id` is what
 * Postgres stores; `authorId` is the key on the JSON row, the key in the
 * generated Drizzle table, and the key a caller writes in `where` and
 * `orderBy`. Every place that starts from a column and has to reach a row, a
 * Drizzle table or a payload goes through here, so there is one answer rather
 * than one per call site — the two that disagreed put `displayName` and
 * `author_id` on the same API.
 *
 * A declared property is the authority when there is one, because its key *is*
 * the wire name and `columnName` is the only thing that ever renamed the
 * column:
 *
 *  1. an explicit `columnName` equal to this column;
 *  2. a property whose key is literally the column (an author who wrote
 *     `author_id:` meant `author_id` on the wire, and gets it);
 *  3. a property whose key snake-cases to the column, which is the default
 *     mapping — `authorId` → `author_id`.
 *
 * With no property in the way — a foreign key derived from a relation, which
 * usually has none — the name is derived: {@link toWireKey}.
 *
 * Note the fallback is *not* the column verbatim. That was the old behaviour
 * and it is precisely the defect: a derived foreign key reached the wire under
 * its column name while every hand-authored field beside it was camelCase.
 */
export function fieldKeyForColumn(collection: CollectionConfig | undefined, column: string): string {
    const properties = collection?.properties;
    if (properties) {
        for (const [key, prop] of Object.entries(properties)) {
            const columnName = (prop as { columnName?: unknown } | undefined)?.columnName;
            if (typeof columnName === "string" && columnName === column) return key;
        }
        for (const key of Object.keys(properties)) {
            if (key === column) return key;
            if (toSnakeCase(key) === column) return key;
        }
    }
    return toWireKey(column);
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
