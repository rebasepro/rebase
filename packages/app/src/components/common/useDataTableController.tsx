
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router";

import { useData, useRebaseContext } from "../../hooks";
import { useDataOrder } from "../../hooks/data/useDataOrder";
import { populateFetchCache } from "../../hooks/data/useFetch";
import { toFindParams } from "../../hooks/data/collectionQuery";
import { getRelationIncludeParams } from "../../util/previews";
import { Entity, EntityReference, EntityRelation, FilterValues, OrderBySpec, OrderByTuple, User, WhereFilterOp, FindResponse } from "@rebasepro/types";
import { normalizeOrderBy, serializeOrderBy } from "@rebasepro/common";
import { EntityTableController, RebaseContext, SelectedCellProps, AdminCollection } from "@rebasepro/cms-types";
import { ScrollRestorationController } from "./useScrollRestoration";

export const DEFAULT_PAGE_SIZE = 50;

export type DataTableControllerProps<M extends Record<string, any> = any> = {
    /**
     * Full path where the data of this table is located
     */
    path: string;
    /**
     * The collection that is represented by this config.
     */
    collection: AdminCollection<M>;
    /**
     * List of entities that will be displayed on top, no matter the ordering.
     * This is used for reference fields selection
     */
    entitiesDisplayedFirst?: Entity<M>[];

    lastDeleteTimestamp?: number;

    /**
     * Force filter to be applied to the table.
     */
    fixedFilter?: FilterValues<string>;

    scrollRestoration?: ScrollRestorationController;

    /**
     * When set to true the filters and sort will be updated in the URL
     */
    updateUrl?: boolean;

}

/**
 * Use this hook to build a controller for the {@link DataCollectionTable}.
 * This controller is bound to data in a path in your specified driver.
 *
 * Note that you can build your own hook returning a {@link EntityTableController}
 * if you would like to display different data.
 *
 * @param path
 * @param collection
 * @param scrollRestoration
 * @param entitiesDisplayedFirst
 * @param lastDeleteTimestamp
 * @param fixedFilterFromProps
 * @param updateUrl
 */
