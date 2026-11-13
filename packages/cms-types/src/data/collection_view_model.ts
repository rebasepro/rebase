/**
 * The admin's view model of the rows the data layer serves.
 *
 * `@rebasepro/common`'s data layer (`buildRebaseData`, `wrapAsEntityData`)
 * serves rows as the wire has them; the panel registers the conversions its
 * collections need through `EntityDataOptions` — built here from a collection
 * resolver by {@link collectionEntityDataOptions}.
 *
 * @module
 */
import { EntityReference, EntityRelation } from "@rebasepro/types";
import { type CollectionConfig } from "../types/collections";
import { toWireKey } from "@rebasepro/utils";
import {
    buildCompositeId,
    resolvePrimaryKeys,
    type EntityDataOptions,
    type PrimaryKeyInfo
} from "@rebasepro/common";
import {
    fieldKeyForColumn,
    resolveCollectionRelations
} from "../util/collection_relations";
import { routeCrossSourceReferences, storeCrossSourceReferences } from "./cross_source_references";

/** A collection's config by slug — the admin's registry. */
export type CollectionResolver = (slug: string) => CollectionConfig | undefined;

/**
 * `EntityDataOptions` for the admin: rows addressed by their collection's
 * declared key, converted to the collection's view model on the way in, and
 * cross-source references stored as ids on the way out. Every hook resolves
 * the collection when asked, not up front: the data layer is created by
 * `Rebase`, which sits above the admin that owns the collections.
 */
export function collectionEntityDataOptions(
    resolveCollection: CollectionResolver,
    options: Pick<EntityDataOptions, "resolveDataPath" | "resolveAccessor"> = {}
): EntityDataOptions {
    const viewModelOf = createViewModelConverter(resolveCollection);
    return {
        ...options,
        primaryKeysOf: createPrimaryKeyResolver(resolveCollection),
        viewModelOf,
        storedValuesOf: createStoredValuesConverter(resolveCollection),
        viewModelSourceOf: resolveCollection
    };
}

/** The key a collection's rows are addressed by; warns once for a collection that declares none. */
function createPrimaryKeyResolver(resolveCollection: CollectionResolver): (slug: string) => PrimaryKeyInfo[] | undefined {
    const warned = new Set<string>();
    return (slug: string) => {
        const collection = resolveCollection(slug);
        if (!collection) return undefined;
        const keys = resolvePrimaryKeys(collection);
        if (keys.length === 0 && !warned.has(slug)) {
            warned.add(slug);
            // Silence here surfaces much later as rows that cannot be opened,
            // linked, or saved, with nothing pointing back at the cause.
            console.warn(
                `[rebase] Collection '${slug}' declares no primary key, so its rows have no address: ` +
                `detail links, caching and relations will not work for it. ` +
                `Mark the key property with \`isId\` in its collection config — the server logs which ` +
                `column to mark at boot, if its schema knows the key.`
            );
        }
        return keys;
    };
}

/**
 * Build the admin's view model out of the row the wire serves.
 *
 * The wire has ONE shape, for every consumer: flat columns, typed the way the
 * database typed them, and a relation rendered as the target's own columns (or
 * only its foreign key, when nothing asked for it). That is the REST contract,
 * what `find()` returns, what `listen()` pushes, and what the generated types
 * describe.
 *
 * The admin renders neither of those directly. Its date field requires a real
 * `Date` and rejects a string outright; its relation cells read `.data.values`
 * off a relation ref. Those requirements are the *admin's*, so they are met
 * here — in the browser, from the collection config the panel already has —
 * rather than by asking the server for a second wire shape.
 *
 * That second shape is what this replaces. Until 2026-09-09 the realtime wire
 * carried the view model and every other read carried flat rows, so `find()`
 * and `listen()` answered one query two ways; unifying the wire without doing
 * this conversion is what left every date cell reading "Invalid date value"
 * and every relation cell "Unexpected value".
 *
 * Values already in view-model form pass through untouched: a direct driver
 * (Firestore, a custom one) that serves a `Date` or an `EntityRelation` is
 * served by the same walk. A Rebase server never sends one — its every read
 * is the wire row.
 */
