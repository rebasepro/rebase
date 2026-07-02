import type { OrderByTuple } from "@rebasepro/types";

/**
 * Sort-order wire codec.
 *
 * This is the ONLY module that knows about the colon-delimited wire format
 * (`"field:direction"`) used in HTTP query parameters.
 * Everything else speaks {@link OrderByTuple} exclusively.
 *
 * Mirrors the filter architecture in `filter-dialect.ts`.
 *
 * @module
 */

/**
 * Serialize an {@link OrderByTuple} to the wire format `"field:direction"`.
 *
 * **Runtime tolerance:** if the input is already a well-formed wire string
 * (from an untyped JS caller), it is returned unchanged.
 * This is undocumented tolerance, not public API — don't rely on it.
 *
 * @param orderBy - A canonical `[field, direction]` tuple, or at runtime
 *   possibly a pre-serialized string (undocumented tolerance).
 * @returns The wire-format string, or `undefined` if the input is falsy.
 *
 * @remarks
 * Field names containing `:` are representable in the tuple form but
 * **not** on the wire — this is an inherent limitation of the colon-delimited
 * encoding and is not resolved here.
 */
export function serializeOrderBy(orderBy?: OrderByTuple | string): string | undefined {
    if (!orderBy) return undefined;
    // Runtime tolerance: pass through a pre-serialized wire string unchanged.
    if (typeof orderBy === "string") return orderBy;
    return `${orderBy[0]}:${orderBy[1]}`;
}

/**
 * Deserialize a wire-format `"field:direction"` string into an {@link OrderByTuple}.
 *
 * Lenient parsing (matches existing server behaviour):
 * - Bare field name (no colon): `"name"` → `["name", "asc"]`
 * - Unknown direction: `"name:foo"` → `["name", "asc"]`
 * - Empty / falsy input: → `undefined`
 *
 * @param raw - The wire-format string from an HTTP query parameter.
 * @returns The canonical tuple, or `undefined` if the input is empty/falsy.
 */
export function deserializeOrderBy(raw?: string): OrderByTuple | undefined {
    if (!raw) return undefined;
    const idx = raw.indexOf(":");
    if (idx === -1) return [raw, "asc"];
    const field = raw.slice(0, idx);
    const dir = raw.slice(idx + 1);
    return [field, dir === "desc" ? "desc" : "asc"];
}
