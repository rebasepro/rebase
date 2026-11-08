import type { CollectionConfig, Entity } from "@rebasepro/types";
import { rowToViewModel } from "@rebasepro/common";
import { toWireRow } from "./wire_row";

const NO_CONFIG: CollectionConfig = { slug: "", name: "", properties: {} };

/** The row last made for each record the admin holds, and the collection it was made by. */
const rowsByEntity = new WeakMap<Entity, { collection: CollectionConfig | undefined; row: Record<string, unknown> }>();
/** The record each of those rows was made from. */
const entitiesByRow = new WeakMap<Record<string, unknown>, Entity>();

/**
 * A record the admin holds as its view model, as the server sends the row —
 * what an app's own code is handed: `{ id, ...toWireRow(values) }`.
 *
 * Made once per record object and collection, so the same record hands the
 * same row on every render: safe to call in a list, and stable as a hook
 * dependency.
 *
 * @internal
 */
export function rowOfEntity(entity: Entity, collection: CollectionConfig | undefined): Record<string, unknown> {
    const cached = rowsByEntity.get(entity);
    if (cached && cached.collection === collection) return cached.row;
    // `values` is absent on a record that was not found.
    const values: Record<string, unknown> | undefined = entity.values;
    const row: Record<string, unknown> = { id: entity.id, ...toWireRow(values ?? {}, collection ?? NO_CONFIG) };
    rowsByEntity.set(entity, { collection, row });
    entitiesByRow.set(row, entity);
    return row;
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
