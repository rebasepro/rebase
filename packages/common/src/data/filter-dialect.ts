/**
 * REST wire-format adapter for the unified filter system.
 *
 * This module is the ONLY code in the entire codebase that knows about
 * PostgREST-style dot-syntax strings (`eq.active`, `gt.18`, `in.(a,b)`).
 * Everything else speaks `FilterValues` exclusively.
 *
 * Wire-format values are always strings — the wire format carries no type
 * metadata, so type coercion is the responsibility of the server-side data
 * driver which has access to the collection schema.
 *
 * Structural characters inside a value are backslash-escaped: `,` → `\,`,
 * `(` → `\(`, `)` → `\)`, and a literal backslash as `\\`. Decoding is
 * deliberately conservative — only those four sequences are decoded, so a
 * backslash that arrives unescaped from an older client survives intact.
 *
 * @module
 */

import {
    WhereFilterOp,
    FilterValues,
    CANONICAL_TO_REST,
    REST_TO_CANONICAL,
    RestFilterOp,
    toCanonicalOp,
    LogicalCondition,
    FilterCondition,
    NULL_OPS
} from "@rebasepro/types";
import { normalizeToEntityRelation } from "../util/entities";

// ---------------------------------------------------------------------------
// Value stringification
// ---------------------------------------------------------------------------

/**
 * Serialize a JS value to its querystring representation.
 * `null` is serialized as the literal string `"null"`.
 * Relation values (`EntityRelation` instances or `{ __type: "relation", id, path }`
 * objects) are serialized as their raw id — the wire format only carries the
 * value to compare against the FK column.
 */
function stringifyValue(value: unknown): string {
    if (value === null) return "null";
    const relation = normalizeToEntityRelation(value);
    if (relation) return String(relation.id);
    return String(value);
}

// ---------------------------------------------------------------------------
// Comma escaping for list values
// ---------------------------------------------------------------------------

/**
 * Characters that carry structure in the wire format and must therefore be
 * escaped inside a value: the separator, the group delimiters, and the escape
 * character itself.
 *
 * Parentheses are here because `and(...)`/`or(...)` groups are parsed by
 * tracking paren depth. A value containing one is not merely ambiguous, it
 * moves where the parser thinks the group ends.
 */
const WIRE_SPECIALS = /[\\,()]/g;

/**
 * Escape a value for the wire format: `\` → `\\`, `,` → `\,`, `(` → `\(`,
 * `)` → `\)`.
 */
/**
 * The wire spelling of an empty list.
 *
 * A lone backslash: unproducible by {@link escapeWireValue}, which doubles
 * every backslash it emits, so it cannot collide with any real item.
 */
const EMPTY_LIST_TOKEN = "\\";

function escapeWireValue(value: string): string {
    return value.replace(WIRE_SPECIALS, ch => `\\${ch}`);
}

/**
 * Unescape a wire-format value.
 *
 * **Conservative**, and deliberately so: only the four sequences
 * {@link escapeWireValue} actually produces are decoded. A backslash followed
 * by anything else is left exactly as it is.
 *
 * This used to consume the backslash before *any* character, which is
 * indistinguishable for anything this codec emitted — it only ever emits those
 * four — but not for input arriving from elsewhere. A client on an older
 * release sends a Windows path or a LIKE pattern with a literal `C:\x`
 * unescaped, and greedy unescaping silently turned it into `C:x`, changing
 * which rows matched. Decoding only what the encoder can produce makes the two
 * directions agree across versions.
 */
function unescapeWireValue(value: string): string {
    let result = "";
    for (let i = 0; i < value.length; i++) {
        const next = value[i + 1];
        if (value[i] === "\\" && (next === "\\" || next === "," || next === "(" || next === ")")) {
            result += next;
            i++;
            continue;
        }
        result += value[i];
    }
    return result;
}

/**
 * Split a parenthesized list string on unescaped commas.
 * Input is the content between `(` and `)`.
 *
 * @example
 * splitListItems("admin,editor")          // ["admin", "editor"]
 * splitListItems("hello\\, world,foo")    // ["hello, world", "foo"]
 */
