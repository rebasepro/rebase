/**
 * What changed about a collection, as opposed to what the collection is.
 *
 * ## Why a save is a patch
 *
 * The admin panel edits a collection as JSON — the only form a browser and a
 * server can exchange it in — and JSON cannot carry most of what a collection
 * file holds: an entity action's `onClick`, a computed field's `value`, a
 * property shared from another module (`status: statusProperty`), an enum
 * imported from elsewhere (`enum: LOCALE_ENUM`), the comments around all of
 * them. A save that posted the whole collection and had it written back
 * rewrote every key it carried and deleted everything JSON had dropped, so
 * renaming a collection removed its actions' handlers, inlined its shared
 * property without the custom `Field`, and froze a copy of the enum.
 *
 * So a save sends what the person changed: the difference between the JSON
 * the editor loaded and the JSON it is saving. Anything JSON could not carry
 * is identical on both sides of that difference — dropped from both — and
 * cannot appear in it. The server applies the patch to the collection as it
 * is (for the plan) and writes only the patched keys into the file.
 *
 * ## The shape
 *
 * Two operations on paths of object keys. Arrays are values: an array that
 * changed is set whole. Positions in an array are not stable identities —
 * element 2 of an enum is not "the third value" once a value is inserted —
 * and the writer is the one place that can match an old element to its new
 * self (by `key`/`id`/`name`) and keep what JSON dropped from it.
 *
 * Paths are in the AUTHORING shape — presentation keys under `admin`, the
 * shape the file has — see {@link nestCollectionPatchPaths}.
 */
import { ADMIN_COLLECTION_KEYS, ADMIN_PROPERTY_KEYS, nestAdminCollectionKeys, nestAdminPropertyKeys } from "./admin_block";

/** One change to a collection. `path` is a list of object keys. */
export type CollectionPatchOp =
    | { op: "set"; path: string[]; value: unknown }
    | { op: "remove"; path: string[] };

/** @group Models */
export type CollectionPatch = CollectionPatchOp[];

/**
 * Keys the runtime adds to a collection that must never be written into its
 * source. `resolvedRelation` is the registry's resolved form of a relation; a
 * file holding one does not type-check (`target` is missing from it).
 */
export const RUNTIME_ONLY_COLLECTION_KEYS: readonly string[] = ["resolvedRelation"];

/** Path segments that reach an object's prototype rather than a key of it. */
const UNSAFE_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

/** A JSON value as JSON would carry it: functions, `undefined` and symbols dropped. */
export function toCollectionJson(value: unknown): unknown {
    if (value === undefined) return undefined;
    const text = JSON.stringify(value);
    return text === undefined ? undefined : JSON.parse(text);
}

function jsonEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (Array.isArray(a) && Array.isArray(b)) {
        return a.length === b.length && a.every((item, index) => jsonEqual(item, b[index]));
    }
    if (isPlainObject(a) && isPlainObject(b)) {
        const keys = Object.keys(a);
        if (keys.length !== Object.keys(b).length) return false;
        return keys.every(key => Object.prototype.hasOwnProperty.call(b, key) && jsonEqual(a[key], b[key]));
    }
    return false;
}

/**
 * The operations that take `before` to `after`, both JSON values.
 *
 * Objects are compared key by key; anything else that differs — a primitive,
 * an array, a change of kind — is set whole.
 */
export function diffJsonValues(before: unknown, after: unknown, path: string[] = []): CollectionPatch {
    if (jsonEqual(before, after)) return [];
    if (isPlainObject(before) && isPlainObject(after)) {
        const ops: CollectionPatch = [];
        for (const key of Object.keys(after)) {
            if (!Object.prototype.hasOwnProperty.call(before, key)) {
                ops.push({ op: "set", path: [...path, key], value: after[key] });
            } else {
                ops.push(...diffJsonValues(before[key], after[key], [...path, key]));
            }
        }
        for (const key of Object.keys(before)) {
            if (!Object.prototype.hasOwnProperty.call(after, key)) ops.push({ op: "remove", path: [...path, key] });
        }
        return ops;
    }
    return [{ op: "set", path, value: after }];
}

