import type { OrderByTuple } from "@rebasepro/types";

/**
 * The keyset-cursor wire codec.
 *
 * ## Why this is one module
 *
 * Keyset pagination was implemented three times and reachable once. The driver
 * has a NULL-correct multi-key comparison (`FetchService.buildKeysetComparison`)
 * that only a WebSocket `startAfter` could reach; REST could not seek at all;
 * and the SDK's `iterate({cursor})` re-implemented a *single*-column keyset as a
 * `where` clause, which threw on any multi-key sort and silently dropped rows
 * whose sort value was NULL. Three implementations, three answers to "what is
 * page two".
 *
 * There is now one. The driver's comparison is the implementation; this module
 * is the only thing that says how a cursor is written down, and every transport
 * — the REST `?after=`, the WebSocket `startAfter`, the SDK's `iterate()` —
 * carries the string this produces and hands it back unread.
 *
 * ## What a cursor holds
 *
 * The sort keys the query was ordered by, the last served row's value for each
 * of them, and that row's id. The keys travel *with* the values because a
 * cursor that carried only values would be silently reinterpretable: paging a
 * `created_at DESC` listing and then asking for `title ASC` would seek on the
 * dates as though they were titles. Carrying the keys makes that a refusal
 * ({@link CursorMismatchError}) rather than a page of arbitrary rows.
 *
 * ## Opacity
 *
 * The encoding is base64url of JSON, and it is **not** API. It is opaque so it
 * can change — adding a key, changing how a value is tagged — without every
 * client that learned to read it breaking. Nothing outside this file parses it.
 *
 * @module
 */

/** The decoded contents of a cursor. */
export interface DecodedCursor {
    /** The sort keys the cursor was produced under, in order of significance. */
    orderBy: OrderByTuple[];
    /** The last served row's value for each sort key, by field name. */
    values: Record<string, unknown>;
    /** The last served row's id, which breaks ties on the last key. */
    id: unknown;
}

/** A cursor that cannot be read at all — truncated, re-encoded, or invented. */
export class CursorError extends Error {
    readonly code = "INVALID_CURSOR";
    constructor(detail: string) {
        super(
            `Invalid \`after\` cursor: ${detail}. Pass back the \`meta.nextCursor\` ` +
            "from the previous page unchanged — it is opaque and must not be built by hand."
        );
        this.name = "CursorError";
        Object.setPrototypeOf(this, CursorError.prototype);
    }
}

/**
 * A cursor that reads fine but describes a different query.
 *
 * Separate from {@link CursorError} because the fix is different: this one is
 * not a corrupt string, it is a correct cursor used against a sort it was not
 * produced under. Seeking anyway would return rows in an order nobody asked
 * for, and — worse — would look like it worked.
 */
export class CursorMismatchError extends Error {
    readonly code = "CURSOR_ORDER_MISMATCH";
    constructor(cursorKeys: string[], queryKeys: string[]) {
        super(
            `The \`after\` cursor was produced by a query ordered by ` +
            `${cursorKeys.map(k => `"${k}"`).join(", ") || "(nothing)"}, but this query orders by ` +
            `${queryKeys.map(k => `"${k}"`).join(", ") || "(nothing)"}. A cursor only continues the ` +
            "listing it came from — keep `orderBy` identical across pages, or drop `after` to start over."
        );
        this.name = "CursorMismatchError";
        Object.setPrototypeOf(this, CursorMismatchError.prototype);
    }
}

/**
 * Tag for a value whose JSON round-trip would otherwise lose its type.
 *
 * A `timestamp` column comes back from the driver as a `Date`; JSON turns it
 * into a string, and the string would then be compared against the column by
 * whatever cast Postgres chose. Round-tripping it as a `Date` keeps the
 * comparison the one the ORDER BY made.
 */
const DATE_TAG = "$date";

function encodeValue(value: unknown): unknown {
    if (value instanceof Date) return { [DATE_TAG]: value.toISOString() };
    return value;
}

function decodeValue(value: unknown): unknown {
    if (value && typeof value === "object" && !Array.isArray(value)) {
        const tagged = (value as Record<string, unknown>)[DATE_TAG];
        if (typeof tagged === "string") {
            const date = new Date(tagged);
            return Number.isNaN(date.getTime()) ? tagged : date;
        }
    }
    return value;
}

