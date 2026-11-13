import { getTableColumns } from "drizzle-orm";
import { PgArray, PgTable } from "drizzle-orm/pg-core";

/**
 * Read a Postgres array literal (`{a,"b c",NULL,"NULL"}`, nested
 * `{{1,2},{3,4}}`) into its items, each as the text Postgres wrote — an
 * unquoted `NULL` as `null`.
 *
 * Drizzle's own parser reads an unquoted `NULL` as the four-letter string, so
 * a `date[]` / `timestamptz[]` / enum array holding a null item (the types the
 * drivers leave to drizzle as text) served `"NULL"` in its place. A quoted
 * `"NULL"` is the string.
 *
 * An explicit lower bound (`[0:1]={…}`) is skipped: the items are what is
 * served, not their subscripts.
 */
export function parsePgArrayLiteral(literal: string): unknown[] {
    let i = literal.startsWith("[") ? literal.indexOf("=") + 1 : 0;

    const readArray = (): unknown[] => {
        const items: unknown[] = [];
        i++; // `{`
        if (literal[i] === "}") {
            i++;
            return items;
        }
        for (;;) {
            if (literal[i] === "{") {
                items.push(readArray());
            } else if (literal[i] === "\"") {
                let text = "";
                i++;
                while (i < literal.length && literal[i] !== "\"") {
                    if (literal[i] === "\\") i++;
                    text += literal[i];
                    i++;
                }
                i++; // closing quote
                items.push(text);
            } else {
                const start = i;
                while (i < literal.length && literal[i] !== "," && literal[i] !== "}") i++;
                const text = literal.slice(start, i).trim();
                items.push(text.toUpperCase() === "NULL" ? null : text);
            }
            if (literal[i] === ",") {
                i++;
                continue;
            }
            i++; // `}`
            return items;
        }
    };

    return literal[i] === "{" ? readArray() : [];
}

/**
 * Patches every native array column (`PgArray`) of the given tables so a
 * read hands back what the array holds, nulls included.
 *
 * Drizzle's `PgArray.mapFromDriverValue` has two faults this replaces:
 *
 * - it calls `value.map(...)` on a NULL column — `TypeError: value.map is
 *   not a function` — so a null array is served as `null` here;
 * - it maps every item through the item column, a null item included, and
 *   parses a text literal's unquoted `NULL` as the string `"NULL"`: a null
 *   item of a `bigint[]` came back `0` (`Number(null)`), of a `date[]`,
 *   `timestamptz[]` or enum array `"NULL"`. A null item stays `null` here,
 *   and only the others go through the item column's own mapping.
 *
 * Applied where the runtime builds its tables (`buildDrizzleTablesFromSchema`),
 * so every table a driver reads through carries it. Idempotent: a mark on the
 * column, so a table patched twice is wrapped once.
 */
export function patchPgArrayNullSafety(tables: Record<string, unknown>): void {
    for (const tableOrRelation of Object.values(tables)) {
        if (!(tableOrRelation instanceof PgTable)) continue;

        const columns = getTableColumns(tableOrRelation);
        for (const column of Object.values(columns)) {
            if (!(column instanceof PgArray) || Object.hasOwn(column, "__rebaseArrayPatched")) continue;
            Object.defineProperty(column, "__rebaseArrayPatched", { value: true });
            const item = column.baseColumn;
            const mapItems = (items: unknown[]): unknown[] => items.map(entry => {
                if (entry === null || entry === undefined) return null;
                return Array.isArray(entry) ? mapItems(entry) : item.mapFromDriverValue(entry);
            });
            column.mapFromDriverValue = function (value: unknown) {
                if (value === null || value === undefined) return null;
                if (typeof value === "string") return mapItems(parsePgArrayLiteral(value));
                return Array.isArray(value) ? mapItems(value) : value;
            };
        }
    }
}