export function useDataTableController<M extends Record<string, any> = any, USER extends User = User>(
    {
        path,
        collection,
        scrollRestoration,
        entitiesDisplayedFirst,
        lastDeleteTimestamp,
        fixedFilter: fixedFilterFromProps,
        updateUrl
    }: DataTableControllerProps<M>)
    : EntityTableController<M> {

    const {
        defaultFilter,
        sort,
        fixedFilter: fixedFilterFromCollection
    } = collection;

    const [popupCell, setPopupCell] = React.useState<SelectedCellProps<M> | undefined>(undefined);
    const dataClient = useData();

    const fixedFilter = fixedFilterFromProps ?? fixedFilterFromCollection;
    const paginationEnabled = collection.pagination === undefined || Boolean(collection.pagination);
    // `pagination: 0` says *disabled*, not "a page of no rows" — which is why
    // it does not reach `paginationEnabled` above. It must not reach the page
    // size either: this value is handed on to the card, board and relation
    // views as the number of rows each of them reads, and a zero there is a
    // `limit=0` the API refuses.
    const pageSize = typeof collection.pagination === "number" && collection.pagination > 0
        ? collection.pagination
        : DEFAULT_PAGE_SIZE;

    const location = useLocation();

    const [searchString, setSearchString] = React.useState<string | undefined>(() => {
        if (updateUrl) {
            return parseSearchString(location.search);
        }
        return undefined;
    });

    const checkFilterCombination = useCallback((filterValues: FilterValues<any>,
        sortBy?: OrderByTuple[]) => {
        // PostgREST/SQL can handle arbitrary filter/sort combinations natively.
        return true;
    }, []);

    // The collection's default, in the list form the controller works in.
    // `collection.sort` accepts either spelling so a one-key default stays the
    // one-liner it always was.
    const sortInternal = useMemo(() => {
        const keys = normalizeOrderBy(sort as OrderBySpec | undefined);
        if (keys && fixedFilter && !checkFilterCombination(fixedFilter, keys)) {
            console.warn("Initial sort is not compatible with the force filter. Ignoring initial sort");
            return undefined;
        }
        return keys;
    }, [sort, fixedFilter]);

    const {
        filterValues: filterUrl,
        sortBy: sortUrl
    } = parseFilterAndSort(location.search);

    const [filterValues, setFilterValues] = React.useState<FilterValues<Extract<keyof M, string> | (string & {})> | undefined>(fixedFilter ?? (updateUrl ? filterUrl : undefined) ?? defaultFilter ?? undefined);
    const [sortBy, setSortBy] = React.useState<OrderByTuple<Extract<keyof M, string> | (string & {})>[] | undefined>((updateUrl ? sortUrl : undefined) ?? sortInternal);

    // Sync filter/sort state from URL on browser navigation (back/forward).
    //
    // Only ever on an actual *change* of the URL, which is not the same as "not
    // the first run". `useUpdateUrl` writes with `window.history.replaceState`,
    // which react-router does not observe, so the `location` read here keeps
    // reporting the search string this view was mounted with — normally the
    // empty one — no matter what the address bar says. The guard used to be a
    // one-shot ref that skipped the first run and armed itself for every run
    // after; the *second* run then parsed that unchanged, empty search and
    // called `setSortBy(undefined)`, throwing away the collection's `sort`
    // before anything had asked for a different one. Re-running is easy to
    // trigger — this effect depends on `fixedFilter`, a prop most callers pass
    // as a fresh object literal.
    //
    // The visible symptom was a collection that ignored its own default sort: it
    // subscribed correctly, then immediately re-subscribed with no `orderBy` at
    // all, and the second answer replaced the first.
    //
    // Nor on a URL that only repeats what this hook wrote. Opening a record
    // carries the address bar's query onto the record URL (`withListState`), so
    // react-router reports a new `location.search` that is this hook's own
    // state coming back. Parsing it into the live filter made every record
    // click a round trip through the URL format, and the URL cannot say
    // everything the state can: an absent filter param reads back as "the
    // collection's default", so a default the user had cleared came straight
    // back on the next click.
    const lastSyncedSearchRef = React.useRef<string>(location.search);
    const lastWrittenListStateRef = React.useRef<string | undefined>(undefined);
    useEffect(() => {
        if (!updateUrl) return;
        // Unchanged URL — including the initial mount, where the state
        // initialisers have already applied the URL params and the collection
        // defaults — carries nothing to sync.
        if (lastSyncedSearchRef.current === location.search) return;
        lastSyncedSearchRef.current = location.search;

        const { filterValues: urlFilterValues, sortBy: urlSortBy } = parseFilterAndSort(location.search);
        const urlSearchString = parseSearchString(location.search);
        if (encodeListState(urlFilterValues, urlSortBy, urlSearchString) === lastWrittenListStateRef.current) return;

        if (!fixedFilter) {
            setFilterValues((urlFilterValues ?? defaultFilter) as FilterValues<Extract<keyof M, string> | (string & {})> | undefined);
        }
        if (urlSortBy && fixedFilter && !checkFilterCombination(fixedFilter, urlSortBy)) {
            console.warn("URL sort is not compatible with the force filter.");
        } else {
            // No `__sort` is the collection's default, the same reading the
            // state initialiser gives it on mount — not "no sort at all".
            setSortBy((urlSortBy ?? sortInternal) as OrderByTuple<Extract<keyof M, string> | (string & {})>[] | undefined);
        }

        setSearchString(urlSearchString);
    }, [location.search, updateUrl, fixedFilter, checkFilterCombination, sortInternal]);

    useUpdateUrl(filterValues, sortBy, searchString, updateUrl, lastWrittenListStateRef);

    const collectionScroll = scrollRestoration?.getCollectionScroll(path, filterValues);
    /**
     * How many rows to ask for on mount: as many as were loaded last time this
     * (path, filters) pair was on screen, so returning to a view that had been
     * scrolled does not snap back to the first page.
     *
     * The floor is not cosmetic. This used to be `?? pageSize`, which falls back
     * on `null`/`undefined` but not on `0` — and a saved entry whose `data` is
     * empty is entirely ordinary: `updateCollectionScroll` records what was on
     * screen, so any filter combination matching no rows persists `data: []`
     * under its own key. Restoring that gave `itemCount === 0`, which became
     * `limit=0` on the read, which the API rejects (400 `INVALID_LIMIT`) —
     * the collection rendered an error instead of a table, and a client bug
     * read as an API failure.
     *
     * The cache is left free to record an empty view honestly: that it *was*
     * empty is a true fact, and refusing to store it would leave the previous,
     * now-wrong offset and rows in place for a view whose rows have gone. What
     * is wrong is reading "nothing was restored" as "ask for nothing".
     */
    const restoredItemCount = collectionScroll?.data.length ?? 0;
    const initialItemCount = restoredItemCount > 0 ? restoredItemCount : pageSize;

    useEffect(() => {
        if (scrollRestoration) {
            scrollRestoration.updateCollectionScroll({
                path,
                scrollOffset: collectionScroll?.scrollOffset ?? 0,
                data: rawData,
                filters: filterValues
            });
        }
    }, []);

    const [itemCount, setItemCount] = React.useState<number | undefined>(paginationEnabled ? initialItemCount : undefined);

    // The whole sort, as one string, so the effect below re-runs when any key
    // changes — a `sortBy` array is a new reference on every render and would
    // re-subscribe on each one if used as a dependency directly.
    const sortKey = sortBy ? serializeOrderBy(sortBy) : undefined;

    const context: RebaseContext<USER> = useRebaseContext();

    const [rawData, setRawData] = useState<Entity<M>[]>(collectionScroll?.data ?? []);

    const onScroll = useCallback(({
        scrollOffset
    }: {
        scrollOffset: number
    }) => {
        if (scrollRestoration) {
            scrollRestoration.updateCollectionScroll({
                path,
                scrollOffset,
                data: rawData,
                filters: filterValues
            });
        }
    }, [scrollRestoration, path, rawData, filterValues]);

    const [dataLoading, setDataLoading] = useState<boolean>(false);
    const [dataLoadingError, setDataLoadingError] = useState<Error | undefined>();
    const [noMoreToLoad, setNoMoreToLoad] = useState<boolean>(false);

    /**
     * Clear the user's filters. `fixedFilter` survives — it is the collection
     * forcing a scope, not something the user chose — but `defaultFilter` does
     * not: a default is where the view *opens*, not a floor it can never go
     * below.
     *
     * It used to reset to `defaultFilter`, which made "clear" unable to clear
     * whenever a collection defined one, and every caller here wanted the
     * opposite. `ClearFilterSortButton` is labelled "clear filter" and left one
     * set. `EditorCollectionActionStart` calls this and then re-applies
     * `collection.defaultFilter` on the next line — redundant under the old
     * behaviour, and the clearest statement of what it expected.
     * `FilterPresetsButton` documents "clearing all filters deactivates all
     * chips", which was false: it derives a chip's active state from the
     * filters, so a preset whose values equalled `defaultFilter` switched
     * itself straight back on. That chip could not be turned off at all — click
     * it, the keys are removed, the filter resets to the identical default, and
     * the chip lights up again.
     */
    const clearFilter = useCallback(() => setFilterValues(fixedFilter ?? undefined), [fixedFilter]);

    const updateFilterValues = useCallback((updatedFilter: FilterValues<Extract<keyof M, string> | (string & {})> | undefined) => {
        if (fixedFilter) {
            console.warn("Filter is not compatible with the force filter. Ignoring filter");
            return;
        }
        if (updatedFilter && Object.keys(updatedFilter).length === 0) {
            setFilterValues(undefined);
        } else {
            setFilterValues(updatedFilter);
        }
    }, [fixedFilter]);

    // Without realtime the rows are one `find` per query, so nothing tells
    // the table a row went away. `lastDeleteTimestamp` is how the collection
    // view says it did (a delete, or linking existing rows), and a re-read is
    // the only way to show it. A live subscription already delivers the
    // change, so it is left alone.
    const canListen = Boolean(dataClient.collection(path).listen);
    const oneShotReadKey = canListen ? undefined : lastDeleteTimestamp;

    useEffect(() => {

        // Cleared by this run's cleanup. A one-shot read has nothing to
        // unsubscribe from, so without it an answer for a superseded query
        // (the "ch" typed before "chair") landed on top of the newer one.
        let cancelled = false;

        setDataLoading(true);

        const onEntitiesUpdate = async (entities: Entity<M>[]) => {
            // `browserCallbacks`, not `callbacks`: the server has already run
            // its own `afterRead` before these rows arrived, and running that
            // one again here applied it twice. This block is the panel's.
            if (collection.browserCallbacks?.afterRead) {
                try {
                    // afterRead operates on flat rows; unwrap the Entity view-model
                    // before invoking and re-wrap the processed row after.
                    entities = await Promise.all(
                        entities.map(async (entity) => {
                            const processedRow = await collection.browserCallbacks!.afterRead!({
                                collection,
                                path,
                                row: { id: entity.id, ...entity.values },
                                context
                            });
                            return {
                                ...entity,
                                values: processedRow as M
                            };
                        }));
                } catch (_e: unknown) {
                    console.error(_e);
                }
            }
            if (cancelled) return;
            setDataLoading(false);
            setDataLoadingError(undefined);
            setRawData(entities.map(e => ({
                ...e
                // values: sanitizeData(e.values, resolvedCollection.properties)
            })));
            setNoMoreToLoad(!itemCount || entities.length < itemCount);

            // Pre-populate the entity fetch cache so that navigating to an
            // entity detail view renders instantly with cached data.
            populateFetchCache(path, entities);
        };

        const onError = (error: Error) => {
            if (cancelled) return;
            console.error("ERROR", error);
            setDataLoading(false);
            setRawData((prev) => prev && prev.length > 0 ? prev : []);
            setDataLoadingError(error);
        };

        const accessor = dataClient.collection(path);

        // filterValues is already FilterValues — pass directly to the accessor
        const whereParams = filterValues && Object.keys(filterValues).length > 0 ? filterValues : undefined;
        const orderByParams = sortBy && sortBy.length > 0
            ? sortBy.map(([field, direction]) => [String(field), direction] as OrderByTuple)
            : undefined;

        let unsubscribe: (() => void) | undefined;

        // Eagerly include relations to avoid N+1 fetches.
        const includeParams = getRelationIncludeParams(collection);

        if (accessor.listen) {
            // Assembled in one place — see `toFindParams`. Listing the fields
            // here is what let `searchExplain` reach three of four read paths.
            unsubscribe = accessor.listen(
                toFindParams({ where: whereParams, limit: itemCount, orderBy: orderByParams,
                    searchString, include: includeParams }),
                (res) => onEntitiesUpdate(res.data as Entity<M>[]), onError);
        } else {
            accessor.find(
                toFindParams({ where: whereParams, limit: itemCount, orderBy: orderByParams,
                    searchString, include: includeParams }))
                .then((res) => onEntitiesUpdate(res.data as Entity<M>[]))
                .catch(onError);
        }

        return () => {
            cancelled = true;
            unsubscribe?.();
        };
    }, [dataClient, path, itemCount, sortKey, filterValues, searchString, oneShotReadKey]);

    const orderedData = useDataOrder({
        data: rawData,
        entitiesDisplayedFirst
    });

    // hack to fix Firestore listeners firing with incomplete data
    // const data = useDebouncedData(orderedData, {
    //     filterValues,
    //     sortBy,
    //     searchString,
    //     lastDeleteTimestamp
    // });
    const data = orderedData;

    return useMemo(() => ({
        data,
        dataLoading,
        noMoreToLoad,
        dataLoadingError,
        filterValues,
        setFilterValues: updateFilterValues,
        sortBy,
        setSortBy,
        searchString,
        setSearchString,
        clearFilter,
        itemCount,
        setItemCount,
        initialScroll: collectionScroll?.scrollOffset,
        onScroll,
        paginationEnabled,
        pageSize,
        checkFilterCombination,
        popupCell,
        setPopupCell
    }), [
        data,
        dataLoading,
        noMoreToLoad,
        dataLoadingError,
        filterValues,
        updateFilterValues,
        sortBy,
        searchString,
        clearFilter,
        itemCount,
        collectionScroll?.scrollOffset,
        onScroll,
        paginationEnabled,
        pageSize,
        checkFilterCombination,
        popupCell
    ]);
}

