import type { SearchMatch } from "@rebasepro/types";

/**
 * Representation of a entity fetched from the driver
 * @group Models
 */
export interface Entity<M extends Record<string, unknown> = Record<string, unknown>> {

    /**
     * ID of the entity
     */
    id: string | number;

    /**
     * A string representing the path of the referenced document (relative
     * to the root of the database).
     */
    path: string;

    /**
     * Current values
     */
    values: EntityValues<M>;

    /**
     * Why this entity is in a search result: which declared fields matched, and
     * the text around each hit.
     *
     * Present only on rows returned by a search that asked for it. A sibling of
     * `values` rather than a key inside it, because it describes the *query*,
     * not the record — nothing in the collection declares it, no form edits it,
     * and a record fetched by id never has one.
     */
    searchMatches?: SearchMatch[];

    /**
     * The version of the row this entity was read at: the `ETag` the read
     * reported, for a `findById`, a `PATCH` answer or a live row frame. A
     * form saves with it as `If-Match`, so a write made against a version
     * someone has since replaced is refused instead of reverting their change.
     *
     * Absent for a row from a list, from a cache, or from a server or data
     * source that does not report versions — a save then is unconditional,
     * as it always was.
     */
    etag?: string;

    /**
     * Which driver this entity belongs to (e.g., 'postgres', 'firestore').
     * If not specified, the default driver is assumed.
     */
    driver?: string;

    /**
     * Which database within the driver (e.g., for Firestore multi-database).
     * If not specified, the default database of the driver is used.
     */
    databaseId?: string;
}

/**
 * This type represents a record of key value pairs as described in an
 * entity collection.
 * @group Models
 */
export type EntityValues<M extends Record<string, unknown>> = M;
