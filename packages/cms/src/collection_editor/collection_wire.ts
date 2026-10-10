import { RUNTIME_ONLY_COLLECTION_KEYS } from "@rebasepro/types";

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

/** The slug a relation's `target` thunk points at, or `undefined` when it cannot be read. */
function targetSlugOf(target: unknown): string | undefined {
    if (typeof target === "string") return target;
    if (typeof target !== "function") return undefined;
    try {
        const resolved: unknown = target();
        if (typeof resolved === "string") return resolved;
        if (isPlainObject(resolved) && typeof resolved.slug === "string") return resolved.slug;
    } catch {
        // A thunk over a collection that is not loaded: the caller falls back.
    }
    return undefined;
}

function encode(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(encode);
    if (!isPlainObject(value)) return value;

    const next: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
        if (RUNTIME_ONLY_COLLECTION_KEYS.includes(key)) continue;
        next[key] = key === "target" && typeof entry === "function"
            ? targetSlugOf(entry) ?? entry
            : encode(entry);
    }

    // A relation property whose thunk could not be read still names its
    // target in what the runtime resolved for it.
    if (value.type === "relation" && isPlainObject(next.relation) && typeof next.relation.target !== "string") {
        const resolved = value.resolvedRelation;
        if (isPlainObject(resolved) && typeof resolved.targetSlug === "string") {
            next.relation = { ...next.relation, target: resolved.targetSlug };
        }
    }
    return next;
}

/**
 * A whole collection as the schema-editor routes take it.
 *
 * A collection the panel holds is the runtime's view of it: every relation's
 * `target` is a thunk, and the registry has added `resolvedRelation` beside
 * each relation. JSON drops the thunk, so a collection posted as it is arrives
 * with relations that have no target and is refused ("has no target
 * collection"), and the runtime's keys are refused as not belonging in a file.
 * Both servers read a `target` that is a slug and write the thunk back, so
 * each thunk is sent as the slug it points at, and the runtime's keys are left
 * out.
 */
export function collectionForWire(collection: Record<string, unknown>): Record<string, unknown> {
    return encode(collection) as Record<string, unknown>;
}
