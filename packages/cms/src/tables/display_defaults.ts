/**
 * Which columns fill a projected table's card and list slots.
 *
 * Conservative on purpose: a slot is filled only when a column says plainly
 * that it belongs there, and otherwise left to the panel's own derivation,
 * which reads the values in hand. Deterministic: the first matching column in
 * physical order wins, so the same table always gets the same slots.
 *
 * - `title` — the first text column (no options, no file) whose key, ignoring
 *   case and separators, is one of {@link TITLE_KEYS}.
 * - `image` — the first file column whose `accept` names an image type.
 * - `status` — the first column named `status` with a closed set of values.
 * - `date` — the first date or timestamp column the server does not stamp
 *   (`publishDate`); failing that the update stamp, then the create stamp.
 */
import type { ColumnDescriptor, TableDescriptor } from "@rebasepro/types";
import type { EntityDisplay } from "@rebasepro/cms-types";
import { acceptsImages } from "./column_property";

/** Keys that state a column holds the record's label, normalized. */
export const TITLE_KEYS: readonly string[] = [
    "title", "name", "label", "displayname", "fullname", "heading", "subject", "username"
];

const normalize = (key: string): string => key.toLowerCase().replace(/[^a-z0-9]/g, "");

const isText = (column: ColumnDescriptor): boolean =>
    column.type.kind === "text" || column.type.kind === "varchar" || column.type.kind === "char";

const isTemporal = (column: ColumnDescriptor): boolean =>
    column.type.kind === "timestamptz" || column.type.kind === "date";

const hasOptions = (column: ColumnDescriptor): boolean =>
    column.type.kind === "enum" || (column.oneOf !== undefined && column.oneOf.length > 0);

/**
 * The default `display` slots of a table, keyed by column key. `undefined`
 * when no column qualifies for any slot.
 *
 * @param table the table
 * @param shown the keys of the columns the projection kept as fields
 */
export function defaultDisplay(table: TableDescriptor, shown: ReadonlySet<string>): EntityDisplay | undefined {
    const columns = table.columns.filter(column => shown.has(column.key));
    const display: EntityDisplay = {};

    const title = columns.find(column =>
        isText(column) && !hasOptions(column) && !column.storage && TITLE_KEYS.includes(normalize(column.key)));
    if (title) display.title = title.key;

    const image = columns.find(column => column.type.kind !== "array" && acceptsImages(column.storage));
    if (image) display.image = image.key;

    const status = columns.find(column => normalize(column.key) === "status" && hasOptions(column));
    if (status) display.status = status.key;

    const date = columns.find(column => isTemporal(column) && !column.stamp)
        ?? columns.find(column => isTemporal(column) && column.stamp?.value === "now" && column.stamp.on === "update")
        ?? columns.find(column => isTemporal(column) && column.stamp?.value === "now" && column.stamp.on === "create");
    if (date) display.date = date.key;

    return Object.keys(display).length > 0 ? display : undefined;
}
