import type { PendingMutation } from "./offline-store";

/**
 * Rows and queued writes through the offline store.
 *
 * Both persistence backends move values by structured clone. What goes in is
 * wire values — the row a Rebase server serves, and the values a write sends
 * (the admin converts its view model before it hands a write to the client) —
 * so a clone gives back exactly what went in, `Date` included. The one thing
 * a structured clone gets wrong is a key named `__proto__`, so rows are
 * copied key by key on both sides ({@link setOwn}).
 *
 * A queued write from before layout 2 (`QUEUE_SCHEMA_VERSION`) is the exception:
 * the admin handed the client its view model then, and the store kept those
 * values as plain objects tagged with their class (`{ __type: "relation",
 * id, … }`, `{ __type: "GeoPoint", … }`, `{ __type: "Vector", value }`,
 * `{ __type: "reference", id, … }`). Such an entry is a user's unsynced write,
 * so it is converted to the wire values the server stored for it — a relation
 * as its key, a point as `{ latitude, longitude }`, a vector as its numbers,
 * a reference as its id — rather than dropped or replayed in a shape the
 * server no longer accepts ({@link hydrateMutation}).
 *
 * Only *plain* objects are walked (tested structurally: a clone may come from
 * another realm); anything else is passed through whole.
 */

/** An object literal — not a Date, RegExp, Map, or any class instance. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value) as { constructor?: { name?: string } } | null;
    if (proto === null || proto === Object.prototype) return true;
    // A literal cloned out of another realm has a different `Object.prototype`
    // but is still, in every way that matters here, a plain object.
    return proto.constructor?.name === "Object";
}

/**
 * `out[key] = value`, as an own property whatever the key. Assigned, a key
 * read from stored data that is literally `__proto__` (which `JSON.parse`
 * creates as an own property) set the new object's prototype instead, and the
 * column was gone from the row.
 */
export function setOwn(out: Record<string, unknown>, key: string, value: unknown): void {
    Object.defineProperty(out, key, { value, enumerable: true, writable: true, configurable: true });
}

/** A copy of a value, walked so that every key — `__proto__` too — stays an own property. */
function copyValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(copyValue);
    if (isPlainObject(value)) {
        const out: Record<string, unknown> = {};
        for (const [key, inner] of Object.entries(value)) setOwn(out, key, copyValue(inner));
        return out;
    }
    return value;
}

/**
 * The wire value a tagged view-model value of a queue entry from before
 * layout 2 stands for (see the module comment), or the value itself.
 */
function wireOfTagged(value: Record<string, unknown>): unknown {
    switch (value.__type) {
        case "relation":
        case "reference":
            return typeof value.id === "string" || typeof value.id === "number" ? value.id : value;
        case "GeoPoint":
            return typeof value.latitude === "number" && typeof value.longitude === "number"
                ? { latitude: value.latitude, longitude: value.longitude }
                : value;
        case "Vector":
            return Array.isArray(value.value) ? value.value.map(Number) : value;
        default:
            return value;
    }
}

/** {@link copyValue}, with each tagged view-model value as its wire value. */
function wireOfLegacyValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(wireOfLegacyValue);
    if (isPlainObject(value)) {
        const converted = wireOfTagged(value);
        if (converted !== value) return converted;
        const out: Record<string, unknown> = {};
        for (const [key, inner] of Object.entries(value)) setOwn(out, key, wireOfLegacyValue(inner));
        return out;
    }
    return value;
}

/** Prepare a row for the store. */
export function dehydrateRow<T extends Record<string, unknown>>(row: T): Record<string, unknown> {
    return copyValue(row) as Record<string, unknown>;
}

/** Restore a row read back from the store. */
export function hydrateRow<T extends Record<string, unknown>>(row: Record<string, unknown>): T {
    return copyValue(row) as T;
}

/**
 * A queued write as the store keeps it, and back: its payloads are rows, each
 * copied by {@link copyValue} — or, for an entry of an older layout, turned
 * into wire values.
 */
function mapMutation(op: PendingMutation, map: (value: unknown) => unknown): PendingMutation {
    const rows = (value: PendingMutation["data"]) => value === undefined ? value : map(value) as PendingMutation["data"];
    return {
        ...op,
        ...(op.data !== undefined ? { data: rows(op.data) } : {}),
        ...(op.parts ? { parts: op.parts.map((part) => map(part) as Record<string, unknown>) } : {}),
        ...(op.updates ? { updates: op.updates.map((u) => ({ id: u.id, data: map(u.data) as Record<string, unknown> })) } : {}),
        ...(op.rollback
            ? {
                rollback: {
                    rows: Object.fromEntries(Object.entries(op.rollback.rows).map(([id, row]) =>
                        [id, row === null ? null : map(row) as Record<string, unknown>]))
                }
            }
            : {}),
        ...(op.sent?.data !== undefined ? { sent: { ...op.sent, data: rows(op.sent.data) } } : {})
    };
}

/** Prepare a queued write for the store. */
export function dehydrateMutation(op: PendingMutation): PendingMutation {
    return mapMutation(op, copyValue);
}

/**
 * Restore a queued write read back from the store. An entry of layout 1 —
 * written before the client held wire values only — has its view-model values
 * converted to wire values and is stamped with the current layout, so it
 * replays as the server stored such a write and is persisted that way the
 * next time the entry is written back.
 */
export function hydrateMutation(op: PendingMutation): PendingMutation {
    if ((op.schemaVersion ?? 1) >= 2) return mapMutation(op, copyValue);
    return { ...mapMutation(op, wireOfLegacyValue), schemaVersion: 2 };
}
