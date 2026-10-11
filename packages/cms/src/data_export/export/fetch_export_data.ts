import { Entity, FindParams, MAX_LIST_LIMIT } from "@rebasepro/types";
import { EntityPageAccessor, forEachEntityPage, walkEntityPages } from "../../util/entity_pages";

/**
 * Rows asked for per request: the server's `MAX_LIST_LIMIT`, the largest page a
 * read will serve — it *refuses* anything larger. (It used to clamp silently,
 * and asking for 100 000 while receiving 1 000 looked exactly like a collection
 * with 1 000 rows in it.) The walk still never trusts the page size it asked
 * for: it advances by the rows it was actually handed. It was 500, which made a
 * 100 000-row export 200 sequential requests, each with its own count.
 */
export const EXPORT_PAGE_SIZE = MAX_LIST_LIMIT;

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
        onCeiling: exportCeilingMessage
    });
}

/**
 * {@link fetchAllEntitiesForExport}, handing each page to `onPage` as it is
 * read instead of collecting every row: for an export that writes its file as
 * it goes (CSV), so that what it holds is the file and one page, not every
 * entity in it.
 *
 * @throws When more than `maxRows` rows match.
 */
export async function forEachEntityPageForExport<M extends Record<string, unknown>>({
    accessor,
    params,
    pageSize = EXPORT_PAGE_SIZE,
    maxRows = MAX_EXPORT_ROWS,
    onProgress,
    onPage
}: FetchAllForExportParams<M> & {
    onPage: (page: Entity<M>[]) => void | Promise<void>;
}): Promise<void> {
    return forEachEntityPage<M>({
        accessor,
        params,
        pageSize,
        maxRows,
        onProgress,
        onPage,
        onCeiling: exportCeilingMessage
    });
}

function exportCeilingMessage(max: number): string {
    return `This export would contain more than ${max.toLocaleString()} rows, which is more than the ` +
        "browser can build in one file. Filter the collection down, or export it from the server.";
}