/** base64url, without depending on Node's Buffer (this package runs in browsers). */
function toBase64Url(text: string): string {
    const bytes = new TextEncoder().encode(text);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(encoded: string): string {
    const padded = encoded.replace(/-/g, "+").replace(/_/g, "/")
        + "=".repeat((4 - (encoded.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
}

/**
 * Encode "everything strictly after this row, in this order".
 *
 * @param orderBy the sort keys the listing ran under, in order of significance
 * @param row     the last row served, which the next page picks up after
 * @param id      that row's id — the tiebreaker every keyset comparison ends on
 * @returns the opaque cursor, or `undefined` when no cursor can describe the
 *   page. That is not a failure: a listing sorted by relevance has no stored
 *   value to compare a later page against (scores are computed per query and
 *   are not on the same scale between two of them), so it pages by offset and
 *   `meta.nextCursor` is simply absent.
 */
export function encodeCursor(
    orderBy: OrderByTuple[] | undefined,
    row: Record<string, unknown>,
    id: unknown
): string | undefined {
    if (id === undefined || id === null) return undefined;
    const keys = orderBy ?? [];
    // A key whose value is not on the row cannot be seeked past. Rather than
    // emit a cursor that the next request would refuse, emit none — the caller
    // falls back to offset paging, which is what it did before cursors existed.
    const values: Record<string, unknown> = {};
    for (const [field] of keys) {
        if (!(field in row)) return undefined;
        values[field] = encodeValue(row[field]);
    }
    return toBase64Url(JSON.stringify({ k: keys, v: values, i: encodeValue(id) }));
}

/**
 * Read a cursor produced by {@link encodeCursor}.
 *
 * @throws {CursorError} when the string is not a cursor this codec wrote.
 */
export function decodeCursor(raw: string): DecodedCursor {
    let parsed: unknown;
    try {
        parsed = JSON.parse(fromBase64Url(raw.trim()));
    } catch {
        throw new CursorError("it is not a cursor this API issued");
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new CursorError("it does not decode to a cursor");
    }
    const body = parsed as { k?: unknown; v?: unknown; i?: unknown };
    if (!Array.isArray(body.k)) throw new CursorError("it carries no sort keys");
    if (body.i === undefined) throw new CursorError("it carries no row id");

    const orderBy: OrderByTuple[] = [];
    for (const entry of body.k) {
        if (!Array.isArray(entry) || typeof entry[0] !== "string") {
            throw new CursorError("one of its sort keys is malformed");
        }
        const direction = entry[1] === "desc" ? "desc" : "asc";
        orderBy.push(entry[2] === "first" || entry[2] === "last"
            ? [entry[0], direction, entry[2]]
            : [entry[0], direction]);
    }

    const rawValues = (body.v && typeof body.v === "object" && !Array.isArray(body.v))
        ? body.v as Record<string, unknown>
        : {};
    const values: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(rawValues)) values[field] = decodeValue(value);

    return { orderBy, values, id: decodeValue(body.i) };
}

/**
 * The `orderBy` a request should run under, given a cursor and whatever sort
 * the request itself named.
 *
 * A request that names no sort **adopts the cursor's** — that is what makes
 * `find({ after })` work without restating the `orderBy` from the previous
 * call, and it cannot be wrong, since the cursor is the only sort in play.
 * A request that names one must name the *same* one, key for key, direction for
 * direction, nulls for nulls; anything else is {@link CursorMismatchError}.
 *
 * @throws {CursorMismatchError}
 */
export function reconcileCursorOrder(
    cursor: DecodedCursor,
    requested: OrderByTuple[] | undefined
): OrderByTuple[] {
    if (!requested || requested.length === 0) return cursor.orderBy;
    const spell = (keys: OrderByTuple[]) =>
        keys.map(([field, direction, nulls]) => `${field}:${direction}${nulls ? `:${nulls}` : ""}`);
    const cursorKeys = spell(cursor.orderBy);
    const queryKeys = spell(requested);
    if (cursorKeys.length !== queryKeys.length
        || cursorKeys.some((key, i) => key !== queryKeys[i])) {
        throw new CursorMismatchError(cursorKeys, queryKeys);
    }
    return requested;
}

/**
 * The `startAfter` shape the driver contract takes, built from a cursor.
 *
 * The driver has always accepted `{ id, values }`; this is the one place that
 * shape is produced, so the REST route and the WebSocket ingress cannot drift
 * into two spellings of the same seek.
 */
export function cursorToStartAfter(cursor: DecodedCursor): Record<string, unknown> {
    return { id: cursor.id, values: cursor.values };
}