function toViewModelValues(
    values: Record<string, unknown>,
    properties: Record<string, unknown> | undefined,
    collection: CollectionConfig | undefined,
    resolveCollection?: CollectionResolver
): Record<string, unknown> {
    if (!properties) return values;

    const relations = collection
        ? resolveCollectionRelations(collection)
        : {};
    let out: Record<string, unknown> | undefined;
    const write = (key: string, value: unknown) => {
        out = out ?? { ...values };
        out[key] = value;
    };

    for (const [key, rawProperty] of Object.entries(properties)) {
        const property = rawProperty as { type?: string; of?: { type?: string }; properties?: Record<string, unknown> } | undefined;
        if (!property) continue;

        // A relation nobody included is still a relation: the row carries only
        // its foreign key, and an addressable ref with no data attached is what
        // lets the preview fetch the one record it needs. Without this the
        // record form showed an empty chip where the customer goes, on a read
        // that did not name the relation in its `include`.
        if (!(key in values)) {
            const fkRelation = relations[key];
            // `localKey` is the column; the row is keyed the way the wire keys
            // it: under a property that names the column, else that column
            // camelCased (`customer_id` → `customerId`).
            const column = fkRelation && "localKey" in fkRelation ? fkRelation.localKey : undefined;
            const fk = column !== undefined
                ? values[fieldKeyForColumn(collection, column)] ?? values[column] ?? values[toWireKey(column)]
                : undefined;
            const fkTarget = fkRelation?.targetSlug;
            if (fkTarget && (typeof fk === "string" || typeof fk === "number")) {
                write(key, new EntityRelation(fk, fkTarget));
            }
            continue;
        }

        const value = values[key];
        if (value === null || value === undefined) continue;

        // A relation, under the property key or the relation name.
        const relation = relations[key];
        if (relation && (property.type === "relation" || property.of?.type === "relation" || property.type === "array")) {
            const target = relation.targetSlug;
            if (!target) continue;
            const targetProperties = resolveCollection?.(target)?.properties;
            const targetCollection = resolveCollection?.(target);
            const toRef = (item: unknown): unknown => {
                if (item instanceof EntityRelation) return item;
                if (typeof item === "object" && item !== null && "__type" in item) return item;
                // The target's own columns: the id it is addressed by, and the
                // values a relation cell renders without a second fetch.
                if (typeof item === "object" && item !== null) {
                    const row = item as Record<string, unknown>;
                    const keys = targetCollection ? resolvePrimaryKeys(targetCollection) : [];
                    const id = keys.length > 0 ? buildCompositeId(row, keys) : row.id as string | number;
                    if (id === undefined || id === null || id === "") return item;
                    return new EntityRelation(id, target, {
                        id,
                        path: target,
                        values: toViewModelValues(row, targetProperties, targetCollection, resolveCollection)
                    });
                }
                // Only the foreign key came back — nothing asked for the
                // relation. Addressable, with nothing to render but its id.
                if (typeof item === "string" || typeof item === "number") {
                    return new EntityRelation(item, target);
                }
                return item;
            };
            write(key, Array.isArray(value) ? value.map(toRef) : toRef(value));
            continue;
        }

        if (property.type === "date" && !(value instanceof Date)) {
            if (typeof value === "string" || typeof value === "number") {
                const date = new Date(value);
                write(key, isNaN(date.getTime()) ? null : date);
            }
            continue;
        }

        // A map's children are declared too, and a date two levels down is
        // still a date.
        if (property.type === "map" && property.properties && typeof value === "object" && !Array.isArray(value)) {
            write(key, toViewModelValues(value as Record<string, unknown>, property.properties, undefined, resolveCollection));
        }
    }

    return out ?? values;
}

/**
 * The view-model converter for one collection, or `undefined` when there is no
 * collection config to build it from.
 *
 * Absent is the honest answer for every consumer that is not the admin: the
 * flat SDK derives itself from this same layer (`buildSdkData`) and must keep
 * the wire's own types, and it registers no collection resolver.
 */
