import { Entity, FindParams, OrderByTuple } from "@rebasepro/types";
import { EntitySelection, SelectionQuery } from "@rebasepro/cms-types";
import { EntityPageAccessor, walkEntityPages } from "../util/entity_pages";

/**
 * Rows asked for per request while resolving a query selection.
 *
 * Same ceiling as the export walk, and for the same reason: the server refuses
 * a `limit` above its `MAX_LIST_LIMIT` rather than clamping it.
 */
export const SELECTION_PAGE_SIZE = 500;

/**
 * Most rows one query selection will resolve to ids for.
 *
 * The write path is per-row — `deleteMany` loops the single-row delete server
 * side so hooks and row-level security still run for each — so this is a
 * genuine ceiling on the work, not just on memory. Going over it **throws**
 * rather than acting on a prefix, which is the failure that cannot be seen:
 * "deleted 12,480 rows" reads identically whether it was all of them or the
 * first page.
 */
export const MAX_SELECTION_ROWS = 20_000;

/**
 * A stable string for a selection query, for comparing the query a selection
 * was made against with the one the view is showing now.
 *
 * Filter keys are sorted: `filterValues` is rebuilt on most renders and its key
 * order follows whatever order the user touched the columns in, so a plain
 * `JSON.stringify` would report the same filter as a different one and drop a
 * selection the moment anything re-rendered.
 */
export function serializeSelectionQuery<M extends Record<string, unknown>>(query: SelectionQuery<M>): string {
    const filter = query.filterValues
        ? Object.keys(query.filterValues).sort()
            .map(k => `${k}=${JSON.stringify((query.filterValues as Record<string, unknown>)[k])}`)
            .join("&")
        : "";
    const order = query.sortBy?.map(([field, direction]) => `${String(field)}:${direction}`).join(",") ?? "";
    return `${query.path}|${filter}|${order}|${query.searchString ?? ""}`;
}

/** Turn a captured selection query into the `find` params that reproduce it. */
export function selectionQueryToFindParams<M extends Record<string, unknown>>(
    query: SelectionQuery<M>
): Omit<FindParams<M>, "limit" | "offset" | "page"> {
    const where = query.filterValues && Object.keys(query.filterValues).length > 0
        ? query.filterValues
        : undefined;
    const orderBy = query.sortBy && query.sortBy.length > 0
        ? query.sortBy.map(([field, direction]) => [String(field), direction] as OrderByTuple)
        : undefined;
    return {
        where,
        orderBy,
        searchString: query.searchString
    } as Omit<FindParams<M>, "limit" | "offset" | "page">;
}

export interface ResolveSelectionParams<M extends Record<string, unknown>> {
    selection: EntitySelection<M>;
    /**
     * Reads the rows a query selection stands for. Only consulted in query
     * mode — an entities selection is already resolved and never hits the
     * network.
     */
    accessor: EntityPageAccessor<M>;
    pageSize?: number;
    maxRows?: number;
    /** Called after every page, so a long resolve can show where it is. */
    onProgress?: (loaded: number, total: number | undefined) => void;
    /** Checked between pages; aborting returns the rows read so far. */
    signal?: { aborted: boolean };
}

/**
 * The rows a selection covers.
 *
 * This is the *only* way to get rows out of a query selection, and it is why
 * {@link EntitySelection} is a union: a bulk action has to call it, which means
 * it has to deal with the wait, the ceiling and the failure. The array this
 * replaced let the same code path read whatever the view had scrolled — 50 rows
 * of 12,480 — and report success.
 *
 * @throws When the query matches more than `maxRows` rows.
 */
export async function resolveSelection<M extends Record<string, unknown>>({
    selection,
    accessor,
    pageSize = SELECTION_PAGE_SIZE,
    maxRows = MAX_SELECTION_ROWS,
    onProgress,
    signal
}: ResolveSelectionParams<M>): Promise<Entity<M>[]> {

    if (selection.type === "entities") {
        onProgress?.(selection.entities.length, selection.entities.length);
        return selection.entities;
    }

    // The count was taken when the selection was made, so it can only be a
    // forecast — but it is the one the user was shown and agreed to, and
    // refusing before the walk beats refusing forty pages in.
    if (selection.count !== undefined && selection.count - selection.excluded.length > maxRows)
        throw new Error(selectionCeilingMessage(maxRows));

    const rows = await walkEntityPages<M>({
        accessor,
        params: selectionQueryToFindParams(selection.query),
        pageSize,
        maxRows,
        onProgress,
        signal,
        onCeiling: selectionCeilingMessage
    });

    if (selection.excluded.length === 0) return rows;

    const excluded = new Set(selection.excluded.map(e => `${e.path}/${e.id}`));
    return rows.filter(e => !excluded.has(`${e.path}/${e.id}`));
}

function selectionCeilingMessage(maxRows: number): string {
    return `This selection covers more than ${maxRows.toLocaleString()} rows, which is more than ` +
        "can be acted on from the browser in one go. Filter the collection down first.";
}
