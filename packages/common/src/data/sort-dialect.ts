import type { OrderBySortTuple, OrderBySpec, OrderByTuple } from "@rebasepro/types";
import { isRelationAggregateSort, sortKeyToString } from "@rebasepro/types";

/**
 * Sort-order wire codec.
 *
 * This is the ONLY module that knows about the colon-delimited wire format
 * (`"field:direction"`) used in HTTP query parameters, and about the JSON-array
 * form that carries a multi-column sort over the same parameter.
 * Everything else speaks {@link OrderByTuple} exclusively.
 *
 * Mirrors the filter architecture in `filter-dialect.ts`.
 *
 * @module
 */

/**
 * Collapse the one-key and many-key spellings of a sort into the list form.
 *
 * `["a", "desc"]` and `[["a", "desc"]]` mean the same thing and normalize to
 * the same value; the two are told apart by whether the first element is
 * itself an array, which no field name ever is.
 *
 * This is also where a {@link RelationAggregateSort} object stops being an
 * object. Above this function a sort key may be either spelling; below it,
 * every key is a string — which is what `OrderByTuple`, the REST parameter, the
 * driver contract and the cursor all already were. Doing it here means the one
 * place that already collapses the two *shapes* of a sort also collapses the
 * two *spellings* of a key, rather than every consumer learning about both.
 *
 * @returns The keys in order of significance, or `undefined` for no sort. An
 *   empty list also returns `undefined` — "sort by nothing" is no sort, and
 *   letting `[]` through would have every layer below re-deciding what it meant.
 */
export function normalizeOrderBy(orderBy?: OrderBySpec): OrderByTuple[] | undefined {
    if (!orderBy || orderBy.length === 0) return undefined;
    // An aggregate key is an object, so the first element being an array still
    // tells the list form from the single-tuple one — no field name is an
    // array, and neither is an aggregate key.
    const list = Array.isArray(orderBy[0])
        ? orderBy as OrderBySortTuple[]
        : [orderBy as OrderBySortTuple];
    if (list.length === 0) return undefined;
    return list.map(([key, direction]) => [sortKeyToString(key), direction] as OrderByTuple);
}

/**
 * The most significant sort key, for a caller that can only express one —
 * a column header's arrow, a URL parameter, a driver that has not been taught
 * the list form.
 */
export function primaryOrderBy(orderBy?: OrderBySpec): OrderByTuple | undefined {
    return normalizeOrderBy(orderBy)?.[0];
}

/**
 * Collapse the driver-level `{orderBy, order}` pair into the list form.
 *
 * The driver contract spells a single-column sort as a field name plus a
 * separate direction, and a multi-column one as a list of tuples that leaves
 * `order` meaningless. Every driver reads both through here so neither
 * spelling has to be handled twice.
 *
 * An absent direction means ascending — the same thing a bare `?orderBy=name`
 * has always meant over HTTP. The Postgres driver used to read the same pair as
 * *descending* while Mongo read it as ascending, so one field name and no
 * direction described two different queries depending on which database was
 * underneath. Neither had a caller: every path in the workspace passes a
 * direction, which is why the disagreement went unnoticed rather than being
 * load-bearing.
 */
export function normalizeDriverOrderBy(
    orderBy?: string | OrderByTuple[],
    order?: "asc" | "desc"
): OrderByTuple[] | undefined {
    if (!orderBy) return undefined;
    if (typeof orderBy === "string") return [[orderBy, order === "desc" ? "desc" : "asc"]];
    return orderBy.length > 0 ? orderBy : undefined;
}

/** A sort whose *shape* is unusable, as opposed to one naming a field that does not exist. */
export class OrderBySpecError extends Error {
    readonly code = "INVALID_ORDER_BY";
    constructor(detail: string) {
        super(
            `Invalid \`orderBy\`: ${detail}. Expected a field name, or a list of ` +
            "[field, direction] pairs like [[\"roles\",\"asc\"],[\"created_at\",\"desc\"]]"
        );
        this.name = "OrderBySpecError";
    }
}

/**
 * Validate an `orderBy` that arrived from outside this process — a WebSocket
 * subscribe frame, a driver call from untyped JavaScript — and return it in the
 * list form.
 *
 * Strict on purpose, in the same way the REST `parseOrderByParam` is: the
 * failure mode for a shape nobody checks is not a crash but a *silently
 * different query*. A malformed entry read as a field name resolves to no
 * column, and under the lenient unknown-field mode the sort is then dropped and
 * the rows come back in whatever order the database pleased — sorted, as far as
 * the subscriber can tell, by whatever they asked for.
 */
export function parseOrderBySpecStrict(raw: unknown, order?: "asc" | "desc"): OrderByTuple[] | undefined {
    if (raw === undefined || raw === null || raw === "") return undefined;
    // The string spelling is the driver contract's, so it takes its direction
    // from the same companion `order` — and defaults the same way it does.
    if (typeof raw === "string") return normalizeDriverOrderBy(raw, order);
    if (!Array.isArray(raw) || raw.length === 0) {
        throw new OrderBySpecError(`${typeof raw} is not a field name or a list of sort keys`);
    }

    // The single-tuple spelling, `["created_at", "desc"]` — or the same shape
    // with an aggregate key in place of the field name.
    if (typeof raw[0] === "string" || isRelationAggregateSort(raw[0])) return [toStrictTuple(raw, 0)];

    return raw.map(toStrictTuple);
}