function splitListItems(inner: string): string[] {
    const items: string[] = [];
    let current = "";
    for (let i = 0; i < inner.length; i++) {
        if (inner[i] === "\\" && i + 1 < inner.length) {
            // Escaped pair — consume both chars so the comma in `\,` is not
            // read as a separator. Kept verbatim; decoding happens once, below.
            current += inner[i] + inner[i + 1];
            i++;
        } else if (inner[i] === ",") {
            items.push(unescapeWireValue(current));
            current = "";
        } else {
            current += inner[i];
        }
    }
    items.push(unescapeWireValue(current));
    return items;
}

/**
 * Split a group body on commas at paren depth 0, honouring escapes.
 *
 * The escape-awareness is the point. The splitter used to track only paren
 * depth, so a comma inside a scalar value ended a condition:
 * `or(name.eq.Doe, John,age.gte.18)` parsed as *three* conditions, the middle
 * one a fabricated `" John" == true`. On an `or` that widens the result set,
 * and nothing anywhere reports an error — the query simply stops meaning what
 * the caller wrote.
 */
function splitGroupItems(inner: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < inner.length; i++) {
        const ch = inner[i];
        if (ch === "\\" && i + 1 < inner.length) { i++; continue; }
        if (ch === "(") depth++;
        else if (ch === ")") depth--;
        else if (ch === "," && depth === 0) {
            parts.push(inner.slice(start, i));
            start = i + 1;
        }
    }
    parts.push(inner.slice(start));
    return parts;
}

// ---------------------------------------------------------------------------
// Typed operator map lookups (no `as any`)
// ---------------------------------------------------------------------------

/**
 * Operator tables as `Map`s, because the key comes off the wire.
 *
 * Indexed as plain objects, every `Object.prototype` member answered: a query
 * string of `?f=valueOf.x` found a truthy "operator" — the inherited function —
 * and `deserializeTuple` returned it *as the operator*, so a function object
 * travelled on into the compilers in place of a `WhereFilterOp`. The guard one
 * line below (`if (!canonicalOp)`) reads as though it rejects anything unknown,
 * and does not: `Object.prototype` is not unknown to a plain object.
 *
 * Same shape as the prototype-key defects swept out of `setIn`, `getIn`,
 * `mergeDeep`, `unflattenObject` and `FOREIGN_CONVENTION_UIDS`.
 */
const REST_OP_LOOKUP = new Map<string, WhereFilterOp>(
    Object.entries(REST_TO_CANONICAL) as [string, WhereFilterOp][]
);
const CANONICAL_OP_LOOKUP = new Map<string, RestFilterOp>(
    Object.entries(CANONICAL_TO_REST) as [string, RestFilterOp][]
);

// ---------------------------------------------------------------------------
// Serialize: FilterValues → REST querystring
// ---------------------------------------------------------------------------

/**
 * Serialize a single canonical condition tuple to a PostgREST dot-string.
 *
 * Throws `TypeError` if the input is not a valid `[WhereFilterOp, unknown]` tuple.
 *
 * @example
 * serializeTuple(["==", "active"])           // "eq.active"
 * serializeTuple(["in", ["admin","editor"]]) // "in.(admin,editor)"
 * serializeTuple([">=", 18])                 // "gte.18"
 */
