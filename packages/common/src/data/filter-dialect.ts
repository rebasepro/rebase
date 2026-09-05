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
    ALL_WHERE_FILTER_OPS,
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
// Unknown operators
// ---------------------------------------------------------------------------

/** The operator spellings a rejection lists back to the caller. */
const VALID_OPERATOR_LIST = ALL_WHERE_FILTER_OPS.join(", ");

/**
 * A filter condition named an operator this dialect does not have.
 *
 * ## Why this throws, rather than returning a typed rejection
 *
 * `deserializeFilter` is the *shared* codec: the REST ingress
 * (`packages/server/src/api/rest/query-parser.ts`), the browser SDK and the
 * admin panel (`buildRebaseData.ts`) all decode through it. Two constraints
 * follow.
 *
 * - It cannot throw the server's `ApiError`. `@rebasepro/common` does not
 *   depend on `@rebasepro/server` (the dependency runs the other way), and a
 *   browser client has no error handler to render an `ApiError` with. So the
 *   rejection is this plain `Error` subclass, whose `message` reads correctly
 *   wherever it surfaces — a rejected promise in an app, a 400 body over HTTP.
 * - It cannot be a returned rejection *value*. Every caller assigns the result
 *   straight into a query it is about to run; a sentinel that none of them
 *   check would be ignored, which is exactly the silently-wrong-filter failure
 *   this exists to stop. Throwing is also what this file already does for the
 *   sibling cases — `serializeTuple` on an unknown canonical operator,
 *   `deserializeLogicalCondition` past the nesting bound — and the REST parser
 *   already converts the latter into a 400.
 *
 * `statusCode`, `code` and `details` are carried as fields because the server's
 * Hono error handler duck-types those off any thrown error: a decode path that
 * forgets to convert still answers 400 with the canonical envelope instead of a
 * 500 that says "An unexpected error occurred". `query-parser.ts` converts
 * explicitly all the same — that is the path the contract is stated on, and an
 * incidental 400 is not a contract.
 */
export class UnknownFilterOperatorError extends Error {
    /** The field the condition was written against. */
    public readonly field: string;
    /** The operator string as it arrived, verbatim. */
    public readonly operator: string;
    /** Every operator this dialect accepts, in canonical spelling. */
    public readonly validOperators: readonly WhereFilterOp[] = ALL_WHERE_FILTER_OPS;
    /** See the class docblock: read by the server's error handler. */
    public readonly statusCode = 400;
    public readonly code = "UNKNOWN_FILTER_OPERATOR";
    public readonly details: { field: string; operator: string; validOperators: readonly WhereFilterOp[] };

    constructor(field: string, operator: string) {
        super(
            `Unknown filter operator '${operator}' on field '${field}'. `
            + `Valid operators: ${VALID_OPERATOR_LIST}`
        );
        this.name = "UnknownFilterOperatorError";
        this.field = field;
        this.operator = operator;
        this.details = { field, operator, validOperators: ALL_WHERE_FILTER_OPS };
    }
}

/**
 * Two to three characters of ASCII punctuation and nothing else — the shape
 * every symbolic operator has (`==`, `>=`, `<>`, `~~`, `!!`, `>>`, `===`), and
 * one a column value effectively never has.
 *
 * Two characters minimum on purpose. A *single* punctuation character is a
 * perfectly ordinary value — `{ grade: ["-", "+"] }` is a two-item list, not a
 * condition — and the only single-character operator anyone actually mistypes
 * is `=`, which is named separately below. `<` and `>` need no special case:
 * they are real operators and resolve.
 */
const SYMBOLIC_OPERATOR = /^[^\p{L}\p{N}\s]{2,3}$/u;

