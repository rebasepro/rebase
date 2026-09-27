import type { CollectionConfig } from "@rebasepro/types";

/** The field `softDelete: true` means, when the object form names none. */
export const DEFAULT_SOFT_DELETE_FIELD = "deletedAt";

/**
 * The property a `softDelete` collection records a deletion in — its wire
 * name, what a delete stamps and what a restore (an update to `null`) clears —
 * or `undefined` for a collection without soft delete.
 *
 * One reading of the declaration for every layer that needs it: the driver
 * that stamps and filters on it, and the REST route that has to recognise a
 * restore before it looks the row up.
 */
export function softDeleteFieldOf(collection: CollectionConfig | undefined): string | undefined {
    // Declared on the Postgres collection shape only; narrowed, not cast.
    const declared = collection && "softDelete" in collection ? collection.softDelete : undefined;
    if (!declared) return undefined;
    return (typeof declared === "object" && declared.field) || DEFAULT_SOFT_DELETE_FIELD;
}

/**
 * Whether an update's values restore a soft-deleted row: they set the
 * soft-delete field back to `null`, the documented restore.
 *
 * A restore is an ordinary update of a row every default read hides, so a door
 * that looks the row up before updating it has to include the trashed rows for
 * this update — and only for this one: any other edit of a trashed row is a
 * 404.
 */
export function restoresSoftDeletedRow(
    collection: CollectionConfig | undefined,
    values: Record<string, unknown> | undefined
): boolean {
    const field = softDeleteFieldOf(collection);
    return field !== undefined && values?.[field] === null;
}
