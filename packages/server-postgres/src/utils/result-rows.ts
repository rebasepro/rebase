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
