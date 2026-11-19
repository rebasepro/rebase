/**
 * The rows a query answered with, whatever shape the driver handed them in.
 *
 * node-postgres answers one result for one statement, and an array of results
 * — one per statement — for a string holding several (`SELECT 1; SELECT 2`).
 * Reading `.rows` off that array gave `undefined`, and the caller got no rows
 * at all for a script that ended in a SELECT. The last statement's rows are
 * the script's answer, as in psql.
 */
export function rowsOfResult(result: unknown): Record<string, unknown>[] {
    const last = Array.isArray(result) ? result[result.length - 1] : result;
    if (typeof last !== "object" || last === null || !("rows" in last)) return [];
    const rows = (last as { rows: unknown }).rows;
    return Array.isArray(rows) ? rows as Record<string, unknown>[] : [];
}

/** `timestamptz`'s type oid. */
const TIMESTAMPTZ_OID = 1184;

/**
 * An instant as `GET /api/data` returns one: RFC 3339, in UTC
 * (`2026-11-18T10:52:23.500Z`). Postgres's own text (`2026-11-18 10:52:23.5+00`)
 * is not something every browser's `Date` parses. A value that is not an
 * instant (`infinity`) is returned as it came.
 */
export function rfc3339Instant(value: unknown): unknown {
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? value : value.toISOString();
    if (typeof value !== "string") return value;
    const iso = value.trim().replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00").replace(/([+-]\d\d)(\d\d)$/, "$1:$2");
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

/** `bigint`'s type oid. */
const INT8_OID = 20;

/**
 * A `bigint` as `GET /api/data` returns one: a number when it fits a safe
 * integer, else the digits as they came, so no digit is lost.
 */
export function int8AsNumber(value: unknown): unknown {
    if (typeof value !== "string" || !/^-?\d+$/.test(value)) return value;
    const n = Number(value);
    return Number.isSafeInteger(n) ? n : value;
}

/**
 * The rows of a caller-SQL result with values spelled as `/api/data` spells
 * them: every `timestamptz` column RFC 3339 (see {@link rfc3339Instant}),
 * every `bigint` a number when it fits (see {@link int8AsNumber}). Read from
 * the result's field types, so a column named anything, computed or aliased,
 * is covered.
 */
export function withInstantsAsRfc3339(result: unknown, rows: Record<string, unknown>[]): Record<string, unknown>[] {
    const last = Array.isArray(result) ? result[result.length - 1] : result;
    const fields = typeof last === "object" && last !== null && "fields" in last ? (last as { fields: unknown }).fields : undefined;
    if (!Array.isArray(fields)) return rows;
    const convert = new Map<string, (value: unknown) => unknown>();
    for (const field of fields) {
        if (typeof field !== "object" || field === null || !("name" in field) || !("dataTypeID" in field)) continue;
        const oid = (field as { dataTypeID: unknown }).dataTypeID;
        const name = String((field as { name: unknown }).name);
        if (oid === TIMESTAMPTZ_OID) convert.set(name, rfc3339Instant);
        else if (oid === INT8_OID) convert.set(name, int8AsNumber);
    }
    if (convert.size === 0) return rows;
    return rows.map(row => {
        const out = { ...row };
        for (const [name, fn] of convert) if (name in out) out[name] = fn(out[name]);
        return out;
    });
}