function serializeTuple(tuple: [WhereFilterOp, unknown]): string {
    if (!Array.isArray(tuple) || tuple.length !== 2) {
        throw new TypeError(
            `serializeTuple: expected a [WhereFilterOp, value] tuple, got ${JSON.stringify(tuple)}`
        );
    }

    const [op, value] = tuple;

    if (typeof op !== "string") {
        throw new TypeError(
            `serializeTuple: operator must be a string, got ${typeof op}`
        );
    }

    const restOp = CANONICAL_OP_LOOKUP.get(op);
    if (!restOp) {
        throw new TypeError(
            `serializeTuple: unknown operator "${op}". Valid operators: ${Object.keys(CANONICAL_TO_REST).join(", ")}`
        );
    }

    // `== null` and `!= null` go out as the null-testing operators.
    //
    // They used to serialize as `eq.null`, and `deserializeTuple` had no way to
    // tell that from a search for the four-character string "null" — so it
    // returned the string, and `.where("deleted_at", "==", null)` compiled to
    // `deleted_at = 'null'` over HTTP. The typed builder allows it, the Postgres
    // compiler implements it as IS NULL, and only the wire trip broke it.
    //
    // These are the same query: SQL `= NULL` is never true, so `== null` can
    // only mean IS NULL. Emitting it as such is unambiguous in both directions
    // and leaves `eq.null` free to mean the literal string, which it now does.
    if (value === null && (op === "==" || op === "!=")) {
        return op === "==" ? "isnull.null" : "notnull.null";
    }

    if (Array.isArray(value)) {
        // The empty list needs a spelling of its own.
        //
        // A comma-joined format has no way to write "zero items": `()` is the
        // empty string between the parens, which splits to `[""]`. So
        // `.where("id", "in", [])` — which matches nothing — used to arrive as
        // a search for the empty string: a 500 on a uuid column, silently the
        // wrong rows on a text one.
        //
        // `EMPTY_LIST_TOKEN` is a single unescaped backslash, which no real
        // value can produce: `escapeWireValue` doubles every backslash, so a
        // one-item list holding `\` serializes as `(\\)`. That keeps both
        // directions exact — `[]` and `[""]` stay distinct — rather than
        // trading one lossy reading for another.
        if (value.length === 0) return `${restOp}.(${EMPTY_LIST_TOKEN})`;
        const items = value.map(v => escapeWireValue(stringifyValue(v))).join(",");
        return `${restOp}.(${items})`;
    }

    return `${restOp}.${stringifyValue(value)}`;
}

/**
 * Convert `FilterValues` (or `WireFilterValues`) to a PostgREST-style
 * querystring record.
 *
 * - Canonical `[WhereFilterOp, value]` tuples are serialized strictly.
 * - Pre-serialized PostgREST strings (e.g. `"eq.published"`) are passed through.
 * - Single conditions produce a string value.
 * - Multiple conditions on the same field produce a string array (repeated params).
 *
 * @example
 * serializeFilter({ status: ["==", "active"] })
 * // → { status: "eq.active" }
 *
 * serializeFilter({ age: [[">=", 18], ["<", 65]] })
 * // → { age: ["gte.18", "lt.65"] }
 *
 * // Pre-serialized strings pass through unchanged:
 * serializeFilter({ status: "eq.published" })
 * // → { status: "eq.published" }
 */
export function serializeFilter(
    filter: FilterValues<string> | Record<string, unknown>
): Record<string, string | string[]> {
    const result: Record<string, string | string[]> = {};

    for (const [field, condition] of Object.entries(filter)) {
        if (condition === undefined) continue;

        // Pre-serialized PostgREST string — pass through unchanged.
        // This supports WireFilterValues where values may already be
        // serialized dot-strings like "eq.active" or raw strings like "true".
        if (typeof condition === "string") {
            result[field] = condition;
            continue;
        }

        // Multiple conditions on the same field: array of tuples
        // We detect this by checking if the first element is also an array.
        if (Array.isArray(condition) && condition.length > 0 && Array.isArray(condition[0])) {
            result[field] = (condition as [WhereFilterOp, unknown][]).map(serializeTuple);
        } else {
            // Single condition — must be a [WhereFilterOp, value] tuple
            result[field] = serializeTuple(condition as [WhereFilterOp, unknown]);
        }
    }

    return result;
}

// ---------------------------------------------------------------------------
// Deserialize: REST querystring → FilterValues
// ---------------------------------------------------------------------------

/**
 * Parse a single PostgREST dot-string into a `[WhereFilterOp, unknown]` tuple.
 *
 * All values are returned as strings — the wire format carries no type
 * metadata, so coercion is the data driver's responsibility.
 *
 * If the string doesn't match a known operator prefix, it falls back to
 * `["==", originalString]` (treating the whole string as an equality value).
 * This intentional defense handles values like `"user@host.com"` or
 * `"1.2.3"` that happen to contain dots.
 */
