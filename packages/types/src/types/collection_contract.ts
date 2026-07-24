import type { CollectionConfig } from "./collections";

/**
 * Serializing collections so they survive a network hop.
 *
 * A collection definition is not plain data. Relations point at their target
 * with a *function* (`target: () => usersCollection`) so two collections can
 * reference each other without an import cycle, and collections also carry
 * callbacks, custom views and component references. `JSON.stringify` silently
 * drops every one of those, which matters because the SDK generator *calls*
 * `relation.target()` to decide whether a foreign key is a string or a number.
 * Serialize naively and remote SDK generation produces subtly wrong types
 * instead of failing — the worst possible outcome.
 *
 * So relation targets are resolved to a slug reference on the way out and
 * rebuilt into functions on the way in. Everything else that cannot cross a wire
 * is dropped deliberately: an SDK is generated from the *shape* of the data, and
 * server-side behaviour is neither useful to a client nor safe to publish.
 */

/** Marker replacing a relation's `target` function in serialized form. */
export interface SerializedCollectionRef {
    __collectionRef: string;
}

export function isSerializedCollectionRef(value: unknown): value is SerializedCollectionRef {
    return typeof value === "object"
        && value !== null
        && typeof (value as SerializedCollectionRef).__collectionRef === "string";
}

/** Depth limit for the walk — deep enough for real configs, finite for cyclic ones. */
const MAX_DEPTH = 64;

/**
 * Resolve whatever a `target` thunk returns down to a collection.
 *
 * A target may be the collection, a module namespace (when the authoring file
 * used `import * as`), or a default-export wrapper. All three appear in real
 * projects, and the SDK generator already unwraps them the same way.
 */
function unwrapTarget(value: unknown): CollectionConfig | undefined {
    if (!value || typeof value !== "object") return undefined;
    const candidate = value as { default?: unknown; __esModule?: boolean; properties?: unknown };
    if (candidate.default || candidate.__esModule) {
        const inner = candidate.default;
        if (inner && typeof inner === "object") return inner as CollectionConfig;
    }
    if (candidate.properties) return value as CollectionConfig;
    return undefined;
}

/** The identity a serialized reference uses. Slug first — it is the routing key. */
function refFor(collection: CollectionConfig | undefined): string | undefined {
    if (!collection) return undefined;
    const withPath = collection as CollectionConfig & { path?: string };
    return collection.slug || withPath.path || collection.name;
}

/**
 * Deep-copy a value into something JSON can carry.
 *
 * `target` keys are special-cased into refs. Other functions vanish, cycles are
 * cut, and everything else is copied structurally.
 */
function toSerializable(value: unknown, seen: WeakSet<object>, depth: number, key?: string): unknown {
    if (depth > MAX_DEPTH) return undefined;

    if (typeof value === "function") {
        // Only a relation target carries information a client needs. Calling it
        // is safe here — this runs on the server, where the target module is
        // already loaded — and a throwing target simply yields no reference,
        // which degrades the generated FK type rather than failing the request.
        if (key === "target") {
            try {
                const resolved = unwrapTarget((value as () => unknown)());
                const ref = refFor(resolved);
                return ref ? { __collectionRef: ref } : undefined;
            } catch {
                return undefined;
            }
        }
        return undefined;
    }

    if (value === null || typeof value !== "object") {
        return value;
    }

    if (value instanceof Date) return value.toISOString();
    if (value instanceof RegExp) return value.source;

    if (seen.has(value as object)) return undefined;
    seen.add(value as object);

    try {
        if (Array.isArray(value)) {
            const items = value
                .map(item => toSerializable(item, seen, depth + 1))
                .filter(item => item !== undefined);
            // A container that had content, none of which can be represented, is
            // itself unrepresentable — see the note below.
            return value.length > 0 && items.length === 0 ? undefined : items;
        }

        // A React element or component reference has no meaning to a client and
        // will not survive JSON anyway.
        if ("$$typeof" in (value as Record<string, unknown>)) return undefined;

        const entries = Object.entries(value as Record<string, unknown>);
        const out: Record<string, unknown> = {};
        for (const [k, v] of entries) {
            const converted = toSerializable(v, seen, depth + 1, k);
            if (converted !== undefined) out[k] = converted;
        }

        // Drop a container whose entire content was dropped.
        //
        // `callbacks: { beforeSave() {…} }` would otherwise serialize to
        // `callbacks: {}` — an empty husk that carries no information but is not
        // *nothing*, so it lands in the payload and, worse, in the schema hash.
        // Editing a hook would then change every client's schema version and
        // report perfectly current SDKs as stale.
        //
        // A container that started empty stays empty: `properties: {}` is a
        // deliberate statement, not a casualty.
        if (entries.length > 0 && Object.keys(out).length === 0) return undefined;

        return out;
    } finally {
        // Released so a collection referenced twice in different branches is
        // emitted twice rather than being dropped as a false cycle.
        seen.delete(value as object);
    }
}

/**
 * Serialize collections for transport over the contract endpoint.
 *
 * Sorted by slug so the output — and therefore the schema hash computed from it
 * — does not depend on filesystem ordering.
 */
export function serializeCollections(collections: CollectionConfig[]): unknown[] {
    return [...collections]
        .sort((a, b) => String(a.slug ?? "").localeCompare(String(b.slug ?? "")))
        .map(collection => toSerializable(collection, new WeakSet(), 0))
        .filter((c): c is Record<string, unknown> => c !== undefined);
}

/**
 * Rebuild collections received from a contract endpoint.
 *
 * Relation refs become real thunks resolving through the returned set, so
 * downstream consumers — the SDK generator above all — see exactly the shape
 * they would have seen had the collections been imported from source.
 *
 * A ref naming a collection that is not in the payload resolves to `undefined`
 * rather than throwing: the generator already tolerates an unresolvable target
 * by falling back to a permissive key type, and a partial contract should still
 * produce a usable SDK.
 */
export function deserializeCollections(payload: unknown[]): CollectionConfig[] {
    const collections = payload
        .filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null)
        .map(c => ({ ...c })) as unknown as CollectionConfig[];

    const bySlug = new Map<string, CollectionConfig>();
    for (const collection of collections) {
        const ref = refFor(collection);
        if (ref) bySlug.set(ref, collection);
    }

    const rehydrate = (value: unknown, depth: number): void => {
        if (depth > MAX_DEPTH || !value || typeof value !== "object") return;

        if (Array.isArray(value)) {
            for (const item of value) rehydrate(item, depth + 1);
            return;
        }

        const record = value as Record<string, unknown>;
        for (const [key, child] of Object.entries(record)) {
            if (key === "target" && isSerializedCollectionRef(child)) {
                const slug = child.__collectionRef;
                record.target = () => bySlug.get(slug);
                continue;
            }
            rehydrate(child, depth + 1);
        }
    };

    for (const collection of collections) rehydrate(collection, 0);
    return collections;
}
