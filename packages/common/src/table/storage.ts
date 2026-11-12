import type { ColumnDescriptor, ColumnStorage, JsonPathStep, TableDescriptor } from "@rebasepro/types";

import { walkJsonShape } from "./json-shape";

/**
 * Where a table can hold stored files: every position whose value is the path
 * of a file (`col.storage()`), read from the descriptor.
 *
 * One answer for every reader that asks it — upload limits, the public-read
 * decision, the orphan sweep — so a file inside a JSON block or an array is
 * found by all of them or by none. Replaces the legacy walks over a
 * property's `storage`, `of` and `properties`.
 *
 * @module
 */

/**
 * One position of a table that holds the path of a stored file.
 *
 * @group Table
 */
export interface StoragePosition {
    /** The column the file path sits in. */
    column: ColumnDescriptor;
    /**
     * From the column's value to the file path: `[]` for a storage column
     * itself, `[{ items: true }]` for each item of a `.multiple()` column (or a
     * native array of storage items), the fields, items and variants of a JSON
     * document for a `json.storage()` field inside one.
     */
    path: JsonPathStep[];
    /** The storage rules at that position. */
    storage: ColumnStorage;
}

/**
 * Every position of a table that holds the path of a stored file, columns in
 * physical order and, inside a JSON column, depth first in declaration order.
 *
 * - a storage column (`col.storage({...})`): `path: []`;
 * - an array column whose items are stored files (`col.storage().multiple()`,
 *   or `col.array(...)` with an element carrying storage): `path: [{ items: true }]`.
 *   An element's own storage wins over the column's, as the compiler lowers it;
 * - a `json.storage()` field anywhere inside a JSON column's shape: its path
 *   inside the document.
 *
 * @group Table
 */
export function storagePositions(table: TableDescriptor): StoragePosition[] {
    const out: StoragePosition[] = [];
    for (const column of table.columns) {
        if (column.type.kind === "array") {
            const storage = column.element?.storage ?? column.storage;
            if (storage) out.push({ column, path: [{ items: true }], storage });
        } else if (column.storage) {
            out.push({ column, path: [], storage: column.storage });
        }
        if (column.json) {
            walkJsonShape(column.json, ({ shape, path }) => {
                if (shape.kind === "string" && shape.storage) out.push({ column, path, storage: shape.storage });
            });
        }
    }
    return out;
}

/**
 * The storage rules at a dotted address inside a table — `cover`,
 * `seo.image`, `gallery`, `gallery.0`, `blocks.2.image` — or `undefined` when
 * nothing stored sits there.
 *
 * The first segment is a column key; the rest walk the column's JSON fields.
 * A numeric segment names one item of an array and is skipped, and an array
 * position also stands for its items, because every item obeys the same rule:
 * `gallery` and `gallery.0` both answer with the items' storage. A `oneOf`
 * block cannot be addressed this way (the variant is in the row, not the
 * address) and answers `undefined`.
 *
 * @group Table
 */
export function storageAt(table: TableDescriptor, address: string): ColumnStorage | undefined {
    const segments = address.split(".").filter(segment => segment.length > 0);
    const [first, ...rest] = segments;
    if (first === undefined) return undefined;
    const fields = rest.filter(segment => !/^\d+$/.test(segment));
    for (const position of storagePositions(table)) {
        if (position.column.key !== first) continue;
        const named = position.path.filter(step => !("items" in step));
        if (named.length !== fields.length) continue;
        if (named.every((step, index) => "field" in step && step.field === fields[index])) return position.storage;
    }
    return undefined;
}