function deserializeSingle(raw: string): [WhereFilterOp, unknown] {
    const dotIndex = raw.indexOf(".");
    if (dotIndex === -1) {
        // No dot → equality on the raw value (kept as string)
        return ["==", raw];
    }

    const prefix = raw.substring(0, dotIndex);
    const rest = raw.substring(dotIndex + 1);

    // Check if the prefix is a known REST operator.
    // This is the key defense against values like "eq.something" or "gt.foo"
    // being misinterpreted — only known REST short-codes are treated as operators.
    const canonicalOp = REST_OP_LOOKUP.get(prefix);
    if (!canonicalOp) {
        // Not a known operator (e.g., email "user@host.com" or version "1.2.3")
        // Treat the entire string as an equality value
        return ["==", raw];
    }

    // Null-testing operators ignore their serialized value — normalize to null
    // so the tuple round-trips stably (`isnull.null` → ["is-null", null]).
    if (NULL_OPS.has(canonicalOp)) {
        return [canonicalOp, null];
    }

    // Parse list values: "(admin,editor)" → ["admin", "editor"]
    if (rest.startsWith("(") && rest.endsWith(")")) {
        const inner = rest.slice(1, -1);
        // See EMPTY_LIST_TOKEN: `(\)` is the empty list. `()` remains a list
        // holding one empty string, which is what splitting it yields anyway.
        const items = inner === EMPTY_LIST_TOKEN ? [] : splitListItems(inner);
        return [canonicalOp, items];
    }

    return [canonicalOp, rest];
}

/**
 * Convert a PostgREST-style querystring record to `FilterValues`.
 *
 * - String values are parsed as single conditions.
 * - String arrays (repeated query params) become multiple conditions on the same field.
 *
 * @example
 * deserializeFilter({ status: "eq.active" })
 * // → { status: ["==", "active"] }
 *
 * deserializeFilter({ age: ["gte.18", "lt.65"] })
 * // → { age: [[">=", "18"], ["<", "65"]] }
 */
export function deserializeFilter(
    query: Record<string, unknown>
): FilterValues<string> {
    const result: FilterValues<string> = {};

    for (const [field, raw] of Object.entries(query)) {
        if (raw === undefined) continue;

        // If it's already a canonical tuple [op, value], keep it as is
        if (Array.isArray(raw) && raw.length === 2 && typeof raw[0] === "string" && toCanonicalOp(raw[0]) === raw[0]) {
            result[field] = raw as [WhereFilterOp, unknown];
            continue;
        }

        if (Array.isArray(raw)) {
            if (raw.length === 0) continue;
            
            // Check if it's an array of canonical tuples
            if (Array.isArray(raw[0]) && raw[0].length === 2 && typeof raw[0][0] === "string" && toCanonicalOp(raw[0][0]) === raw[0][0]) {
                result[field] = raw as [WhereFilterOp, unknown][];
                continue;
            }

            if (raw.length === 1) {
                result[field] = typeof raw[0] === "string" ? deserializeSingle(raw[0]) : ["==", raw[0]];
            } else {
                // If the elements are strings, they might be PostgREST dot-strings (repeated params)
                if (typeof raw[0] === "string" && raw[0].includes(".")) {
                    result[field] = raw.map(r => typeof r === "string" ? deserializeSingle(r) : (["==", r] as [WhereFilterOp, unknown])) as [WhereFilterOp, unknown][];
                } else {
                    // Otherwise assume it's a list of values for an implicit "in" or just multiple conditions
                    result[field] = ["in", raw];
                }
            }
        } else if (typeof raw === "string") {
            result[field] = deserializeSingle(raw);
        } else {
            result[field] = ["==", raw];
        }
    }

    return result;
}

// ---------------------------------------------------------------------------
// Logical conditions: serialize / deserialize
// ---------------------------------------------------------------------------

/**
 * Serialize a `LogicalCondition` or `FilterCondition` to its wire-format string.
 *
 * @example
 * serializeLogicalCondition({ column: "status", operator: "==", value: "active" })
 * // → "status.eq.active"
 *
 * serializeLogicalCondition({ type: "or", conditions: [...] })
 * // → "or(status.eq.active,status.eq.pending)"
 */