/** Lowercase, strip everything that is not a letter or digit. */
function normalizeOperatorName(op: string): string {
    return op.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Every real operator name with its case and separators removed, so a
 * respelling of one — `arrayContains`, `not_in`, `NOT-LIKE`, `isNull` — is
 * recognised as an attempt at an operator rather than read as a value.
 *
 * These are rejected rather than accepted: admitting a second spelling of an
 * operator would leave two wire spellings of one thing, and the rejection
 * message names the one that works.
 */
const RESPELLED_OPERATORS: ReadonlySet<string> = new Set(
    [...ALL_WHERE_FILTER_OPS, ...Object.keys(REST_TO_CANONICAL)].map(normalizeOperatorName)
);

/**
 * Operator names *other* query dialects use, which this one does not have.
 *
 * This list is curated, and deliberately so. For a word-shaped string there is
 * no rule that separates "an operator the caller guessed" from "a value that
 * happens to be a word": `{ tags: ["a", "b"] }` has to keep meaning a two-item
 * `in` list, so the codec cannot simply refuse every unrecognised word in
 * position 0. The line is therefore drawn by name, and only around names whose
 * use as an operator is far more likely than their use as one of two sibling
 * values. `contains` is the motivating case — the first thing a developer
 * reaches for, and until now it compiled to `title IN ('contains', 'Hell')`.
 *
 * Genuinely ambiguous single words (`any`, `all`, `exists`, `search`, `not`)
 * are left off: as operators they are rare, and as enum values they are common.
 * Everywhere else the tie goes to *rejecting*, because a 400 naming the
 * supported set costs the caller one round trip, and the alternative — which is
 * what every name on this list used to produce — is a query that runs, returns
 * rows, and is wrong.
 */
const NEAR_MISS_OPERATORS: ReadonlySet<string> = new Set([
    "contains", "notcontains", "doesnotcontain", "doesnotcontains",
    "includes", "notincludes",
    "startswith", "notstartswith", "beginswith", "startingwith",
    "endswith", "notendswith",
    "matches", "notmatches", "regex", "regexp",
    "between", "notbetween",
    "equals", "notequals", "equalto", "isequalto", "isnotequalto",
    "greaterthan", "greaterthanorequal", "greaterthanorequalto",
    "lessthan", "lessthanorequal", "lessthanorequalto",
    "isempty", "isnotempty",
    "oneof", "noneof", "anyof", "allof",
    "null", "isnullorempty"
]);

/**
 * Was this string *meant* as an operator?
 *
 * Only consulted after {@link toCanonicalOp} has already failed to resolve it,
 * so a `true` here is always a rejection.
 */
function isOperatorShaped(op: string): boolean {
    if (op === "=") return true;
    if (SYMBOLIC_OPERATOR.test(op)) return true;
    const normalized = normalizeOperatorName(op);
    if (!normalized) return false;
    return RESPELLED_OPERATORS.has(normalized) || NEAR_MISS_OPERATORS.has(normalized);
}

/**
 * Read a `[op, value]` tuple, if that is what this is.
 *
 * Three outcomes, and the middle one is the defect this function exists for:
 *
 * - the operator resolves (canonical *or* REST spelling) → the canonical tuple;
 * - the operator does not resolve but was plainly meant as one → throw;
 * - it does not look like an operator at all → `undefined`, and the caller
 *   falls back to reading the array as a list of values.
 *
 * The old test was `toCanonicalOp(raw[0]) === raw[0]`, i.e. canonical spelling
 * only, with *everything else* — including every REST short-code — dropping
 * through to `["in", raw]`. So the operator string itself became a value in a
 * membership test: `["!!", "Hello"]` compiled to `title IN ('!!','Hello')`,
 * which matches, and the caller got back rows their filter was written to
 * exclude. `["eq", "active"]` had the same shape of failure.
 */
function readTuple(field: string, raw: unknown): [WhereFilterOp, unknown] | undefined {
    if (!Array.isArray(raw) || raw.length !== 2) return undefined;
    const [op, value] = raw;
    if (typeof op !== "string") return undefined;

    const canonical = toCanonicalOp(op);
    if (canonical) return [canonical, value];

    // A dot means this is a *wire* string, not an operator token: two repeated
    // query params arrive as `["gte.18", "lt.65"]`, which is a two-element array
    // of strings and therefore tuple-shaped. Deferred with exactly the test the
    // repeated-dot-string branch below uses, so the two cannot disagree.
    //
    // The property test found this: `["ilike", ""]` serializes to `"ilike."`,
    // whose normalized form is a real operator name, so a well-formed
    // round-trip was being rejected as a bad operator.
    if (op.includes(".")) return undefined;

    if (isOperatorShaped(op)) throw new UnknownFilterOperatorError(field, op);

    return undefined;
}

// ---------------------------------------------------------------------------
// Serialize: FilterValues → REST querystring
// ---------------------------------------------------------------------------

/**
 * Encode the `<op>.<value>` half of a wire condition.
 *
 * This is the single leaf encoder. Both wire positions that carry a condition
 * — a top-level query parameter (`?status=eq.active`) and a leaf inside an
 * `and(...)`/`or(...)` group (`or(status.eq.active,…)`) — go through it, so a
 * rule expressed here holds in both. The group serializer used to carry its
 * own copy, and the copy had drifted on every rule that matters: `null` went
 * out as the four-character string, the empty list as `()`, and an operator
 * this dialect does not have was silently rewritten to `eq` — a filter that
 * ran, returned rows, and answered a different question than the one asked.
 *
 * `escapeScalar` is the one thing the two positions legitimately disagree
 * about. A scalar in a query parameter owns the whole value and needs no
 * escaping; a scalar inside a group sits between the same commas a list item
 * does, so a comma in it would end the condition early.
 */
function serializeOperatorAndValue(
    op: WhereFilterOp,
    value: unknown,
    { escapeScalar, where }: { escapeScalar: boolean; where: string }
): string {
    if (typeof op !== "string") {
        throw new TypeError(
            `${where}: operator must be a string, got ${typeof op}`
        );
    }

    // Canonical spellings only, on purpose: this codec parses liberally and
    // emits strictly. `deserializeFilter` accepts a REST short-code because one
    // arrives off the wire; a *caller* handing one to the serializer has a
    // condition object built by hand, and the spelling it wants is the one the
    // types name.
    //
    // The throw is the fix. `serializeLogicalCondition` used to end this lookup
    // with `?? "eq"`, so `{ operator: "gte" }` — the spelling the wire uses, and
    // therefore the one most often guessed — was sent as `age.eq.18`: a query
    // that ran, returned rows, and answered a different question.
    const restOp = CANONICAL_OP_LOOKUP.get(op);
    if (!restOp) {
        throw new TypeError(
            `${where}: unknown operator "${op}". Valid operators: ${Object.keys(CANONICAL_TO_REST).join(", ")}`
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

    // A null test has no operand. Whatever was parked in `value` is dropped
    // here rather than on the way back, so the encoding is stable: both
    // deserializers normalize `isnull.<anything>` to `null`, and re-encoding
    // that must land on the same string it came from.
    if (NULL_OPS.has(op)) return `${restOp}.null`;

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

    const scalar = stringifyValue(value);
    return `${restOp}.${escapeScalar ? escapeWireValue(scalar) : scalar}`;
}

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
    return serializeOperatorAndValue(op, value, {
        escapeScalar: false,
        where: "serializeTuple"
    });
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
 *
 * @throws {UnknownFilterOperatorError} when a condition names an operator this
 * dialect does not have. See that class for why a rejection here is a throw.
 */
export function deserializeFilter(
    query: Record<string, unknown>
): FilterValues<string> {
    const result: FilterValues<string> = {};

    for (const [field, raw] of Object.entries(query)) {
        if (raw === undefined) continue;

        // A single `[op, value]` condition.
        const tuple = readTuple(field, raw);
        if (tuple) {
            result[field] = tuple;
            continue;
        }

        if (Array.isArray(raw)) {
            if (raw.length === 0) continue;

            // An array of tuples: several conditions on the same field. Every
            // element is checked, not just the first — the old test read
            // `raw[0]` and cast the whole array, so one bad operator among
            // several travelled on untouched.
            if (Array.isArray(raw[0])) {
                const tuples = raw.map(item => readTuple(field, item));
                if (tuples.every((t): t is [WhereFilterOp, unknown] => t !== undefined)) {
                    result[field] = tuples;
                    continue;
                }
            }

            if (raw.length === 1) {
                result[field] = typeof raw[0] === "string" ? deserializeSingle(raw[0]) : ["==", raw[0]];
            } else {
                // If the elements are strings, they might be PostgREST dot-strings (repeated params)
                if (typeof raw[0] === "string" && raw[0].includes(".")) {
                    result[field] = raw.map(r => typeof r === "string" ? deserializeSingle(r) : (["==", r] as [WhereFilterOp, unknown])) as [WhereFilterOp, unknown][];
                } else {
                    // Otherwise assume it's a list of values for an implicit
                    // "in" — `{ tags: ["a","b"] }`, and `?tags=a&tags=b`, which
                    // arrives here identically.
                    //
                    // A two-element array reaches this line only after
                    // `readTuple` has decided its first element was not meant
                    // as an operator. Everything longer never had the
                    // ambiguity: an operator tuple has exactly two slots.
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
 * Leaf encoding is {@link serializeOperatorAndValue}, the same function
 * `serializeTuple` uses, so `null`, the empty list and an unknown operator
 * behave identically inside a group and in a query parameter.
 *
 * @throws {TypeError} when a leaf names an operator this dialect does not have.
 * It used to fall back to `eq`, which turned `age >= 18` into `age = 18` with
 * no diagnostic anywhere.
 *
 * @example
 * serializeLogicalCondition({ column: "status", operator: "==", value: "active" })
 * // → "status.eq.active"
 *
 * serializeLogicalCondition({ column: "deleted_at", operator: "==", value: null })
 * // → "deleted_at.isnull.null"
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

    // FilterCondition. The leaf goes through the shared encoder, so a group
    // condition and a query parameter agree on nulls, empty lists and unknown
    // operators — see `serializeOperatorAndValue`.
    //
    // The column is escaped like a value: it is not one, but it shares the
    // delimiters, and a comma or paren in it would move where the group parser
    // thinks the condition ends. Dots are deliberately *not* escaped — a
    // relation path is `author.name` on the wire, and the parser below finds
    // the operator rather than assuming it is the second segment.
    return `${escapeWireValue(cond.column)}.${serializeOperatorAndValue(cond.operator, cond.value, {
        escapeScalar: true,
        where: "serializeLogicalCondition"
    })}`;
}

/**
 * Split a leaf condition into `column`, operator token and value.
 *
 * The naive reading — column is everything before the first dot, operator is
 * everything up to the second — cannot express a relation path. A filter on
 * `author.name` serializes to `author.name.eq.bob` and came back as the column
 * `author` with the operator `name`, which resolves to nothing, so the
 * fallback made it `author == "eq.bob"`: a condition that runs and matches
 * nothing, on a column the caller never named.
 *
 * So the operator is found rather than assumed: it is the first dot-separated
 * segment after the column that resolves to a real operator. Everything before
 * it is the column, everything after is the value. `version.eq.1.2.3` still
 * reads as `version >= "1.2.3"` because the scan stops at the first match, and
 * `metadata->>x.eq.5` never had dots in the column to begin with.
 *
 * Returns `undefined` when no segment resolves — `status.active`, an equality
 * written without an operator, which the caller handles.
 */
function splitLeafCondition(str: string): { column: string; operator: WhereFilterOp; value: string } | undefined {
    // Dots inside a list value (`in.(1.5,2.5)`) are not separators. The value
    // always follows the operator, so the search only needs the region before
    // the first unescaped paren.
    let limit = str.length;
    for (let i = 0; i < str.length; i++) {
        if (str[i] === "\\") { i++; continue; }
        if (str[i] === "(") { limit = i; break; }
    }

    const dots: number[] = [];
    for (let i = 0; i < limit; i++) {
        if (str[i] === "\\") { i++; continue; }
        if (str[i] === ".") dots.push(i);
    }

    // Segment 0 is always the column, and an operator needs a value after it,
    // so a candidate is bounded on both sides by a dot.
    for (let i = 1; i < dots.length; i++) {
        const operator = toCanonicalOp(str.substring(dots[i - 1] + 1, dots[i]));
        if (!operator) continue;
        return {
            column: unescapeWireValue(str.substring(0, dots[i - 1])),
            operator,
            value: str.substring(dots[i] + 1)
        };
    }

    return undefined;
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
    const leaf = splitLeafCondition(str);
    if (!leaf) {
        const firstDot = str.indexOf(".");
        if (firstDot === -1) {
            return { column: unescapeWireValue(str), operator: "==", value: true };
        }
        // "column.value" — no segment resolved as an operator, so this is an
        // equality written without one. The value keeps its dots.
        return {
            column: unescapeWireValue(str.substring(0, firstDot)),
            operator: "==",
            value: unescapeWireValue(str.substring(firstDot + 1))
        };
    }

    const { column, operator, value: valueStr } = leaf;

    // A null test has no operand: `isnull.null` is what the serializer writes,
    // but a hand-written `isnull.true` means the same thing. Normalizing here
    // is what makes the tuple stable through a re-encode, and it matches
    // `deserializeSingle`, which has done it for query parameters all along.
    if (NULL_OPS.has(operator)) {
        return { column, operator, value: null };
    }

    // Parse list values with escape-aware splitting. The wrapping parens are
    // written by the serializer *after* the items are escaped, so an escaped
    // paren inside an item can never be mistaken for them.
    if (valueStr.startsWith("(") && valueStr.endsWith(")")) {
        const inner = valueStr.slice(1, -1);
        // See EMPTY_LIST_TOKEN: `(\)` is the empty list, which is not the same
        // query as a search for the empty string.
        const items = inner === EMPTY_LIST_TOKEN ? [] : splitListItems(inner);
        return { column, operator, value: items };
    }

    return { column, operator, value: unescapeWireValue(valueStr) };
}
