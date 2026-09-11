import { Entity, FindParams } from "@rebasepro/types";
import { EntityPageAccessor, walkEntityPages } from "../../util/entity_pages";

/**
 * Rows asked for per request.
 *
 * Kept at or below the server's `MAX_LIST_LIMIT`, which is now the largest page
 * a read will serve *and refuses* anything larger — it used to clamp silently,
 * and asking for 100 000 while receiving 1 000 looked exactly like a collection
 * with 1 000 rows in it. The walk still never trusts the page size it asked for:
 * it advances by the rows it was actually handed.
 */
export const EXPORT_PAGE_SIZE = 500;

/**
 * Most rows one browser-side export will materialise.
 *
 * Everything here is built in memory and handed to a Blob, so there is a
 * ceiling whether or not it is named. Naming it means going over it **throws**
 * instead of writing a short file that reads like the whole collection.
 */
export const MAX_EXPORT_ROWS = 100_000;

export interface FetchAllForExportParams<M extends Record<string, unknown>> {
    /** The collection accessor to read through — `dataClient.collection(path)`. */
    accessor: EntityPageAccessor<M>;
    /** Query to export. The window (`limit` / `offset` / `page`) is owned by the walk. */
    params?: Omit<FindParams<M>, "limit" | "offset" | "page">;
    pageSize?: number;
    maxRows?: number;
    /** Called after every page with the rows so far, and the total when the server reports one. */
    onProgress?: (loaded: number, total: number | undefined) => void;
}

/**
 * Read **every** row matching a query, for an export file.
 *
 * The export used to hand back the 50 rows an unwindowed `find({})` resolves to
 * as `<collection>.csv`, with nothing saying it was a sample, next to a dialog
 * warning that the collection had 100 000 documents. The walk is in
 * {@link walkEntityPages}; what belongs to export is the ceiling — an export is
 * built in memory and handed to a Blob — and what to say on hitting it.
 *
 * @throws When more than `maxRows` rows match.
 */
export async function fetchAllEntitiesForExport<M extends Record<string, unknown>>({
    accessor,
    params,
    pageSize = EXPORT_PAGE_SIZE,
    maxRows = MAX_EXPORT_ROWS,
    onProgress
}: FetchAllForExportParams<M>): Promise<Entity<M>[]> {
    return walkEntityPages<M>({
        accessor,
        params,
        pageSize,
        maxRows,
        onProgress,
        onCeiling: (max) =>
            `This export would contain more than ${max.toLocaleString()} rows, which is more than the ` +
            "browser can build in one file. Filter the collection down, or export it from the server."
    });
}