function useUpdateUrl<M extends Record<string, any> = any>(
    filterValues: FilterValues<Extract<keyof M, string>> | undefined,
    sortBy: OrderByTuple<Extract<keyof M, string>>[] | undefined,
    searchString: string | undefined,
    updateUrl: boolean | undefined,
    lastWrittenListStateRef: React.MutableRefObject<string | undefined>
) {

    useEffect(() => {
        if (updateUrl) {
            // Parse existing URL params to preserve non-filter/sort params like __view
            const existingParams = new URLSearchParams(window.location.search);
            const preservedParams = new URLSearchParams();

            // Preserve params that are not filter/sort related
            existingParams.forEach((value, key) => {
                if (key.startsWith("__") && key !== "__sort" && key !== "__sort_order") {
                    preservedParams.set(key, value);
                }
            });

            const listState = encodeListState(filterValues, sortBy, searchString);
            lastWrittenListStateRef.current = listState;

            // Combine preserved params with filter/sort state
            const preservedString = preservedParams.toString();
            const parts = [preservedString, listState].filter(Boolean);
            const state = parts.join("&");

            // The entry's existing state goes back in unchanged: react-router
            // keeps its `idx` and `key` there. Replacing it with `{}` left Back
            // with no index to compute a delta from, and react-router lets a
            // POP with no delta through without asking any blocker — every
            // unsaved-changes guard was skipped.
            const hash = window.location.hash;
            if (state === "")
                window.history.replaceState(window.history.state, "", `${window.location.pathname}${hash}`);
            else
                window.history.replaceState(window.history.state, "", `?${state}${hash}`);
        }
    }, [filterValues, sortBy, searchString, updateUrl]);
}

