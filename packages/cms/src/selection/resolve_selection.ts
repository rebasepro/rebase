import { CollectionConfig, Entity, FindParams, OrderByTuple, RebaseSdkData } from "@rebasepro/types";
import { EntitySelection, RowSelection, SelectionQuery } from "@rebasepro/cms-types";
import { buildCompositeId, resolvePrimaryKeys } from "@rebasepro/common";
import { getRelationIncludeParams } from "@rebasepro/app";
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

/**
 * What {@link resolveSelection} takes: a view's selection, and where its rows
 * are read.
 */
export interface ResolveSelectionParams<M extends Record<string, unknown>> {
    /** `selectionController.selection`. */
    selection: RowSelection<M>;
    /** `context.data`: where a query selection's rows are read. */
    data: Pick<RebaseSdkData, "collection">;
    /** The selection's collection: what a row's id is read by. */
    collection: CollectionConfig;
    pageSize?: number;
    maxRows?: number;
    /** Called after every page, so a long resolve can show where it is. */
    onProgress?: (loaded: number, total: number | undefined) => void;
    /** Checked between pages; aborting returns the rows read so far. */
    signal?: { aborted: boolean };
}

/**
 * {@link resolveEntitySelection}'s parameters: the admin's own selection and
 * the accessor of its own data.
 *
 * @internal
 */
export interface ResolveEntitySelectionParams<M extends Record<string, unknown>> {
    selection: EntitySelection<M>;
    /**
     * Reads the rows a query selection stands for. Only consulted in query
     * mode — an entities selection is already resolved and never hits the
     * network.
     */
    accessor: EntityPageAccessor<M>;
    pageSize?: number;
    maxRows?: number;
    onProgress?: (loaded: number, total: number | undefined) => void;
    signal?: { aborted: boolean };
}

/**
 * The rows a selection covers, as the server sends them — ISO dates, a
 * belongsTo as its foreign key, a relation the view loads nested under its
 * name as REST's `include` returns it — one shape in both modes: a query
 * selection's rows are read with the view's own include.
 *
 * This is the *only* way to get rows out of a query selection, and it is why
 * {@link RowSelection} is a union: a bulk action has to call it, which means
 * it has to deal with the wait, the ceiling and the failure. The array this
 * replaced let the same code path read whatever the view had scrolled — 50 rows
 * of 12,480 — and report success.
 *
 * ```ts
 * const rows = await resolveSelection({ selection, data: context.data, collection });
 * ```
 *
 * @throws When the query matches more than `maxRows` rows.
 */
export async function resolveSelection<M extends Record<string, unknown>>({
    data,
    collection,
    selection,
    ...rest
}: ResolveSelectionParams<M>): Promise<Record<string, unknown>[]> {
    if (selection.type === "rows") {
        rest.onProgress?.(selection.rows.length, selection.rows.length);
        return selection.rows;
    }
    const keys = resolvePrimaryKeys(collection);
    const path = selection.query.path;
    const flat = data.collection<M>(path);
    // The relations the view reads its rows with, so a row read here is the
    // row a ticked one is.
    const include = getRelationIncludeParams(collection);
    // Walked as records, so the rows ticked off are told apart by the id the
    // view addressed them by; handed back as the rows read.
    const accessor: EntityPageAccessor<M> = {
        find: async (findParams) => {
            const page = await flat.find(include ? { ...findParams, include } : findParams);
            return {
                data: page.data.map((row) => ({ id: idOf(row, keys), path, values: row })),
                meta: page.meta
            };
        }
    };
    // The ceiling is checked against the rows left once the exclusions are
    // taken out, as the admin's own resolve checks it.
    const count = selection.count === undefined ? undefined : selection.count - selection.excludedIds.length;
    const entities = await resolveEntitySelection<M>({
        ...rest,
        selection: { type: "query", query: selection.query, excluded: [], count },
        accessor
    });
    const excluded = new Set<string>(selection.excludedIds.map(String));
    return entities.filter((entity) => !excluded.has(String(entity.id))).map((entity) => entity.values);
}

function idOf(row: Record<string, unknown>, keys: ReturnType<typeof resolvePrimaryKeys>): string {
    if (keys.length > 0) return buildCompositeId(row, keys);
    const id = row.id;
    return typeof id === "string" || typeof id === "number" ? String(id) : "";
}

/**
 * {@link resolveSelection} for the admin's own selection: the records it
 * covers, in its `Entity` view model, read through `accessor`.
 *
 * @throws When the query matches more than `maxRows` rows.
 * @internal
 */
export async function resolveEntitySelection<M extends Record<string, unknown>>({
    selection,
    accessor,
    pageSize = SELECTION_PAGE_SIZE,
    maxRows = MAX_SELECTION_ROWS,
    onProgress,
    signal
}: ResolveEntitySelectionParams<M>): Promise<Entity<M>[]> {

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
