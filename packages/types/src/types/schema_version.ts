import type { TableDescriptor } from "../schema/descriptor";

/**
 * The schema version stamp.
 *
 * One function, used in three places that must agree or the whole drift-detection
 * story is noise: `rebase build` writes it into a bundle manifest, the runtime
 * serves it from the contract endpoint and stamps it into the database it
 * provisions, and a generated SDK records the value it was built from. If any
 * two of those computed it differently, every client would look permanently out
 * of date.
 *
 * It covers **tables only** — their compiled descriptors — so editing a hook's
 * code or a server function never invalidates every SDK in every repository.
 * That is a deliberate narrowing, not an oversight.
 *
 * Versions are prefixed `v2:` (descriptors, since 0.31); `v1:` versions were
 * computed from collections — see {@link LEGACY_SCHEMA_VERSION_PREFIX}.
 */

/** Stable stringify: object keys sorted at every level, so key order cannot alter the hash. */
function canonicalize(value: unknown): string {
    if (value === null || typeof value !== "object") {
        return JSON.stringify(value) ?? "null";
    }
    if (Array.isArray(value)) {
        return `[${value.map(canonicalize).join(",")}]`;
    }
    const entries = Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(",")}}`;
}

/**
 * The prefix of a version computed before 0.31, from collections.
 *
 * A database stamped with one was provisioned under the collection model. Its
 * version can never equal a descriptor version, so the first boot of a 0.31
 * runtime against it reports a mismatch once — and says why, and how to
 * restamp.
 */
export const LEGACY_SCHEMA_VERSION_PREFIX = "v1:";

/**
 * Compute the canonical string a schema version hashes: the tables'
 * descriptors, ordered by slug, every object's keys sorted.
 *
 * A descriptor is the compiled table — every default applied, every name
 * derived, `rls` resolved against `defaultRls` — so the same source compiles to
 * the same descriptor before or after anything loads it, and a build-time
 * stamp can match the server that serves it. It is plain JSON by
 * construction: hooks appear only as presence flags (`hooks.afterRead: true`),
 * so editing what a hook does never moves the version, while adding or
 * removing one does.
 *
 * Ordered by slug, so the order the tables were exported in cannot alter it.
 *
 * Exposed separately so the hashing itself can differ by environment: Node has
 * `crypto`, and callers without it can still compare canonical forms directly.
 */
export function canonicalSchemaPayload(tables: readonly TableDescriptor[]): string {
    const ordered = [...tables].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
    return canonicalize(ordered);
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
export function computeSchemaVersion(tables: readonly TableDescriptor[]): string {
    const payload = canonicalSchemaPayload(tables);

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
    return `v2:${hex(h1)}${hex(h2)}`;
}
