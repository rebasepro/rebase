import { CollectionConfig, Property } from "@rebasepro/types";
import { ApiError } from "../errors";
import { sha256Hex } from "../../utils/portable-crypto";

/**
 * Optimistic concurrency for the row routes: an edit that names the version it
 * was made against, and is refused when that version has moved on.
 *
 * Without it every `PATCH` is last-writer-wins over whatever it did not send.
 * That is fine for a single field typed into a form; it is wrong for the shape
 * the admin, the CMS and every SDK caller actually produce — read the row,
 * change part of it, send the merge back. Two editors doing that a second apart
 * both succeed, and the first one's change is gone with no error anywhere.
 *
 * The mechanism is HTTP's own: `GET` hands back an `ETag`, and a later write
 * sends it as `If-Match`. A mismatch is `412 Precondition Failed`, which says
 * "re-read and try again" — a thing a client can act on, unlike silence.
 *
 * @module
 */

/** The response/request header names, spelled once. */
export const ETAG_HEADER = "ETag";
export const IF_MATCH_HEADER = "If-Match";

/**
 * The property whose value is the row's version, when the collection has one.
 *
 * A `date` property with `autoValue: "on_update"` is stamped by the database on
 * every write, so it already *is* a version — deriving the tag from it means
 * the tag changes when and only when the row does, and two backends serving the
 * same table agree on it. The alternative below (hashing the row) is correct
 * but coarser: it changes when the *serialisation* changes, which includes
 * columns a caller cannot see and excludes nothing.
 *
 * The first such property in declaration order, so a collection with two of
 * them picks deterministically rather than by object-key luck.
 */
export function versionProperty(collection: CollectionConfig | undefined): string | undefined {
    const properties = (collection?.properties ?? {}) as Record<string, Property>;
    for (const [key, property] of Object.entries(properties)) {
        if (property?.type === "date" && (property as { autoValue?: string }).autoValue === "on_update") {
            return key;
        }
    }
    return undefined;
}

/**
 * A stable rendering of a row, so one row always hashes to one tag.
 *
 * `JSON.stringify` preserves insertion order, and a row's key order is whatever
 * the driver's `SELECT` happened to produce — which differs between the
 * include-aware read path and the plain one. Sorting is what stops the same row
 * fetched two ways from carrying two different tags, which would make every
 * `If-Match` a coin toss.
 */
function stableStringify(value: unknown): string {
    if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
    if (value instanceof Date) return JSON.stringify(value.toISOString());
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
    const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

/**
 * The entity tag for a row: quoted, per RFC 9110, and strong.
 *
 * Strong rather than weak (`W/"…"`) because it is derived from the stored
 * values themselves, not from a rendering of them — two responses with this tag
 * describe the same row, byte differences in transport encoding aside. `If-Match`
 * is defined to use strong comparison, so a weak tag would be refused by a
 * conditional write in every conforming intermediary.
 */
export async function rowETag(
    row: Record<string, unknown> | undefined,
    collection: CollectionConfig | undefined
): Promise<string | undefined> {
    if (!row) return undefined;
    const versionKey = versionProperty(collection);
    const version = versionKey !== undefined ? row[versionKey] : undefined;
    // A collection that stamps `on_update` but has not been written since the
    // column was added has a NULL there, and hashing `null` for every such row
    // would hand them all one tag — so the fallback is taken per row, not per
    // collection.
    const source = version !== undefined && version !== null
        ? `v:${version instanceof Date ? version.toISOString() : String(version)}`
        : `r:${stableStringify(row)}`;
    return `"${await sha256Hex(source)}"`;
}

/**
 * Split an `If-Match` header into the tags it lists.
 *
 * The header is a comma-separated list and `*` is a wildcard meaning "any
 * current version", which is how a client says "the row must exist" without
 * having read it.
 */
function parseIfMatch(header: string): { wildcard: boolean; tags: string[] } {
    const raw = header.trim();
    if (raw === "*") return { wildcard: true, tags: [] };
    return {
        wildcard: false,
        tags: raw
            .split(",")
            .map((part) => part.trim())
            // A weak tag never matches under strong comparison, but stripping
            // the marker rather than failing outright is the friendlier read of
            // a client that copied the prefix off a `Cache-Control` example.
            .map((part) => (part.startsWith("W/") ? part.slice(2) : part))
            .filter(Boolean)
    };
}

/**
 * Refuse the write when the row has moved on since the caller read it.
 *
 * No header means no precondition — the write proceeds, which keeps every
 * existing client working and makes concurrency control something a caller
 * opts into per request rather than a mode the server is in.
 */
export async function assertIfMatch(
    ifMatch: string | undefined,
    row: Record<string, unknown> | undefined,
    collection: CollectionConfig | undefined,
    context: { collection: string; id: string }
): Promise<void> {
    if (!ifMatch) return;
    const { wildcard, tags } = parseIfMatch(ifMatch);
    // The row was read before this ran; a caller reaching here with no row is a
    // 404 the route has already raised.
    if (wildcard) return;

    const current = await rowETag(row, collection);
    if (current && tags.includes(current)) return;

    throw new ApiError(
        412,
        "PRECONDITION_FAILED",
        `The row '${context.id}' in '${context.collection}' has changed since it was read. ` +
        "Re-read it, re-apply the change, and send the new ETag.",
        { collection: context.collection, id: context.id, expected: tags, current }
    );
}
