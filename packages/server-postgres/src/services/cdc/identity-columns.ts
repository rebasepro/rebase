import type { RuntimeTable } from "../../model/runtime-table";
import { tableKeys } from "../collection-helpers";

/** One key column of a table, by key and by SQL name. */
export interface KeyColumn {
    fieldName: string;
    columnName: string;
}

/**
 * The columns a table's rows are addressed by.
 *
 * A change notification names its row by column — that is all a trigger sees —
 * and an address is built from the key's *field* names. Both ends read the
 * mapping from here: the provisioner, to attach the trigger with exactly these
 * columns (and nothing else leaves the database), and the consumer, to turn the
 * captured columns back into an address. A key declared as `userId` over
 * `user_id` used to be looked up by field name on the captured row, never
 * found, and every external write reached no single-row subscriber.
 *
 * The SQL name is the descriptor's; for a keyless introspected table addressed
 * through its catalogue, the catalogue column's.
 */
export function tableKeyColumns(table: RuntimeTable): KeyColumn[] {
    return tableKeys(table).map((pk) => {
        const declared = table.columnsByKey.get(pk.fieldName)?.column;
        const catalogue = table.pg ? catalogueColumnName(table, pk.fieldName) : undefined;
        return { fieldName: pk.fieldName, columnName: declared ?? catalogue ?? pk.fieldName };
    });
}

function catalogueColumnName(table: RuntimeTable, key: string): string | undefined {
    const pg = table.pg;
    if (!pg || !Object.prototype.hasOwnProperty.call(pg, key)) return undefined;
    const column: unknown = Reflect.get(pg, key);
    if (typeof column !== "object" || column === null || !("name" in column)) return undefined;
    return typeof column.name === "string" ? column.name : undefined;
}