function toStrictTuple(raw: unknown, index: number): OrderByTuple {
    if (!Array.isArray(raw)) {
        throw new OrderBySpecError(`entry ${index} has no field name`);
    }
    // The object spelling of an aggregate key, from an untyped caller that did
    // not go through `normalizeOrderBy`. Encoded rather than refused: it is a
    // sort this understands, and rejecting the shape a typed caller writes
    // would be a distinction between the two spellings that nothing else makes.
    const key = isRelationAggregateSort(raw[0]) ? sortKeyToString(raw[0]) : raw[0];
    if (typeof key !== "string" || key.trim() === "") {
        throw new OrderBySpecError(`entry ${index} has no field name`);
    }
    const direction = raw[1];
    if (direction !== undefined && direction !== "asc" && direction !== "desc") {
        throw new OrderBySpecError(`entry ${index} has direction '${String(direction)}'`);
    }
    return [key, direction ?? "asc"];
}

/**
 * Serialize a sort to the wire.
 *
 * A single key keeps the `"field:direction"` shorthand it has always used —
 * short, readable in a URL, and what every existing client and test expects.
 * Several keys are emitted as the canonical JSON array the server already
 * accepts, because the shorthand has no separator to spare: a comma-joined
 * `"a:asc,b:desc"` parses as one field named `a` with the direction
 * `"asc,b:desc"`, which the server refuses.
 *
 * **Runtime tolerance:** if the input is already a well-formed wire string
 * (from an untyped JS caller), it is returned unchanged.
 * This is undocumented tolerance, not public API — don't rely on it.
 *
 * @param orderBy - A canonical tuple or list of tuples, or at runtime
 *   possibly a pre-serialized string (undocumented tolerance).
 * @returns The wire-format string, or `undefined` if the input is falsy.
 *
 * @remarks
 * Field names containing `:` are representable in the tuple form but
 * **not** in the single-key wire encoding — this is an inherent limitation of
 * the colon-delimited shorthand and is not resolved here.
 */
export function serializeOrderBy(orderBy?: OrderBySpec | string): string | undefined {
    if (!orderBy) return undefined;
    // Runtime tolerance: pass through a pre-serialized wire string unchanged.
    if (typeof orderBy === "string") return orderBy;
    // `normalizeOrderBy` has already encoded any aggregate key to its string
    // spelling, which is why the shorthand below can assume a string: neither
    // `min(applications.created_at)` nor `count(applications)` contains a `:`.
    const list = normalizeOrderBy(orderBy);
    if (!list) return undefined;
    if (list.length === 1) return `${list[0][0]}:${list[0][1]}`;
    return JSON.stringify(list.map(([field, direction]) => ({ field,
direction })));
}

/**
 * Deserialize a wire-format `"field:direction"` string into an {@link OrderByTuple}.
 *
 * Lenient parsing (matches existing server behaviour):
 * - Bare field name (no colon): `"name"` → `["name", "asc"]`
 * - Unknown direction: `"name:foo"` → `["name", "asc"]`
 * - Empty / falsy input: → `undefined`
 *
 * Reads the single-key shorthand only. For a value that may carry several keys,
 * use {@link deserializeOrderByList} — handed a JSON array this returns the
 * whole array as one nonsensical field name.
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

/**
 * Deserialize either wire spelling — the single-key shorthand or the JSON
 * array — into the list form.
 *
 * Lenient in the same way {@link deserializeOrderBy} is: this is the client end
 * of the codec, where the value was produced by {@link serializeOrderBy} a
 * moment earlier. The *server* end parses the same shapes strictly, in
 * `parseOrderByParam`, because there the value came from a stranger and a
 * direction it cannot read has to be refused rather than quietly turned into
 * `"asc"`.
 */
export function deserializeOrderByList(raw?: string): OrderByTuple[] | undefined {
    if (!raw) return undefined;
    const trimmed = raw.trim();
    if (trimmed.startsWith("[")) {
        try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) {
                const list = parsed
                    .map((entry): OrderByTuple | undefined => {
                        if (typeof entry === "string") return deserializeOrderBy(entry);
                        if (entry && typeof entry === "object" && typeof entry.field === "string") {
                            return [entry.field, entry.direction === "desc" ? "desc" : "asc"];
                        }
                        return undefined;
                    })
                    .filter((entry): entry is OrderByTuple => entry !== undefined);
                return list.length > 0 ? list : undefined;
            }
        } catch {
            // Not JSON after all — fall through to the shorthand, which is what
            // a field name that merely begins with "[" would be.
        }
    }
    const single = deserializeOrderBy(trimmed);
    return single ? [single] : undefined;
}
