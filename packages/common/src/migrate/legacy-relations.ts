/**
 * How 0.30 resolved a legacy collection's relations — the defaults a relation
 * took, the name it was addressed by, the table a collection named — restated
 * over the frozen model so the lift reads a legacy collection exactly as the
 * 0.30 server did, without the kernel's collection helpers.
 *
 * Frozen with the model: these are the rules the derived names the database
 * already holds were computed with. Never "improve" one.
 */
import { generateForeignKeyName, toSnakeCase, toWireKey } from "@rebasepro/utils";

import {
    isLegacyPostgresCollection,
    type LegacyAnyCollectionConfig,
    type LegacyCollectionConfig,
    type LegacyJoinStep,
    type LegacyRelation,
    type LegacyResolvedRelation
} from "./legacy-model";

/**
 * The table a legacy collection reads and writes: `table`, else the slug in
 * snake_case, else the name in snake_case.
 *
 * @group Migration
 */
export function legacyTableName(collection: LegacyCollectionConfig): string {
    const declared = isLegacyPostgresCollection(collection) ? collection.table : undefined;
    return declared || toSnakeCase(collection.slug) || toSnakeCase(collection.name);
}

/**
 * The property key a column belongs to: the property whose `columnName` it
 * is, else the key it is (as written or in snake_case), else the column as a
 * wire key.
 *
 * @group Migration
 */
export function legacyFieldKeyForColumn(collection: LegacyCollectionConfig | undefined, column: string): string {
    const properties = collection?.properties;
    if (properties) {
        for (const [key, property] of Object.entries(properties)) {
            if (property.columnName === column) return key;
        }
        for (const key of Object.keys(properties)) {
            if (key === column) return key;
            if (toSnakeCase(key) === column) return key;
        }
    }
    return toWireKey(column);
}

/**
 * A relation looked up by key: as given, then in slug form, then in snake_case.
 *
 * @group Migration
 */
export function findLegacyRelation(
    resolved: Record<string, LegacyResolvedRelation>,
    key: string
): LegacyResolvedRelation | undefined {
    if (resolved[key]) return resolved[key];
    const slugKey = key.replace(/_/g, "-");
    if (slugKey !== key && resolved[slugKey]) return resolved[slugKey];
    const snakeKey = key.replace(/-/g, "_");
    if (snakeKey !== key && resolved[snakeKey]) return resolved[snakeKey];
    return undefined;
}

const resolvedCache = new WeakMap<LegacyCollectionConfig, Record<string, LegacyResolvedRelation>>();

/**
 * Every relation a legacy collection declares, keyed by the name it is
 * addressed by: the `relations` entries under their resolved name, then each
 * inline relation property under its key (unless a `relations` entry took it).
 *
 * @group Migration
 */
export function resolveLegacyCollectionRelations(collection: LegacyCollectionConfig): Record<string, LegacyResolvedRelation> {
    const cached = resolvedCache.get(collection);
    if (cached) return cached;
    if (!isLegacyPostgresCollection(collection)) return {};
    const relations: Record<string, LegacyResolvedRelation> = {};
    for (const relation of collection.relations ?? []) {
        const resolved = resolveLegacyRelation(relation, collection);
        relations[resolved.relationName] = resolved;
    }
    for (const [propertyKey, property] of Object.entries(collection.properties ?? {})) {
        if (property.type !== "relation" || !property.relation || relations[propertyKey]) continue;
        relations[propertyKey] = resolveLegacyRelation(property.relation, collection, propertyKey);
    }
    resolvedCache.set(collection, relations);
    return relations;
}

/**
 * A legacy relation with its defaults filled in, as 0.30's `resolveRelation`
 * filled them.
 *
 * @group Migration
 */
