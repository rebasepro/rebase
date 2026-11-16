import type { ColumnType, IncludeSpec } from "@rebasepro/types";
import type { RuntimeTable } from "../model/runtime-table";

/**
 * Which list subscriptions a row change can reach, decided before any of them
 * refetches.
 *
 * A write to a table used to schedule a refetch for every list group on it,
 * so a table open as a thousand different principals cost a thousand
 * RLS-scoped reads per write — even when every one of those lists was
 * `where owner_id == <me>` and the row belonged to one of them. A change can
 * only alter a list whose filter matched the row before the change or matches
 * it after, so a group whose filter provably matches neither is skipped.
 *
 * This decides only *whether* a group refetches, never *what* it receives:
 * every frame is still a read under the subscriber's own scope. A wrong "may
 * match" costs one refetch; a wrong "cannot match" would leave a list stale,
 * so every rule here answers "may match" whenever it cannot be sure:
 *
 * - Only `==` and `in` on a plain column of a type whose equality is plain
 *   (text, varchar, uuid, enum, the integer types, boolean) are judged. Every
 *   other condition — a range, a pattern, a JSON path, a relation, a
 *   `logical` group, a search — is left out, and since the conditions of a
 *   read are ANDed, leaving one out only widens what the judge admits.
 * - A column with a field-level hook (`.transform()`) is never judged: the
 *   values a write hands over may be its transformed view, not what Postgres
 *   compares.
 * - A list that loads relations, or a table with an `afterRead` hook, is never
 *   pre-filtered: either can make a list depend on rows its filter excludes.
 * - A value the change does not carry (a column the WAL left out, a key-only
 *   old tuple, a capture trigger that sends the key alone, an 8 KB overflow)
 *   is unknown, and unknown means refetch.
 */

/**
 * The two versions of a changed row, by column key, as far as they are known.
 * `null` is "no such version" (the row before an insert, after a delete);
 * `undefined` is "not known", and a key missing from a version is unknown too.
 */
export interface RowChangeImage {
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
}

/** One `==`/`in` condition the judge can evaluate: the canonical values it admits. */
interface EqualityConjunct {
    field: string;
    /** Canonical values (see {@link canonicalValue}); {@link NULL_KEY} stands for `IS NULL`. */
    accepts: ReadonlySet<string>;
    kind: ColumnType["kind"];
}

/** A list group's pre-filter: the judged conditions, and the one it is indexed by. */
export interface ListPrefilter {
    conjuncts: readonly EqualityConjunct[];
    /** The condition the group is found by: its field and every value it admits. */
    index: EqualityConjunct;
}

/** The canonical spelling of SQL `NULL` in an index. */
export const NULL_KEY = "\u0000null";

const INTEGER_KINDS = new Set<ColumnType["kind"]>(["smallint", "integer", "bigint", "smallserial", "serial", "bigserial"]);
const STRING_KINDS = new Set<ColumnType["kind"]>(["text", "varchar", "enum"]);
const TRUE_SPELLINGS = new Set(["t", "true", "y", "yes", "on", "1"]);
const FALSE_SPELLINGS = new Set(["f", "false", "n", "no", "off", "0"]);
/** Longer values are left out of an image: unknown, never compared, and not held in memory. */
export const MAX_IMAGE_VALUE_LENGTH = 256;

function judgedKind(kind: ColumnType["kind"]): boolean {
    return INTEGER_KINDS.has(kind) || STRING_KINDS.has(kind) || kind === "uuid" || kind === "boolean";
}

/**
 * A value as Postgres would compare it in a column of `kind`, as one string,
 * or `undefined` when that cannot be said with certainty — the caller then
 * treats the comparison as unknown. Accepts both a filter's JSON value and a
 * change's value (a JS value from the write path, or the text the WAL sends).
 */
export function canonicalValue(kind: ColumnType["kind"], value: unknown): string | undefined {
    if (value === null) return NULL_KEY;
    if (INTEGER_KINDS.has(kind)) {
        if (typeof value === "number") return Number.isSafeInteger(value) ? String(value) : undefined;
        if (typeof value === "bigint") return value.toString();
        if (typeof value === "string" && /^\s*[+-]?\d{1,20}\s*$/.test(value)) return BigInt(value.trim()).toString();
        return undefined;
    }
    if (kind === "boolean") {
        if (typeof value === "boolean") return value ? "t" : "f";
        if (typeof value !== "string") return undefined;
        const spelled = value.trim().toLowerCase();
        if (TRUE_SPELLINGS.has(spelled)) return "t";
        if (FALSE_SPELLINGS.has(spelled)) return "f";
        return undefined;
    }
    if (kind === "uuid") {
        if (typeof value !== "string") return undefined;
        // Postgres reads braces, upper case and missing hyphens as the same uuid.
        const hex = value.trim().replace(/^\{(.*)\}$/, "$1").replace(/-/g, "").toLowerCase();
        return /^[0-9a-f]{32}$/.test(hex) ? hex : undefined;
    }
    if (STRING_KINDS.has(kind)) {
        // A number against a text column is a cast Postgres decides, not this.
        return typeof value === "string" && value.length <= MAX_IMAGE_VALUE_LENGTH ? value : undefined;
    }
    return undefined;
}

