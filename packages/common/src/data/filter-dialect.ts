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
 * Commas inside list values are backslash-escaped (`\,`), and literal
 * backslashes are escaped as `\\`.
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
 * Escape a single list item for the wire format.
 * `\` → `\\`, `,` → `\,`
 */
function escapeListItem(value: string): string {
    return value.replace(/\\/g, "\\\\").replace(/,/g, "\\,");
}

/**
 * Unescape a single list item from the wire format.
 * `\\` → `\`, `\,` → `,`
 */
function unescapeListItem(value: string): string {
    let result = "";
    for (let i = 0; i < value.length; i++) {
        if (value[i] === "\\" && i + 1 < value.length) {
            result += value[i + 1];
            i++; // skip next char
        } else {
            result += value[i];
        }
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
            // Escaped character — consume both chars
            current += inner[i] + inner[i + 1];
            i++;
        } else if (inner[i] === ",") {
            items.push(unescapeListItem(current));
            current = "";
        } else {
            current += inner[i];
        }
    }
    items.push(unescapeListItem(current));
    return items;
}

// ---------------------------------------------------------------------------
// Typed operator map lookups (no `as any`)
// ---------------------------------------------------------------------------

const REST_OP_LOOKUP = REST_TO_CANONICAL as Readonly<Record<string, WhereFilterOp | undefined>>;
const CANONICAL_OP_LOOKUP = CANONICAL_TO_REST as Readonly<Record<string, RestFilterOp | undefined>>;

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

    const restOp = CANONICAL_OP_LOOKUP[op];
    if (!restOp) {
        throw new TypeError(
            `serializeTuple: unknown operator "${op}". Valid operators: ${Object.keys(CANONICAL_TO_REST).join(", ")}`
        );
    }

    if (Array.isArray(value)) {
        const items = value.map(v => escapeListItem(stringifyValue(v))).join(",");
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
    const canonicalOp = REST_OP_LOOKUP[prefix];
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
        const items = splitListItems(rest.slice(1, -1));
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
    const restOp = CANONICAL_OP_LOOKUP[cond.operator] ?? "eq";
    if (Array.isArray(cond.value)) {
        const items = cond.value.map(v => escapeListItem(stringifyValue(v))).join(",");
        return `${cond.column}.${restOp}.(${items})`;
    }
    return `${cond.column}.${restOp}.${stringifyValue(cond.value)}`;
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

        // Split on commas that are not inside parentheses
        const conditions: (LogicalCondition | FilterCondition)[] = [];
        let depth = 0;
        let start = 0;
        for (let i = 0; i < innerStr.length; i++) {
            if (innerStr[i] === "(") depth++;
            else if (innerStr[i] === ")") depth--;
            else if (innerStr[i] === "," && depth === 0) {
                conditions.push(deserializeLogicalCondition(innerStr.slice(start, i), nesting + 1));
                start = i + 1;
            }
        }
        conditions.push(deserializeLogicalCondition(innerStr.slice(start), nesting + 1));

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
        return { column, operator: "==", value: rest };
    }

    const opStr = rest.substring(0, secondDot);
    const valueStr = rest.substring(secondDot + 1);
    const operator = toCanonicalOp(opStr) ?? "==";

    // Parse list values with escape-aware splitting
    if (valueStr.startsWith("(") && valueStr.endsWith(")")) {
        const items = splitListItems(valueStr.slice(1, -1));
        return { column, operator, value: items };
    }

    return { column, operator, value: valueStr };
}