/**
 * Where a path lands in a collection, so a flat presentation key can be moved
 * into the `admin` block it belongs to.
 *
 * A collection holds `properties`, a map of properties; a property holds
 * `properties` (a map's children), `of` (an array's element) and
 * `oneOf.properties` (typed blocks). Every other key leaves the structure.
 */
type Position = "collection" | "properties" | "property" | "oneOf" | "other";

function step(position: Position, segment: string): Position {
    switch (position) {
        case "collection":
            return segment === "properties" ? "properties" : "other";
        case "properties":
            return "property";
        case "property":
            if (segment === "properties") return "properties";
            if (segment === "of") return "property";
            if (segment === "oneOf") return "oneOf";
            return "other";
        case "oneOf":
            return segment === "properties" ? "properties" : "other";
        default:
            return "other";
    }
}

function nestPath(path: string[]): { path: string[]; position: Position } {
    const nested: string[] = [];
    let position: Position = "collection";
    for (const segment of path) {
        const moved: boolean = (position === "collection" && (ADMIN_COLLECTION_KEYS as readonly string[]).includes(segment))
            || (position === "property" && (ADMIN_PROPERTY_KEYS as readonly string[]).includes(segment));
        if (moved) nested.push("admin");
        nested.push(segment);
        // Inside `admin` nothing is moved any further.
        position = moved ? "other" : step(position, segment);
    }
    return { path: nested, position };
}

function nestValue(position: Position, value: unknown): unknown {
    if (position === "property") {
        if (Array.isArray(value)) return value.map(entry => isPlainObject(entry) ? nestAdminPropertyKeys(entry) : entry);
        return isPlainObject(value) ? nestAdminPropertyKeys(value) : value;
    }
    if (position === "properties" && isPlainObject(value)) {
        return Object.fromEntries(Object.entries(value).map(([key, property]) =>
            [key, isPlainObject(property) ? nestAdminPropertyKeys(property) : property]));
    }
    if (position === "oneOf" && isPlainObject(value)) {
        return isPlainObject(value.properties)
            ? { ...value, properties: nestValue("properties", value.properties) }
            : value;
    }
    if (position === "collection" && isPlainObject(value)) {
        const nested = nestAdminCollectionKeys(value);
        return isPlainObject(nested.properties)
            ? { ...nested, properties: nestValue("properties", nested.properties) }
            : nested;
    }
    return value;
}

/**
 * The patch, with every flat presentation key moved into its `admin` block.
 *
 * The panel edits a flat view model — `icon` beside `name`, a property's
 * `readOnly` beside its `type` — while the file keeps them under `admin`. The
 * difference is taken on the flat model, because that is where a cleared field
 * shows up as a removed key (the `admin` copy the model was loaded with still
 * holds the old value), and moved here.
 *
 * The flat value wins over the `admin` copy, as in {@link nestAdminKeysOf}:
 * operations that were already under `admin` are ordered first, so the flat
 * one — what the form just wrote — is applied last.
 */
export function nestCollectionPatchPaths(patch: CollectionPatch): CollectionPatch {
    const nested = patch.map((op, index) => {
        const { path, position } = nestPath(op.path);
        const wasNested = op.path.includes("admin");
        const moved: CollectionPatchOp = op.op === "remove"
            ? { op: "remove", path }
            : { op: "set", path, value: nestValue(position, op.value) };
        return { moved, wasNested, index };
    });
    return nested
        .sort((a, b) => (a.wasNested === b.wasNested ? a.index - b.index : a.wasNested ? -1 : 1))
        .map(entry => entry.moved);
}