/** The `[op, value]` tuples of one filter entry: one tuple, or an array of them. */
function filterTuples(param: unknown): Array<[unknown, unknown]> {
    if (!Array.isArray(param) || param.length === 0) return [];
    if (Array.isArray(param[0])) {
        return param.filter((tuple): tuple is [unknown, unknown] => Array.isArray(tuple) && tuple.length >= 1)
            .map((tuple) => [tuple[0], tuple[1]]);
    }
    return [[param[0], param[1]]];
}

function equalityConjunct(field: string, kind: ColumnType["kind"], op: unknown, value: unknown): EqualityConjunct | undefined {
    if (op === "==") {
        const key = value === undefined ? NULL_KEY : canonicalValue(kind, value);
        return key === undefined ? undefined : { field, kind, accepts: new Set([key]) };
    }
    if (op === "in") {
        // `["in", null]` is a null check, as the compiler reads it.
        if (value === null || value === undefined) return { field, kind, accepts: new Set([NULL_KEY]) };
        // Anything but an array is a spelling the compiler interprets; not judged.
        if (!Array.isArray(value)) return undefined;
        const accepts = new Set<string>();
        for (const item of value) {
            // A null inside a list is `= NULL` in SQL: it matches nothing.
            if (item === null) continue;
            const key = canonicalValue(kind, item);
            if (key === undefined) return undefined;
            accepts.add(key);
        }
        return { field, kind, accepts };
    }
    return undefined;
}

/**
 * The pre-filter for a list read of `table`, or `undefined` when the list
 * must refetch on every change to the table.
 */
export function compileListPrefilter(
    table: RuntimeTable,
    request: { filter?: Record<string, unknown>; include?: IncludeSpec },
    tableHasReadHooks: boolean
): ListPrefilter | undefined {
    if (tableHasReadHooks) return undefined;
    const include = request.include;
    if (include !== undefined && !(Array.isArray(include) && include.length === 0)) return undefined;
    const filter = request.filter;
    if (!filter) return undefined;
    const transformed = table.compiled.transforms ?? {};
    const conjuncts: EqualityConjunct[] = [];
    for (const [field, param] of Object.entries(filter)) {
        // A filter key that names a column is that column — the compiler
        // resolves a direct column before a relation or a JSON path.
        const column = table.columnsByKey.get(field);
        if (!column || !judgedKind(column.type.kind)) continue;
        if (Object.prototype.hasOwnProperty.call(transformed, field)) continue;
        for (const [op, value] of filterTuples(param)) {
            const conjunct = equalityConjunct(field, column.type.kind, op, value);
            if (conjunct) conjuncts.push(conjunct);
        }
    }
    if (conjuncts.length === 0) return undefined;
    // Indexed by the narrowest condition: the fewest values to look up under.
    const index = conjuncts.reduce((best, next) => (next.accepts.size < best.accepts.size ? next : best));
    return { conjuncts, index };
}

/**
 * Whether one version of a row matches the judged conditions: `false` only
 * when a condition is known to fail, `undefined` when one cannot be read.
 */
export function prefilterMatches(prefilter: ListPrefilter, values: Record<string, unknown>): boolean | undefined {
    let known = true;
    for (const conjunct of prefilter.conjuncts) {
        if (!Object.prototype.hasOwnProperty.call(values, conjunct.field)) {
            known = false;
            continue;
        }
        const key = canonicalValue(conjunct.kind, values[conjunct.field]);
        if (key === undefined) {
            known = false;
            continue;
        }
        if (!conjunct.accepts.has(key)) return false;
    }
    return known ? true : undefined;
}

/**
 * Whether a change may alter a list with this pre-filter: unless both
 * versions of the row are known not to match it.
 */
export function changeMayReach(prefilter: ListPrefilter, image: RowChangeImage): boolean {
    for (const version of [image.before, image.after]) {
        if (version === null) continue;
        if (version === undefined) return true;
        if (prefilterMatches(prefilter, version) !== false) return true;
    }
    return false;
}

/**
 * The index keys a version of a row is found under for `field`, or
 * `undefined` when the version cannot say — then every group indexed by the
 * field may be reached.
 */
export function imageIndexKey(version: Record<string, unknown>, field: string, kind: ColumnType["kind"]): string | undefined {
    if (!Object.prototype.hasOwnProperty.call(version, field)) return undefined;
    return canonicalValue(kind, version[field]);
}