/**
 * The part of the query string this hook owns — filters, sort and search — in
 * the one canonical spelling, so two states can be compared by what they would
 * write.
 */
function encodeListState(filterValues: FilterValues<string> | undefined,
    sortBy: OrderByTuple[] | undefined,
    searchString: string | undefined): string {
    const search = searchString ? `search=${encodeURIComponent(searchString)}` : "";
    return [encodeFilterAndSort(filterValues, sortBy), search].filter(Boolean).join("&");
}

function parseSearchString(search: string): string | undefined {
    // `URLSearchParams` has already decoded the value. Decoding it a second
    // time threw on any search containing a `%` ("50% off").
    return new URLSearchParams(search).get("search") || undefined;
}

const OP_SUFFIX = "_op";
const VALUE_SUFFIX = "_value";

function encodeFilterAndSort(filterValues?: FilterValues<string>, sortBy?: OrderByTuple[] | undefined) {
    const entries: [string, string][] = [];
    if (sortBy && sortBy.length > 0) {
        // Comma-separated, positionally paired. A single key encodes exactly as
        // it did before — `__sort=name&__sort_order=asc` — so links already out
        // in the world keep working, and a reload of a two-key sort no longer
        // silently comes back sorted by the first key alone.
        entries.push(["__sort", sortBy.map(([field]) => encodeURIComponent(field)).join(",")]);
        entries.push(["__sort_order", sortBy.map(([, direction]) => direction).join(",")]);
    }
    if (filterValues) {
        Object.entries(filterValues).forEach(([key, value]) => {
            if (value) {
                const conditions: [WhereFilterOp, unknown][] = Array.isArray(value[0])
                    ? (value as [WhereFilterOp, unknown][])
                    : [value as [WhereFilterOp, unknown]];

                // One `_op`/`_value` pair per condition, repeated for a field
                // with several (`stock >= 5 AND stock < 10`). A single condition
                // spells exactly as it always has, which is the format links
                // composed outside the admin follow.
                for (const [op, val] of conditions) {
                    if (!op) continue;
                    let encodedValue: unknown = val;
                    try {
                        if (typeof val === "object") {
                            if (val instanceof Date) {
                                encodedValue = val.toISOString();
                            } else if (Array.isArray(val)) {
                                encodedValue = JSON.stringify(val, (k, v) => {
                                    if (v instanceof EntityRelation) {
                                        return encodeRelation(v);
                                    }
                                    if (v instanceof EntityReference) {
                                        return encodeReference(v);
                                    }
                                    return v;
                                });
                            } else if (val instanceof EntityRelation) {
                                encodedValue = encodeRelation(val);
                            } else if (val instanceof EntityReference) {
                                encodedValue = encodeReference(val);
                            }
                        }
                    } catch (e) {
                        encodedValue = val;
                    }
                    if (encodedValue !== undefined) {
                        entries.push([encodeURIComponent(`${key}${OP_SUFFIX}`), encodeURIComponent(op)]);
                        // Only `null` is written as `null`. `false`, `0` and the
                        // empty string are values: read back as `null` they
                        // became an IS NULL filter on the server.
                        entries.push([encodeURIComponent(`${key}${VALUE_SUFFIX}`),
                            encodedValue === null ? "null" : encodeURIComponent(String(encodedValue))]);
                    }
                }
            }
        });
    }
    return entries.map(([key, value]) => `${key}=${value}`).join("&");
}

