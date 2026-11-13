import { EntityReference } from "@rebasepro/types";
import { resolveDataSource } from "@rebasepro/common";

/**
 * References between data sources: a Firestore document pointing at a
 * Postgres row, a Postgres column holding the id of a Firestore document.
 *
 * Such a reference is **stored as the target record's id** — a string, the
 * only value both sides can hold and query. It is a reference only in the
 * admin's view model, where it is an `EntityReference` carrying the target's
 * stored path and, as its `driver`, the key of the data source the target
 * lives in. That `driver` is what routes its preview, its picker and its
 * fetch to the right source: a path alone is ambiguous between sources (a
 * Firestore collection may be stored at `customers`, beside a Postgres
 * collection whose slug is `customers`).
 *
 * Which collection a reference property targets is read from its `path`, by
 * slug first — a reference property names its target as the admin addresses
 * it — and the target's data source from {@link resolveDataSource}. A
 * reference within one data source is not touched by anything here.
 */

/**
 * What the routing reads of a collection: any collection config, or a
 * table's projected collection whose properties hold a `reference` the
 * legacy Postgres property type does not admit.
 */
interface RoutedCollection {
    slug: string;
    /** Where a Firestore collection's documents are stored, when not at its slug. */
    path?: string;
    dataSource?: string;
    engine?: string;
    properties?: Record<string, unknown>;
}

/** The data-source key a collection is served by (registry-free: the key is the collection's own). */
function sourceKeyOf(collection: RoutedCollection | undefined): string {
    return resolveDataSource(collection).key;
}

/** Where a collection's records are stored: its declared `path`, else its slug. */
function storedPathOf(collection: RoutedCollection): string {
    return typeof collection.path === "string" && collection.path ? collection.path : collection.slug;
}

/** The target path a `reference` property names, or of each item of an array of references. */
function referenceTargetOf(property: unknown): { path: string, many: boolean } | undefined {
    if (!isRecord(property)) return undefined;
    if (property.type === "reference") {
        return typeof property.path === "string" && property.path ? { path: property.path, many: false } : undefined;
    }
    if (property.type === "array" && isRecord(property.of) && property.of.type === "reference") {
        const path = property.of.path;
        return typeof path === "string" && path ? { path, many: true } : undefined;
    }
    return undefined;
}

/**
 * A row's references to records of **other** data sources, as the
 * `EntityReference`s the admin previews, picks and fetches through.
 *
 * For each `reference` property (or array of references) of `collection`
 * whose target collection is served by a different data source: a stored id
 * (`"42"`, `42`), a `{ id }` object, or a reference that names the wrong
 * source or none — a pointer an older save wrote into the wrong store — each
 * becomes an `EntityReference` to the target, with the target's stored path
 * and its data source's key as `driver`. Every other value comes back as it
 * was, and a row with nothing to convert comes back as the same object.
 *
 * @param values the row's values (the admin's view model or the wire row)
 * @param collection the collection the row belongs to
 * @param resolveCollection a collection by slug — the admin's registry
 * @group Data
 */
export function routeCrossSourceReferences(
    values: Record<string, unknown>,
    collection: RoutedCollection | undefined,
    resolveCollection: ((slug: string) => RoutedCollection | undefined) | undefined
): Record<string, unknown> {
    if (!collection?.properties || !resolveCollection) return values;
    const ownKey = sourceKeyOf(collection);
    let out: Record<string, unknown> | undefined;
    for (const [key, property] of Object.entries(collection.properties)) {
        if (!(key in values)) continue;
        const reference = referenceTargetOf(property);
        if (!reference) continue;
        const target = resolveCollection(reference.path);
        if (!target) continue;
        const targetKey = sourceKeyOf(target);
        if (targetKey === ownKey) continue;
        const storedPath = storedPathOf(target);
        const value = values[key];
        const routed = reference.many
            ? Array.isArray(value) ? value.map(item => toRoutedReference(item, storedPath, targetKey)) : value
            : toRoutedReference(value, storedPath, targetKey);
        if (routed !== value) {
            out = out ?? { ...values };
            out[key] = routed;
        }
    }
    return out ?? values;
}

function toRoutedReference(value: unknown, path: string, driver: string): unknown {
    if (value instanceof EntityReference) {
        if (value.driver === driver && value.path === path) return value;
        return new EntityReference({ id: value.id, path, driver });
    }
    if ((typeof value === "string" && value !== "") || typeof value === "number") {
        return new EntityReference({ id: String(value), path, driver });
    }
    if (isRecord(value) && (typeof value.id === "string" || typeof value.id === "number") && value.id !== "") {
        return new EntityReference({ id: String(value.id), path, driver });
    }
    return value;
}

/**
 * Values about to be written to `collection`, with every reference to a
 * record of **another** data source replaced by that record's id.
 *
 * A reference names its data source in its `driver` (the admin's picker sets
 * it for a target on another source, and {@link routeCrossSourceReferences}
 * on read); one naming a different source than `collection`'s is stored as
 * its id — a Postgres `text` column cannot hold a Firestore pointer, and a
 * Firestore `DocumentReference` to a Postgres row points at nothing. Maps
 * and arrays are walked. A reference with no `driver`, or naming
 * `collection`'s own source, is left for the driver to store as it always
 * has. Values with nothing to replace come back as the same object.
 *
 * @param values the values to write
 * @param collection the collection they are written to
 * @group Data
 */
export function storeCrossSourceReferences<V extends Record<string, unknown>>(
    values: V,
    collection: RoutedCollection | undefined
): V {
    if (!collection) return values;
    const ownKey = sourceKeyOf(collection);
    const stored = storeValue(values, ownKey, collection.engine);
    return isRecord(stored) && stored !== values ? { ...values, ...stored } : values;
}

function storeValue(value: unknown, ownKey: string, ownEngine: string | undefined): unknown {
    if (value instanceof EntityReference) {
        const driver = value.driver;
        const foreign = driver !== undefined && driver !== ownKey && driver !== ownEngine;
        return foreign ? value.id : value;
    }
    if (Array.isArray(value)) {
        let changed = false;
        const items = value.map((item) => {
            const next = storeValue(item, ownKey, ownEngine);
            if (next !== item) changed = true;
            return next;
        });
        return changed ? items : value;
    }
    if (isPlainObject(value)) {
        let out: Record<string, unknown> | undefined;
        for (const [key, item] of Object.entries(value)) {
            const next = storeValue(item, ownKey, ownEngine);
            if (next !== item) {
                out = out ?? { ...value };
                out[key] = next;
            }
        }
        return out ?? value;
    }
    return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** An object literal's kind of object — not a `Date`, a `GeoPoint` or another class instance. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (!isRecord(value)) return false;
    const proto: unknown = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}
