import { MAX_LIST_LIMIT } from "@rebasepro/types";
import type { CollectionAccessor, CollectionConfig, Entity, FilterValues, FieldPath } from "@rebasepro/types";
import { getPrimaryKeys } from "@rebasepro/common";

/**
 * The rows of one collection with these ids, in as few requests as its key
 * allows.
 *
 * A picker opens with the rows already linked to the record, and reading each
 * with its own `findById` made a post with 40 tags open the tag picker with 40
 * requests. Where one column is the key, the ids go into one
 * `find({ where: { <key>: ["in", ids] } })` per {@link MAX_LIST_LIMIT} of
 * them; a key over several columns has no one column to put them in, so each
 * row is still read by its id. A batch the source refuses — a key the admin
 * resolves differently from the server, a custom source without `in` — falls
 * back to the same per-id reads, so nothing that opened before fails now.
 *
 * Same rows as before, under the same identity: `find` and `findById` go
 * through the one accessor, and both leave out a row the caller may not read
 * and a soft-deleted one.
 *
 * @returns the rows found, by `String(id)`. An id with no row — deleted, or
 *   not the caller's to read — is absent, as `findById`'s `undefined` was; a
 *   per-id read that fails is absent too, and logged.
 */
export async function findEntitiesByIds<M extends Record<string, unknown>>(
    accessor: Pick<CollectionAccessor<M>, "find" | "findById">,
    collection: CollectionConfig<M>,
    ids: readonly (string | number)[]
): Promise<Map<string, Entity<M>>> {
    const wanted = [...new Set(ids.map(String))];
    const found = new Map<string, Entity<M>>();
    if (wanted.length === 0) return found;

    const keys = getPrimaryKeys(collection);
    if (keys.length === 1) {
        try {
            for (let start = 0; start < wanted.length; start += MAX_LIST_LIMIT) {
                const chunk = wanted.slice(start, start + MAX_LIST_LIMIT);
                const where: FilterValues<FieldPath<M>> = {};
                where[keys[0]] = ["in", chunk];
                // Nothing here reads a total.
                const { data } = await accessor.find({ where, limit: chunk.length, count: "none" });
                for (const entity of data) found.set(String(entity.id), entity);
            }
            return found;
        } catch {
            found.clear();
        }
    }

    const entities = await Promise.all(wanted.map(id =>
        accessor.findById(id).catch((error: unknown) => {
            console.warn(`Could not read ${collection.slug ?? "the collection"} row ${id}`, error);
            return undefined;
        })));
    entities.forEach((entity, i) => {
        if (entity) found.set(wanted[i], entity);
    });
    return found;
}
