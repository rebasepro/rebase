/**
 * A real drizzle table from a name and its column names.
 *
 * Tests used to build `{ _def: { tableName }, col: { name: col } }` objects
 * and cast them to a table. This is a table: every column text, keyed by its
 * own name — which is all those stand-ins described.
 */
import { pgTable, text } from "drizzle-orm/pg-core";

export function textTable(name: string, columns: string[]) {
    return pgTable(name, Object.fromEntries(columns.map((column) => [column, text(column)])));
}
