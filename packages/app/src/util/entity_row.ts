import type { CollectionConfig, Entity } from "@rebasepro/cms-types";
import { buildCompositeId } from "@rebasepro/common";
import { rowToViewModel, resolvePrimaryKeys } from "@rebasepro/cms-types";
import { toWireRow } from "./wire_row";

const NO_CONFIG: CollectionConfig = { slug: "", name: "", properties: {} };

/** The row made for each record the admin holds, by the collection it was made by. */
const rowsByEntity = new WeakMap<Entity, WeakMap<CollectionConfig, Record<string, unknown>>>();
/** The record each of those rows was made from. */
const entitiesByRow = new WeakMap<Record<string, unknown>, Entity>();

/**
 * A record the admin holds as its view model, as the server sends the row —
 * what an app's own code is handed: `toWireRow(values)`, exactly the record's
 * columns. The admin's `id` for the record is not one of them: it is handed
 * beside the row, and a row's `id` is the record's `id` column where it has
 * one, with that column's type.
 *
 * Made once per record object and collection, so the same record hands the
 * same row on every render: safe to call in a list, and stable as a hook
 * dependency.
 *
 * @internal
 */
export function rowOfEntity(entity: Entity, collection: CollectionConfig | undefined): Record<string, unknown> {
    const config = collection ?? NO_CONFIG;
    let byCollection = rowsByEntity.get(entity);
    const cached = byCollection?.get(config);
    if (cached) return cached;
    // `values` is absent on a record that was not found.
    const values: Record<string, unknown> | undefined = entity.values;
    const row = toWireRow(values ?? {}, config);
    if (!byCollection) {
        byCollection = new WeakMap();
        rowsByEntity.set(entity, byCollection);
    }
    byCollection.set(config, row);
    entitiesByRow.set(row, entity);
    return row;
}

/**
 * The id the admin addresses a row's record by — the string `useSidePanel`,
 * a selection and a route take: its primary key, a composite one's parts
 * joined by `:::`, as the server derives it. `undefined` when the row lacks
 * a key column.
 *
 * A collection that declares no primary key is addressed by the row's own
 * `id`, as its data source serves one.
 *
 * @internal
 */
export function idOfRow(row: Record<string, unknown>, collection: CollectionConfig | undefined): string | undefined {
    const held = entitiesByRow.get(row);
    if (held) return String(held.id);
    const keys = collection ? resolvePrimaryKeys(collection) : [];
    if (keys.length > 0) {
        const complete = keys.every((key) => {
            const part = row[key.fieldName];
            return part !== undefined && part !== null && part !== "";
        });
        return complete ? buildCompositeId(row, keys) : undefined;
    }
    const id = row.id;
    return typeof id === "string" || typeof id === "number" ? String(id) : undefined;
}

/**
 * The record a row handed to app code stands for — the admin's own view model
 * of it when the row came from {@link rowOfEntity}, which keeps what the row
 * left out (a relation's target columns, a date's instance); otherwise built
 * from the row.
 *
 * @internal
 */
export function entityOfRow(
    row: Record<string, unknown>,
    id: string | number,
    path: string,
    collection: CollectionConfig | undefined
): Entity {
    const held = entitiesByRow.get(row);
    if (held) return held;
    if (!collection?.properties) return { id, path, values: row };
    const slug = collection.slug;
    return {
        id,
        path,
        values: rowToViewModel(row, slug, (requested) => requested === slug ? collection : undefined)
    };
}