/**
 * The patch that takes the collection the editor loaded to the one it is
 * saving, in the authoring shape. Empty when nothing changed.
 *
 * Both sides go through JSON first, so whatever JSON cannot carry — a
 * function, a value it drops — is equally absent from both and never appears
 * as a change.
 */
export function diffCollections(loaded: unknown, saving: unknown): CollectionPatch {
    return nestCollectionPatchPaths(diffJsonValues(toCollectionJson(loaded), toCollectionJson(saving)));
}

/**
 * Why a patch may not be applied, or an empty list.
 *
 * Checked by every door that accepts one: a path is a list of non-empty object
 * keys that cannot reach a prototype, and no runtime-only key may be written.
 */
export function collectionPatchProblems(patch: unknown): string[] {
    if (!Array.isArray(patch)) return ["`patch` must be a list of operations."];
    const problems: string[] = [];
    patch.forEach((op: unknown, index) => {
        const where = `patch[${index}]`;
        if (!isPlainObject(op) || (op.op !== "set" && op.op !== "remove")) {
            problems.push(`${where} must be { op: "set", path, value } or { op: "remove", path }.`);
            return;
        }
        const path = op.path;
        if (!Array.isArray(path) || path.length === 0 || !path.every(segment => typeof segment === "string" && segment.length > 0)) {
            problems.push(`${where}.path must be a non-empty list of object keys.`);
            return;
        }
        const unsafe = path.find(segment => UNSAFE_SEGMENTS.has(segment as string));
        if (unsafe) problems.push(`${where}.path may not contain "${unsafe}".`);
        const runtime = path.find(segment => RUNTIME_ONLY_COLLECTION_KEYS.includes(segment as string));
        if (runtime) problems.push(`${where} writes "${runtime}", which the runtime adds and a collection file must not hold.`);
        if (op.op === "set") {
            const key = keyIn(op.value, key => UNSAFE_SEGMENTS.has(key) || RUNTIME_ONLY_COLLECTION_KEYS.includes(key));
            if (key) problems.push(`${where}.value holds "${key}", which a collection file must not hold.`);
        }
    });
    return problems;
}

/** A patch every door may apply: {@link collectionPatchProblems} found nothing. */
export function isCollectionPatch(patch: unknown): patch is CollectionPatch {
    return collectionPatchProblems(patch).length === 0;
}

function keyIn(value: unknown, matches: (key: string) => boolean): string | undefined {
    if (Array.isArray(value)) {
        for (const item of value) {
            const found = keyIn(item, matches);
            if (found) return found;
        }
        return undefined;
    }
    if (!isPlainObject(value)) return undefined;
    for (const key of Object.keys(value)) {
        if (matches(key)) return key;
        const found = keyIn(value[key], matches);
        if (found) return found;
    }
    return undefined;
}

/**
 * `target` with the patch applied, copying only what it changes.
 *
 * Everything the patch does not reach is shared with `target` by reference —
 * functions, thunks and all — which is what lets a planner see a relation's
 * `target()` on the patched collection exactly as it was. Intermediate objects
 * a `set` needs are created; a `remove` of a key that is not there is nothing
 * to do.
 */
export function applyCollectionPatch<T>(target: T, patch: CollectionPatch): T {
    let root: unknown = target;
    for (const op of patch) {
        root = applyOp(root, op.path, op);
    }
    return root as T;
}

function applyOp(node: unknown, path: string[], op: CollectionPatchOp): unknown {
    const [head, ...rest] = path;
    if (UNSAFE_SEGMENTS.has(head)) throw new Error(`A collection patch may not reach "${head}".`);
    const base: Record<string, unknown> = isPlainObject(node) ? { ...node } : {};
    if (rest.length === 0) {
        if (op.op === "remove") delete base[head];
        else base[head] = op.value;
        return base;
    }
    const child = Object.prototype.hasOwnProperty.call(base, head) ? base[head] : undefined;
    if (op.op === "remove" && !isPlainObject(child)) return node;
    base[head] = applyOp(child, rest, op);
    return base;
}
