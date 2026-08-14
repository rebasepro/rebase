
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router";

import { useData, useRebaseContext } from "../../hooks";
import { useDataOrder } from "../../hooks/data/useDataOrder";
import { populateFetchCache } from "../../hooks/data/useFetch";
import { toFindParams } from "../../hooks/data/collectionQuery";
import { getRelationIncludeParams } from "../../util/previews";
import { Entity, EntityReference, EntityRelation, FilterValues, OrderBySpec, OrderByTuple, User, WhereFilterOp, FindResponse } from "@rebasepro/types";
import { normalizeOrderBy, serializeOrderBy } from "@rebasepro/common";
import { EntityTableController, RebaseContext, SelectedCellProps, AdminCollection } from "@rebasepro/admin-types";
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
        lastDeleteTimestamp: _lastDeleteTimestamp,
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
    const pageSize = typeof collection.pagination === "number" ? collection.pagination : DEFAULT_PAGE_SIZE;

    const location = useLocation();

    const [searchString, setSearchString] = React.useState<string | undefined>(() => {
        if (updateUrl) {
            const params = new URLSearchParams(location.search);
            const urlSearch = params.get("search");
            return urlSearch ? decodeURIComponent(urlSearch) : undefined;
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
    // Skip initial mount since useState initializers already handle URL params + collection defaults.
    const initialSearchRef = React.useRef<string | null>(location.search);
    useEffect(() => {
        if (!updateUrl) return;
        // Skip the initial mount - useState already set the correct values
        if (initialSearchRef.current !== null && initialSearchRef.current === location.search) {
            initialSearchRef.current = null;
            return;
        }
        initialSearchRef.current = null;

        const { filterValues: urlFilterValues, sortBy: urlSortBy } = parseFilterAndSort(location.search);
        if (!fixedFilter) {
            setFilterValues((urlFilterValues ?? defaultFilter) as FilterValues<Extract<keyof M, string> | (string & {})> | undefined);
        }
        if (urlSortBy && fixedFilter && !checkFilterCombination(fixedFilter, urlSortBy)) {
            console.warn("URL sort is not compatible with the force filter.");
        } else {
            setSortBy(urlSortBy as OrderByTuple<Extract<keyof M, string> | (string & {})>[] | undefined);
        }

        // Sync search string from URL
        const urlParams = new URLSearchParams(location.search);
        const urlSearch = urlParams.get("search");
        setSearchString(urlSearch ? decodeURIComponent(urlSearch) : undefined);
    }, [location.search, updateUrl, fixedFilter, checkFilterCombination]);

    useUpdateUrl(filterValues, sortBy, searchString, updateUrl);

    const collectionScroll = scrollRestoration?.getCollectionScroll(path, filterValues);
    const initialItemCount = collectionScroll?.data.length ?? pageSize;

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

    const clearFilter = useCallback(() => setFilterValues(fixedFilter ?? defaultFilter ?? undefined), [fixedFilter, defaultFilter]);

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

    useEffect(() => {

        setDataLoading(true);

        const onEntitiesUpdate = async (entities: Entity<M>[]) => {
            if (collection.callbacks?.afterRead) {
                try {
                    // afterRead operates on flat rows; unwrap the Entity view-model
                    // before invoking and re-wrap the processed row after.
                    entities = await Promise.all(
                        entities.map(async (entity) => {
                            const processedRow = await collection.callbacks!.afterRead!({
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
            unsubscribe = () => undefined;
        }

        return unsubscribe;
    }, [dataClient, path, itemCount, sortKey, filterValues, searchString]);

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
    updateUrl: boolean | undefined
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

            const filterSortState = encodeFilterAndSort(filterValues, sortBy);
            const search = searchString ? `search=${encodeURIComponent(searchString)}` : "";

            // Combine preserved params with filter/sort state
            const preservedString = preservedParams.toString();
            const parts = [preservedString, filterSortState, search].filter(Boolean);
            const state = parts.join("&");

            const hash = window.location.hash;
            if (state === "")
                window.history.replaceState({}, "", `${window.location.pathname}${hash}`);
            else
                window.history.replaceState({}, "", `?${state}${hash}`);
        }
    }, [filterValues, sortBy, searchString, updateUrl]);
}

function encodeFilterAndSort(filterValues?: FilterValues<string>, sortBy?: OrderByTuple[] | undefined) {
    const entries: Record<string, string> = {};
    if (sortBy && sortBy.length > 0) {
        // Comma-separated, positionally paired. A single key encodes exactly as
        // it did before — `__sort=name&__sort_order=asc` — so links already out
        // in the world keep working, and a reload of a two-key sort no longer
        // silently comes back sorted by the first key alone.
        entries["__sort"] = sortBy.map(([field]) => encodeURIComponent(field)).join(",");
        entries["__sort_order"] = sortBy.map(([, direction]) => direction).join(",");
    }
    if (filterValues) {
        Object.entries(filterValues).forEach(([key, value]) => {
            if (value) {
                const conditions: [WhereFilterOp, unknown][] = Array.isArray(value[0])
                    ? (value as [WhereFilterOp, unknown][])
                    : [value as [WhereFilterOp, unknown]];

                const [op, val] = conditions[0] || [];
                if (op) {
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
                        entries[encodeURIComponent(`${key}_op`)] = encodeURIComponent(op);
                        entries[encodeURIComponent(`${key}_value`)] = encodedValue ? encodeURIComponent(String(encodedValue)) : "null";
                    }
                }
            }
        });
    }
    if (!Object.keys(entries).length) {
        return "";
    }
    return Object.entries(entries).map(([key, value]) => `${key}=${value}`).join("&");
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
        } else if (key.endsWith("_op")) {
            const field = key.replace("_op", "");
            const filterOp = decodeURIComponent(value) as WhereFilterOp;
            const filterValStr = entries.get(`${field}_value`);
            if (filterValStr !== null) {
                filterValues[field] = [filterOp, decodeString(filterValStr)];
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