export function resolveLegacyRelation(
    relation: LegacyRelation,
    source: LegacyCollectionConfig,
    propertyKey?: string
): LegacyResolvedRelation {
    const target = relation.target;
    if (typeof target !== "function") {
        throw new Error(
            `Relation${relation.relationName ? ` '${relation.relationName}'` : ""} on ` +
            `'${source.slug}' has no \`target\`. Give it a thunk: \`target: () => otherCollection\`.`
        );
    }
    const targetCollection = callTarget(relation, source, propertyKey, target);
    const relationName = relation.relationName ?? propertyKey ?? toSnakeCase(targetCollection.slug);
    const shared = {
        relationName,
        // Normalised, not the thunk as written: every later call sees the
        // collection, never a module namespace `callTarget` looked past.
        target: (): LegacyAnyCollectionConfig => {
            const value = target();
            return asCollection(value) ?? value;
        },
        targetSlug: targetCollection.slug,
        onUpdate: relation.onUpdate,
        onDelete: relation.onDelete,
        overrides: relation.overrides
    };
    const sourceName = toSnakeCase(source.slug ?? source.name);
    switch (relation.kind) {
        case "belongsTo":
            return {
                ...shared,
                kind: "belongsTo",
                cardinality: "one",
                writable: true,
                shared: false,
                localKey: relation.localKey ?? generateForeignKeyName(relationName),
                index: relation.index !== false
            };
        case "hasOne":
            return {
                ...shared,
                kind: "hasOne",
                cardinality: "one",
                writable: true,
                shared: false,
                foreignKeyOnTarget: relation.foreignKeyOnTarget ?? generateForeignKeyName(sourceName),
                sourceKey: relation.sourceKey
            };
        case "hasMany":
            return {
                ...shared,
                kind: "hasMany",
                cardinality: "many",
                writable: true,
                shared: false,
                foreignKeyOnTarget: relation.foreignKeyOnTarget ?? generateForeignKeyName(sourceName),
                sourceKey: relation.sourceKey
            };
        case "manyToMany": {
            const sourceTable = legacyTableName(source);
            const targetTable = legacyTableName(targetCollection);
            return {
                ...shared,
                kind: "manyToMany",
                cardinality: "many",
                writable: true,
                shared: true,
                through: {
                    table: relation.through?.table ?? [sourceTable, targetTable].sort().join("_"),
                    sourceColumn: relation.through?.sourceColumn ?? generateForeignKeyName(sourceName),
                    targetColumn: relation.through?.targetColumn ?? generateForeignKeyName(relationName),
                    properties: relation.through?.properties ?? {}
                }
            };
        }
        case "via":
            return {
                ...shared,
                kind: "via",
                cardinality: relation.cardinality,
                writable: isSingleHopVia(relation.cardinality, relation.joinPath),
                shared: true,
                joinPath: relation.joinPath
            };
        default: {
            const exhaustive: never = relation;
            throw new Error(`Unknown relation kind: ${JSON.stringify(exhaustive)}`);
        }
    }
}

/** Whether a `via` chain has one link a write can set (0.30's rule). */
function isSingleHopVia(cardinality: "one" | "many", joinPath: readonly LegacyJoinStep[] | undefined): boolean {
    if (!Array.isArray(joinPath)) return false;
    if (joinPath.some(step => Array.isArray(step.on) && step.on.length !== 1)) return false;
    if (cardinality === "one") return joinPath.length === 1;
    return joinPath.length === 2 && joinPath[0].table !== joinPath[1].table;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function isCollectionLike(value: unknown): value is LegacyAnyCollectionConfig {
    return isRecord(value) && typeof value.slug === "string" && value.slug.length > 0;
}

/**
 * The collection a target thunk meant: the value itself, or — when a loader
 * that transpiles a module cycle to CommonJS handed over the module namespace
 * — the collection it default-exports.
 */
function asCollection(value: unknown): LegacyAnyCollectionConfig | undefined {
    if (isCollectionLike(value)) return value;
    if (isRecord(value) && isCollectionLike(value.default)) return value.default;
    return undefined;
}

function describe(relation: LegacyRelation, source: LegacyCollectionConfig, propertyKey?: string): string {
    const name = relation.relationName ?? propertyKey;
    return `Relation${name ? ` '${name}'` : ""} on '${source.slug}'`;
}

/** Call the target thunk, naming an import cycle when that is what broke it. */
function callTarget(
    relation: LegacyRelation,
    source: LegacyCollectionConfig,
    propertyKey: string | undefined,
    target: () => unknown
): LegacyAnyCollectionConfig {
    let value: unknown;
    try {
        value = target();
    } catch (error) {
        if (error instanceof ReferenceError) {
            throw new Error(
                `${describe(relation, source, propertyKey)} targets a collection that is not ` +
                `initialized yet — almost always an import cycle between the two collection files. ` +
                `Break the cycle (move the shared piece into a third module, or import the target ` +
                `lazily) so the target's module finishes evaluating before the registry is built.`,
                { cause: error }
            );
        }
        throw error;
    }
    const collection = asCollection(value);
    if (collection) return collection;
    const isPromise = isRecord(value) && typeof value.then === "function";
    throw new Error(
        `${describe(relation, source, propertyKey)} has a \`target\` that resolved to ` +
        `${value === undefined ? "`undefined`" : "something that is not a collection"}. ` +
        (value === undefined
            ? "Under CommonJS interop an import cycle resolves the default import to `undefined`, " +
              "so check whether this collection and its target import each other. Otherwise the thunk " +
              "is returning the wrong value — it must return the collection itself, not a promise or a module."
            : isPromise
                ? "The thunk returned a promise — `target: () => import(\"./other\")` is asynchronous. " +
                  "Import the collection at the top of the file and return the binding: " +
                  "`target: () => otherCollection`."
                : "The thunk must return a collection config with a `slug`.")
    );
}