function createViewModelConverter(resolveCollection: CollectionResolver) {
    return function converterFor(slug: string) {
        return (values: Record<string, unknown>): Record<string, unknown> => {
            // Resolved per call rather than memoized: the resolver is
            // late-bound (see `createPrimaryKeyResolver`) and a collection
            // edited in the schema editor should not need a reload here.
            const collection = resolveCollection(slug);
            if (!collection) return values;
            // A reference to a record of another data source is stored as
            // its id; in the view model it is a reference routed to that
            // source (see `routeCrossSourceReferences`).
            return routeCrossSourceReferences(
                toViewModelValues(values, collection.properties, collection, resolveCollection),
                collection,
                resolveCollection
            );
        };
    };
}

/**
 * The converter values pass through on their way to the store of one
 * collection — the inverse half of {@link createViewModelConverter}: a
 * reference to a record of another data source becomes that record's id
 * (see `storeCrossSourceReferences`). Identity where no collection resolver
 * is registered: the flat SDK writes what it is handed.
 */
function createStoredValuesConverter(resolveCollection: CollectionResolver) {
    return function storedValuesFor(slug: string) {
        return <V extends Record<string, unknown>>(values: V): V => {
            const collection = resolveCollection(slug);
            return collection ? storeCrossSourceReferences(values, collection) : values;
        };
    };
}

/**
 * A row as the server sends it, in the admin's view model of its collection:
 * the `values` `buildRebaseData` and `wrapAsEntityData` give an `Entity` of
 * that collection — a date as a `Date`, a relation as an `EntityRelation`,
 * also under its property's key where the row carries only the foreign key —
 * and a `reference` property's id as an `EntityReference`. A collection the
 * resolver does not know leaves the row as it is.
 *
 * For code that holds a flat row and hands it to what expects the admin's
 * values, such as a collection's `browserCallbacks` or a preview.
 */
export function rowToViewModel(
    row: Record<string, unknown>,
    slug: string,
    resolveCollection: CollectionResolver
): Record<string, unknown> {
    const collection = resolveCollection(slug);
    if (!collection) return row;
    return routeCrossSourceReferences(
        withReferences(toViewModelValues(row, collection.properties, collection, resolveCollection), collection.properties),
        collection,
        resolveCollection
    );
}

/**
 * Each `reference` property's value — the referenced id, or `{ id, path }` —
 * as the `EntityReference` the admin's reference field and preview read; an
 * array of references item by item.
 */
function withReferences(values: Record<string, unknown>, properties: Record<string, unknown> | undefined): Record<string, unknown> {
    if (!properties) return values;
    let out: Record<string, unknown> | undefined;
    for (const [key, property] of Object.entries(properties)) {
        if (!(key in values)) continue;
        const value = values[key];
        const path = referencePath(property);
        const arrayPath = isPlainRecord(property) && property.type === "array" ? referencePath(property.of) : undefined;
        if (path !== undefined) {
            out = out ?? { ...values };
            out[key] = toReference(value, path);
        } else if (arrayPath !== undefined && Array.isArray(value)) {
            out = out ?? { ...values };
            out[key] = value.map(item => toReference(item, arrayPath));
        }
    }
    return out ?? values;
}

/** The target path of a `reference` property; `undefined` for any other. */
function referencePath(property: unknown): string | undefined {
    if (!isPlainRecord(property) || property.type !== "reference") return undefined;
    return typeof property.path === "string" ? property.path : "";
}

function toReference(value: unknown, path: string): unknown {
    if (value === null || value === undefined || value === "") return null;
    if (value instanceof EntityReference) return value;
    if ((typeof value === "string" || typeof value === "number") && path) {
        return new EntityReference({ id: String(value), path });
    }
    if (isPlainRecord(value) && (typeof value.id === "string" || typeof value.id === "number")) {
        const target = typeof value.path === "string" ? value.path : path;
        if (target) return new EntityReference({ id: String(value.id), path: target });
    }
    return value;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