export function serializeLogicalCondition(
    cond: LogicalCondition | FilterCondition
): string {
    if ("type" in cond) {
        // LogicalCondition (and/or)
        const inner = (cond.conditions ?? [])
            .map(serializeLogicalCondition)
            .join(",");
        return `${cond.type}(${inner})`;
    }

    // FilterCondition
    const restOp = CANONICAL_OP_LOOKUP.get(cond.operator) ?? "eq";
    if (Array.isArray(cond.value)) {
        const items = cond.value.map(v => escapeWireValue(stringifyValue(v))).join(",");
        return `${cond.column}.${restOp}.(${items})`;
    }
    // Escaped, like a list item. A scalar inside a group sits between the same
    // delimiters a list item does, so leaving it raw let a comma in the value
    // end the condition early — see `splitGroupItems`.
    return `${cond.column}.${restOp}.${escapeWireValue(stringifyValue(cond.value))}`;
}

/**
 * Parse a logical condition wire-format string back into a
 * `LogicalCondition` or `FilterCondition`.
 *
 * @example
 * deserializeLogicalCondition("status.eq.active")
 * // → { column: "status", operator: "==", value: "active" }
 *
 * deserializeLogicalCondition("or(status.eq.active,age.gte.18)")
 * // → { type: "or", conditions: [...] }
 */
/**
 * How deeply `or(...)`/`and(...)` groups may nest.
 *
 * This parser recurses once per level, on a value that arrives in a query
 * string. Unbounded, twenty thousand levels reached `RangeError: Maximum call
 * stack size exceeded`, which a caller sees as a 500 about the call stack
 * rather than a 400 about their filter. Node's 16 KB header cap keeps a GET
 * below that in practice, but "the HTTP layer happens to stop it" is not a
 * bound this parser should rely on.
 *
 * Thirty-two is far past anything a real filter expresses; the deepest in this
 * repository's own tests is three.
 */
export const MAX_LOGICAL_NESTING_DEPTH = 32;

export function deserializeLogicalCondition(
    str: string,
    // Not `depth`: the body already uses that name for paren tracking, inside a
    // block that shadows a parameter of the same name — so the recursion
    // counter silently became the paren counter and never grew.
    nesting = 0
): LogicalCondition | FilterCondition {
    if (nesting > MAX_LOGICAL_NESTING_DEPTH) {
        throw new Error(
            `Filter groups nest more than ${MAX_LOGICAL_NESTING_DEPTH} levels deep. ` +
            "Flatten the condition — `or(a,or(b,c))` is `or(a,b,c)`."
        );
    }
    // Check for logical group: "and(...)" or "or(...)"
    const logicalMatch = str.match(/^(and|or)\((.+)\)$/);
    if (logicalMatch) {
        const type = logicalMatch[1] as "and" | "or";
        const innerStr = logicalMatch[2];

        const conditions = splitGroupItems(innerStr)
            .map(part => deserializeLogicalCondition(part, nesting + 1));

        return { type, conditions };
    }

    // FilterCondition: "column.op.value"
    const firstDot = str.indexOf(".");
    if (firstDot === -1) {
        return { column: str, operator: "==", value: true };
    }

    const column = str.substring(0, firstDot);
    const rest = str.substring(firstDot + 1);

    const secondDot = rest.indexOf(".");
    if (secondDot === -1) {
        // "column.value" — treat as equality (value kept as string)
        return { column, operator: "==", value: unescapeWireValue(rest) };
    }

    const opStr = rest.substring(0, secondDot);
    const valueStr = rest.substring(secondDot + 1);
    const operator = toCanonicalOp(opStr) ?? "==";

    // Parse list values with escape-aware splitting. The wrapping parens are
    // written by the serializer *after* the items are escaped, so an escaped
    // paren inside an item can never be mistaken for them.
    if (valueStr.startsWith("(") && valueStr.endsWith(")")) {
        const items = splitListItems(valueStr.slice(1, -1));
        return { column, operator, value: items };
    }

    return { column, operator, value: unescapeWireValue(valueStr) };
}
