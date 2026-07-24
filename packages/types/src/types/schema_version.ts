import type { CollectionConfig } from "./collections";
import { serializeCollections } from "./collection_contract";

/**
 * The schema version stamp.
 *
 * One function, used in three places that must agree or the whole drift-detection
 * story is noise: `rebase build` writes it into a bundle manifest, the runtime
 * serves it from the contract endpoint, and a generated SDK records the value it
 * was built from. If any two of those computed it differently, every client would
 * look permanently out of date.
 *
 * It covers **collections only** — the client's contract is the shape of the
 * data, so editing a hook or a server function must not invalidate every SDK in
 * every repository. That is a deliberate narrowing, not an oversight.
 */

/** Stable stringify: object keys sorted at every level, so key order cannot alter the hash. */
function canonicalize(value: unknown): string {
    if (value === null || typeof value !== "object") {
        return JSON.stringify(value) ?? "null";
    }
    if (Array.isArray(value)) {
        return `[${value.map(canonicalize).join(",")}]`;
    }
    const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(",")}}`;
}

/**
 * Reduce a collection to the parts a generated client is actually built from.
 *
 * The version answers one question — "is this SDK stale?" — so it must change
 * exactly when the generated types could change, and never otherwise. Hashing a
 * whole collection fails both halves of that:
 *
 * - Security rules, callbacks, icons, groups and UI settings do not appear in a
 *   generated client, so including them reports perfectly current SDKs as stale.
 * - Worse, they are not stable *inputs*. The runtime applies default security
 *   rules when it loads collections, so the same source hashed before and after
 *   loading produced two different answers — a build-time stamp that could never
 *   match the server that served it.
 *
 * Codegen reads the slug (for the `Database` key and type names), the properties,
 * and the relations. That is the projection.
 */
function projectForCodegen(collection: CollectionConfig): Record<string, unknown> {
    const source = collection as CollectionConfig & {
        relations?: unknown;
        subcollections?: CollectionConfig[];
        path?: string;
    };

    return {
        slug: collection.slug ?? source.path,
        properties: collection.properties,
        relations: source.relations,
        subcollections: source.subcollections?.map(projectForCodegen)
    };
}

/**
 * Compute the canonical string a schema version hashes.
 *
 * Exposed separately so the hashing itself can differ by environment: Node has
 * `crypto`, and callers without it can still compare canonical forms directly.
 */
export function canonicalSchemaPayload(collections: CollectionConfig[]): string {
    const projected = serializeCollections(collections)
        .map(collection => projectForCodegen(collection as CollectionConfig));
    return canonicalize(projected);
}

/**
 * A short, non-cryptographic digest of the canonical payload.
 *
 * FNV-1a style, 64 bits, as two 32-bit halves. This is an identity, not a
 * security boundary: nothing trusts a schema version to prove anything, it only
 * answers "is this the same schema as before". A hand-rolled hash keeps this
 * module free of `node:crypto`, so the identical function runs in the browser,
 * in the CLI, and in the runtime — which is the property that actually matters.
 */
export function computeSchemaVersion(collections: CollectionConfig[]): string {
    const payload = canonicalSchemaPayload(collections);

    let h1 = 0x811c9dc5;
    let h2 = 0x01000193;

    for (let i = 0; i < payload.length; i++) {
        const code = payload.charCodeAt(i);
        h1 ^= code;
        // Multiply by the FNV prime using shifts to stay in 32-bit integer math.
        h1 = (h1 + ((h1 << 1) + (h1 << 4) + (h1 << 7) + (h1 << 8) + (h1 << 24))) >>> 0;
        h2 ^= code + i;
        h2 = (h2 + ((h2 << 1) + (h2 << 5) + (h2 << 9) + (h2 << 15) + (h2 << 24))) >>> 0;
    }

    const hex = (n: number): string => n.toString(16).padStart(8, "0");
    return `v1:${hex(h1)}${hex(h2)}`;
}
