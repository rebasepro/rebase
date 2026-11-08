/**
 * Where a record appears on your live site, shown as a link on the record.
 * Handed the record as the server sends the row — dates as ISO strings, a
 * belongsTo as its foreign-key column — with its `id` and the collection
 * `path` it is at (subcollection segments included).
 *
 * @group Models
 */
export type EntityLinkBuilder = (params: {
    row: Record<string, unknown>;
    id: string | number;
    path: string;
}) => string;
