/**
 * REST wire-format adapter for the unified filter system.
 *
 * This module is the ONLY code in the entire codebase that knows about
 * PostgREST-style dot-syntax strings (`eq.active`, `gt.18`, `in.(a,b)`).
 * Everything else speaks `FilterValues` exclusively.
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
    FilterCondition
} from "@rebasepro/types";

// ---------------------------------------------------------------------------
// Value coercion (querystring → typed JS values)
// ---------------------------------------------------------------------------

/**
 * Coerce a raw querystring value to its natural JS type.
 * - `"true"` / `"false"` → boolean
 * - `"null"` → null
 * - Numeric strings → number
 * - Everything else → string (unchanged)
 */
function coerceValue(raw: string): unknown {
    if (raw === "true") return true;
    if (raw === "false") return false;
    if (raw === "null") return null;
    if (raw !== "" && !isNaN(Number(raw))) return Number(raw);
    return raw;
}

/**
 * Serialize a JS value to its querystring representation.
 */
function stringifyValue(value: unknown): string {
    if (value === null) return "null";
    if (typeof value === "boolean") return String(value);
    return String(value);
}

// ---------------------------------------------------------------------------
// Serialize: FilterValues → REST querystring
// ---------------------------------------------------------------------------

/**
 * Serialize a single condition tuple to a PostgREST dot-string.
 *
 * @example
 * serializeTuple(["==", "active"])           // "eq.active"
 * serializeTuple(["in", ["admin","editor"]]) // "in.(admin,editor)"
 * serializeTuple([">=", 18])                 // "gte.18"
 */
function serializeTuple(tuple: [WhereFilterOp, unknown]): string {
    const [op, value] = tuple;
    const restOp = CANONICAL_TO_REST[op];

    if (Array.isArray(value)) {
        const items = value.map(stringifyValue).join(",");
        return `${restOp}.(${items})`;
    }

    return `${restOp}.${stringifyValue(value)}`;
}

/**
 * Convert `FilterValues` to a PostgREST-style querystring record.
 *
 * - Single conditions produce a string value.
 * - Multiple conditions on the same field produce a string array (repeated params).
 *
 * @example
 * serializeFilter({ status: ["==", "active"] })
 * // → { status: "eq.active" }
 *
 * serializeFilter({ age: [[">=", 18], ["<", 65]] })
 * // → { age: ["gte.18", "lt.65"] }
 */
export function serializeFilter(
    filter: FilterValues<string>
): Record<string, string | string[]> {
    const result: Record<string, string | string[]> = {};

    for (const [field, condition] of Object.entries(filter)) {
        if (condition === undefined) continue;

        // Multiple conditions on the same field: array of tuples
        if (Array.isArray(condition[0]) && Array.isArray(condition)) {
            const tuples = condition as [WhereFilterOp, unknown][];
            result[field] = tuples.map(serializeTuple);
        } else {
            // Single condition
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
 * If the string doesn't match a known operator prefix, falls back to
 * `["==", originalString]` (treating the whole string as an equality value).
 */
function deserializeSingle(raw: string): [WhereFilterOp, unknown] {
    const dotIndex = raw.indexOf(".");
    if (dotIndex === -1) {
        // No dot → equality on the raw value (coerced)
        return ["==", coerceValue(raw)];
    }

    const prefix = raw.substring(0, dotIndex);
    const rest = raw.substring(dotIndex + 1);

    // Check if the prefix is a known REST operator
    const canonicalOp = (REST_TO_CANONICAL as Record<string, WhereFilterOp | undefined>)[prefix];
    if (!canonicalOp) {
        // Not a known operator (e.g., email "user@host.com" or version "1.2.3")
        // Treat the entire string as an equality value
        return ["==", raw];
    }

    // Parse list values: "(admin,editor)" → ["admin", "editor"]
    if (rest.startsWith("(") && rest.endsWith(")")) {
        const items = rest.slice(1, -1).split(",").map(s => coerceValue(s.trim()));
        return [canonicalOp, items];
    }

    return [canonicalOp, coerceValue(rest)];
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
 * // → { age: [[">=", 18], ["<", 65]] }
 */
export function deserializeFilter(
    query: Record<string, string | string[]>
): FilterValues<string> {
    const result: FilterValues<string> = {};

    for (const [field, raw] of Object.entries(query)) {
        if (raw === undefined) continue;

        if (Array.isArray(raw)) {
            if (raw.length === 1) {
                result[field] = deserializeSingle(raw[0]);
            } else if (raw.length > 1) {
                result[field] = raw.map(deserializeSingle);
            }
        } else {
            result[field] = deserializeSingle(raw);
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
    const restOp = CANONICAL_TO_REST[cond.operator];
    if (Array.isArray(cond.value)) {
        const items = cond.value.map(stringifyValue).join(",");
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
export function deserializeLogicalCondition(
    str: string
): LogicalCondition | FilterCondition {
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
                conditions.push(deserializeLogicalCondition(innerStr.slice(start, i)));
                start = i + 1;
            }
        }
        conditions.push(deserializeLogicalCondition(innerStr.slice(start)));

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
        // "column.value" — treat as equality
        return { column, operator: "==", value: coerceValue(rest) };
    }

    const opStr = rest.substring(0, secondDot);
    let valueStr = rest.substring(secondDot + 1);
    const operator = toCanonicalOp(opStr) ?? "==";

    // Parse list values
    if (valueStr.startsWith("(") && valueStr.endsWith(")")) {
        const items = valueStr.slice(1, -1).split(",").map(s => coerceValue(s.trim()));
        return { column, operator, value: items };
    }

    return { column, operator, value: coerceValue(valueStr) };
}
