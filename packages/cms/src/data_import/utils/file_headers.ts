import { isPrototypePollutingKey } from "@rebasepro/utils";

/**
 * The header row of a spreadsheet, as a column index → name map.
 *
 * A map rather than an array, and that is the whole point. The ExcelJS version
 * built a *sparse* array keyed by column and then returned
 * `headers.filter(Boolean)`, which compacts it — so a sheet with a blank header
 * in the middle shifted every later name one column to the left, and the import
 * wrote each of those columns' values into its neighbour's field. Silently: the
 * row count was right, the field names were right, and only the values were in
 * the wrong places.
 *
 * Keeping the column index means a blank header can be dropped (which is what
 * `filter(Boolean)` was reaching for) without moving anything else.
 */
export interface SheetHeaders {
    /** Column index (0-based) → the field name that column feeds. */
    byColumn: Map<number, string>;
    /** The names in column order — the import's `propertiesOrder`. */
    order: string[];
}

/** A cell as `read-excel-file` hands it over: a primitive, or null when empty. */
export type SheetCell = string | number | boolean | Date | null;

/**
 * Read the header names out of the first row.
 *
 * A column whose header is blank is left out entirely, so it contributes
 * neither a field nor a value — the same intent as the old `filter(Boolean)`,
 * without the shift.
 */
export function getWorksheetHeaders(headerRow: readonly SheetCell[]): SheetHeaders {
    const byColumn = new Map<number, string>();
    const order: string[] = [];
    const taken = new Set<string>();

    headerRow.forEach((cell, index) => {
        // `0` and `false` are legitimate header text and must survive; only an
        // empty cell and an all-whitespace one are "no header".
        if (cell === null || cell === undefined) return;
        const base = (cell instanceof Date ? cell.toISOString() : String(cell)).trim();
        if (!base) return;
        // A repeated header is a column of its own (`x`, `x_2`), as in the
        // CSV reader: under one name, the later column's cells overwrote the
        // earlier's.
        let name = base;
        for (let n = 2; taken.has(name); n++) name = `${base}_${n}`;
        taken.add(name);
        byColumn.set(index, name);
        // Refused as a column when the rows are read, so not one of the
        // file's order either (see `parseCsvToObjects`).
        if (!isPrototypePollutingKey(name)) order.push(name);
    });

    return { byColumn, order };
}