function parseFilterAndSort<M>(search: string): {
    filterValues: FilterValues<string> | undefined,
    sortBy?: OrderByTuple<Extract<keyof M, string>>[]
} {
    const entries = new URLSearchParams(search);
    const filterValues: FilterValues<string> = {};
    let sortBy: OrderByTuple[] | undefined = undefined;
    entries.forEach((value, key) => {
        if (key === "__sort") {
            const directions = (entries.get("__sort_order") ?? "").split(",");
            const keys = value
                .split(",")
                .map((field) => decodeURIComponent(field).trim())
                .filter(Boolean)
                // A direction missing from the URL — a hand-written link, or the
                // one-key form of an older bookmark — is ascending, the same
                // reading `?orderBy=name` gets everywhere else.
                .map((field, index): OrderByTuple => [field, directions[index] === "desc" ? "desc" : "asc"]);
            sortBy = keys.length > 0 ? keys : undefined;
        } else if (key.endsWith(OP_SUFFIX) && !(key.slice(0, -OP_SUFFIX.length) in filterValues)) {
            // The suffix, not the first `_op` in the name: `shop_open_op`
            // belongs to `shop_open`.
            const field = key.slice(0, -OP_SUFFIX.length);
            const ops = entries.getAll(key);
            const values = entries.getAll(`${field}${VALUE_SUFFIX}`);
            // Paired by position. An operator with no value beside it is half a
            // pair, and guessing the rest would invent a filter.
            const conditions: [WhereFilterOp, unknown][] = ops
                .slice(0, values.length)
                .map((op, index) => [decodeURIComponent(op) as WhereFilterOp, decodeString(values[index])]);
            if (conditions.length === 1) {
                filterValues[field] = conditions[0];
            } else if (conditions.length > 1) {
                filterValues[field] = conditions;
            }
        }
    });

    return {
        filterValues: Object.keys(filterValues).length ? filterValues : undefined,
        sortBy
    }
}

