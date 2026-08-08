import { Entity, FindParams, FindResponse } from "@rebasepro/types";

/**
 * Rows asked for per request.
 *
 * Kept at or below the server's `MAX_LIST_LIMIT`, which clamps a larger limit
 * *silently* — asking for 100 000 and receiving 1 000 looks exactly like a
 * collection with 1 000 rows. The walk never trusts the page size it asked for:
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
    accessor: { find(params?: FindParams<M>): Promise<FindResponse<M>> };
    /** Query to export. The window (`limit` / `offset` / `page`) is owned by the walk. */
    params?: Omit<FindParams<M>, "limit" | "offset" | "page">;
    pageSize?: number;
    maxRows?: number;
    /** Called after every page with the rows so far, and the total when the server reports one. */
    onProgress?: (loaded: number, total: number | undefined) => void;
}

/**
 * Read **every** row matching a query, one page at a time.
 *
 * `find({})` sends no `limit`, and an absent limit is resolved server-side to
 * `DEFAULT_LIST_LIMIT` — 50 rows. The export used to hand those 50 rows back as
 * `<collection>.csv` with nothing saying it was a sample, next to a dialog
 * warning that the collection had 100 000 documents.
 *
 * Termination is driven by the server's `meta.hasMore` where it is reported and
 * by an empty page otherwise — never by comparing a page's length against the
 * requested limit, since a final page that happens to be exactly full is
 * indistinguishable that way and a walk that stops there drops rows.
 *
 * @throws When more than `maxRows` rows match. A truncated export is worse than
 * no export: it is indistinguishable from a complete one.
 */
export async function fetchAllEntitiesForExport<M extends Record<string, unknown>>({
    accessor,
    params,
    pageSize = EXPORT_PAGE_SIZE,
    maxRows = MAX_EXPORT_ROWS,
    onProgress
}: FetchAllForExportParams<M>): Promise<Entity<M>[]> {

    const rows: Entity<M>[] = [];
    let offset = 0;

    for (;;) {
        const res = await accessor.find({
            ...params,
            limit: pageSize,
            offset
        } as FindParams<M>);

        const page = res?.data ?? [];
        rows.push(...page);
        onProgress?.(rows.length, res?.meta?.total);

        if (rows.length > maxRows) {
            throw new Error(
                `This export would contain more than ${maxRows.toLocaleString()} rows, which is more than the ` +
                "browser can build in one file. Filter the collection down, or export it from the server."
            );
        }

        // An empty page ends the walk whatever the metadata says, so a server
        // that keeps answering `hasMore` cannot spin forever.
        if (page.length === 0) break;
        if (res?.meta && !res.meta.hasMore) break;

        // By rows received, not by `pageSize`: a server whose ceiling is lower
        // than the page we asked for would otherwise skip everything it clamped.
        offset += page.length;
    }

    return rows;
}
