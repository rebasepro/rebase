/**
 * The sequence a `SERIAL` column owns, named the way Postgres names it — how
 * introspection tells a key whose default is its own serial sequence (declared
 * `col.serial()`) from one fed by a sequence Rebase did not create (a
 * `{ kind: "database" }` default).
 */

/**
 * The name Postgres gives a `SERIAL` column's sequence — `ChooseRelationName`
 * with the `seq` label: `<table>_<column>_seq`, and when that is over 63 bytes
 * the longer of the two names is shortened, one character at a time, until it
 * fits.
 */
export function serialSequenceName(table: string, column: string): string {
    const available = 63 - "_seq".length - 1;
    let tableChars = table.length;
    let columnChars = column.length;
    while (tableChars + columnChars > available) {
        if (tableChars > columnChars) tableChars--;
        else columnChars--;
    }
    return `${table.slice(0, tableChars)}_${column.slice(0, columnChars)}_seq`;
}
