import { EntityReference, EntityRelation, GeoPoint, Vector } from "@rebasepro/types";
import { rebaseReviver } from "./reviver";

/**
 * Lossless round-tripping of rows through the offline store.
 *
 * Both persistence backends move values by structured clone, which keeps
 * `Date` but flattens every class instance to a plain object. For
 * `EntityReference`/`EntityRelation` that is harmless — they carry their own
 * `__type` discriminator, so the JSON reviver can rebuild them — but
 * `GeoPoint` and `Vector` do not, and would come back out of the cache as
 * anonymous `{ latitude, longitude }` / `{ value }` bags. A row read from the
 * cache must be indistinguishable from the same row read from the network, so
 * those two are tagged on the way in and revived on the way out.
 *
 * Type tests here are structural rather than `instanceof`, because a structured
 * clone can arrive from another realm — an iframe, a worker, or the polyfill
 * the tests run against — where the constructor identity differs but the value
 * is the real thing. Only *plain* objects are walked; anything else is passed
 * through whole, so a class instance is never quietly reduced to `{}`.
 */

function isDate(value: unknown): value is Date {
    return Object.prototype.toString.call(value) === "[object Date]";
}

/** An object literal — not a Date, RegExp, Map, or any class instance. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value) as { constructor?: { name?: string } } | null;
    if (proto === null || proto === Object.prototype) return true;
    // A literal cloned out of another realm has a different `Object.prototype`
    // but is still, in every way that matters here, a plain object.
    return proto.constructor?.name === "Object";
}

function dehydrateValue(value: unknown): unknown {
    if (value === null || value === undefined) return value;
    if (value instanceof GeoPoint) {
        return { __type: "GeoPoint", latitude: value.latitude, longitude: value.longitude };
    }
    if (value instanceof Vector) return { __type: "Vector", value: [...value.value] };
    // EntityReference/EntityRelation already serialize themselves via `__type`
    // own properties, so a structured clone is enough for the reviver below.
    if (value instanceof EntityReference || value instanceof EntityRelation) return value;
    if (Array.isArray(value)) return value.map(dehydrateValue);
    if (isPlainObject(value)) {
        const out: Record<string, unknown> = {};
        for (const [key, inner] of Object.entries(value)) out[key] = dehydrateValue(inner);
        return out;
    }
    return value;
}

function hydrateValue(value: unknown): unknown {
    if (value === null || value === undefined || isDate(value)) return value;
    if (Array.isArray(value)) return value.map(hydrateValue);
    if (typeof value === "object") {
        const revived = rebaseReviver("", value);
        // The reviver recognised it — hand back the class instance untouched
        // rather than walking into its (now private) internals.
        if (revived !== value) return revived;
        if (!isPlainObject(value)) return value;
        const out: Record<string, unknown> = {};
        for (const [key, inner] of Object.entries(value)) out[key] = hydrateValue(inner);
        return out;
    }
    return value;
}

/** Prepare a row for the store. */
export function dehydrateRow<T extends Record<string, unknown>>(row: T): Record<string, unknown> {
    return dehydrateValue(row) as Record<string, unknown>;
}

/** Restore a row read back from the store. */
export function hydrateRow<T extends Record<string, unknown>>(row: Record<string, unknown>): T {
    return hydrateValue(row) as T;
}
