import type { AdminCollection } from "@rebasepro/cms-types";
import type { PropertyColumnConfig } from "@rebasepro/app";
import { ROW_ACTIONS_COLUMN } from "@rebasepro/app";

/** The root property of a column id: `address` for `address.city`. */
function rootKey(key: string): string {
    const dot = key.indexOf(".");
    return dot === -1 ? key : key.slice(0, dot);
}

/**
 * The table's columns for a view given `fields`: those columns only, in that
 * order. `columns` were laid out with `fields` as the order, so the ones it
 * names come first and in place; what the table appended after them — the
 * properties `fields` leaves out — is dropped. A spread map named by its root
 * keeps the child columns it expands into.
 */
export function columnsForFields(columns: PropertyColumnConfig[], fields: string[]): PropertyColumnConfig[] {
    const named = new Set(fields);
    // `rowActions`' column is the panel's, not a field: it stays, last.
    return columns.filter(column => column.key === ROW_ACTIONS_COLUMN || named.has(column.key) || named.has(rootKey(column.key)));
}

/**
 * The collection a list, a card or a kanban card is drawn from when the view
 * is given `fields`: only those properties, in that order.
 *
 * Each of those views fills fixed places — a title, an image, a subtitle, a
 * status chip, a date, relation chips, the list's columns — by looking through
 * the collection's properties. Handed only the `fields`, every place picks
 * from them, earlier ones first, and a place none of them fills stays empty.
 * The list's columns are the `fields` the title does not take. A role the
 * collection declares in `display` stays when it names one of the `fields`.
 */
export function restrictCollectionToFields<M extends Record<string, unknown>>(
    collection: AdminCollection<M>,
    fields: string[]
): AdminCollection<M> {
    const keys = fields.filter((key, index) => collection.properties[key] !== undefined && fields.indexOf(key) === index);
    const kept = new Set(keys);
    const properties = Object.fromEntries(keys.map(key => [key, collection.properties[key]]));
    const display = collection.display
        ? Object.fromEntries(Object.entries(collection.display)
            .filter(([, source]) => typeof source === "string" && kept.has(rootKey(source))))
        : undefined;
    return {
        ...collection,
        properties,
        propertiesOrder: keys,
        listProperties: keys,
        previewProperties: keys,
        display
    } as AdminCollection<M>;
}