function isDate(dateString: string): boolean {
    // Define a regex pattern that matches the exact date format: 2025-01-07T23:00:00.000Z
    const regexPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

    // Test the dateString against the regex pattern
    if (!regexPattern.test(dateString)) {
        return false;
    }

    // If the regex matches, further validate if it is a valid UTC date
    const date = new Date(dateString);
    return date.toISOString() === dateString;
}

function encodeReference(val: EntityReference) {
    return `ref::${val.path}/${val.id}`;
}
function encodeRelation(val: EntityRelation) {
    return `rel::${val.path}/${val.id}`;
}

function decodeString(val: string): EntityReference | EntityRelation | Date | string {
    let parsedFilterVal: EntityReference | EntityRelation | Date | string = val;
    if (isDate(val)) {
        try {
            parsedFilterVal = new Date(val);
        } catch (_e) {
            // ignore
        }
    }
    if (typeof parsedFilterVal === "string") {
        try {
            parsedFilterVal = JSON.parse(parsedFilterVal, (key, value) => {
                if (typeof value === "string") {
                    if (value.startsWith("ref::")) {
                        const [path, id] = value.substring(5).split("/");
                        return new EntityReference({ id,
path });
                    }
                    if (value.startsWith("rel::")) {
                        const [path, id] = value.substring(5).split("/");
                        return new EntityRelation(id, path);
                    }
                }
                return value;
            });
        } catch (_e) {
            // ignore
        }
    }

    if (typeof parsedFilterVal === "string") {
        if (parsedFilterVal.startsWith("ref::")) {
            const [path, id] = parsedFilterVal.substring(5).split("/");
            return new EntityReference({ id,
path });
        }
        if (parsedFilterVal.startsWith("rel::")) {
            const [path, id] = parsedFilterVal.substring(5).split("/");
            return new EntityRelation(id, path);
        }
    }
    return parsedFilterVal;
}
