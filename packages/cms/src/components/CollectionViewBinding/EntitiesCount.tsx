import type { OrderByTuple } from "@rebasepro/types";
import { FilterValues } from "@rebasepro/types";
import type { AdminCollection } from "@rebasepro/cms-types";
import { serializeOrderBy } from "@rebasepro/common";
import React, { useEffect } from "react";
import { useData } from "@rebasepro/app";

/**
 * Inflight count request deduplication map.
 * Keyed by `path|filterKey|sort|search` so that concurrent
 * callers (e.g. React StrictMode double-mount) share the same promise.
 */
const inflightCountRequests = new Map<string, Promise<number>>();

export function EntitiesCount({
    path,
    collection,
    filter,
    sortBy,
    searchString,
    onCountChange,
    refreshKey
}: {
    path: string,
    collection: AdminCollection,
    filter?: FilterValues<any>,
    sortBy?: OrderByTuple[],
    /**
     * Required, not optional. The term sits in the same scope as the element
     * that mounts this and is passed to the toolbar and the empty state beside
     * it — it was simply not passed here, so a searched list showed the count
     * of the unsearched collection. A required prop is what stops the next
     * caller doing the same; there is no useful "count without the search".
     */
    searchString: string | undefined,
    onCountChange?: (count: number | null | undefined) => void,
    /**
     * Counts again whenever this changes. The count is one read, not a
     * subscription: after a delete the toolbar kept the old total, and "select
     * all matching" offered it over the rows that were left.
     */
    refreshKey?: number,
}) {

    const dataClient = useData();

    // The whole sort as one string: it keys the dedup cache and drives the
    // effect, and a `sortBy` array is a new reference on every render.
    const sortKey = React.useMemo(() => sortBy ? serializeOrderBy(sortBy) ?? "" : "", [sortBy]);

    // Use refs for values that should NOT trigger re-fetches
    const dataClientRef = React.useRef(dataClient);
    dataClientRef.current = dataClient;
    const onCountChangeRef = React.useRef(onCountChange);
    onCountChangeRef.current = onCountChange;

    // Serialize filter to a stable string to avoid re-fetches on object identity changes
    const filterKey = React.useMemo(() => filter ? JSON.stringify(filter) : "", [filter]);

    useEffect(() => {
        const accessor = dataClientRef.current.collection(path);
        if (!accessor.count && !accessor.listenCount) {
            onCountChangeRef.current?.(undefined);
            return;
        }

        let cancelled = false;

        // filterValues is already FilterValues — pass directly
        const whereParams = filter && Object.keys(filter).length > 0 ? filter : undefined;
        const orderByParams = sortBy && sortBy.length > 0
            ? sortBy.map(([field, direction]) => [String(field), direction] as OrderByTuple)
            : undefined;

        // Live where the data source can subscribe: the total then follows the
        // rows other people add and remove, not only this view's own deletes,
        // and so does the "select all N" offer built on it.
        if (accessor.listenCount) {
            return accessor.listenCount(
                { where: whereParams, searchString },
                (total) => onCountChangeRef.current?.(total),
                (error) => {
                    console.warn("Error counting", error);
                    onCountChangeRef.current?.(undefined);
                }
            );
        }

        // Deduplicate inflight count requests (e.g. React StrictMode double-mount)
        // The search term is part of the query, so it is part of the key. The
        // cache is module-level and outlives an unmount, so a key that omits it
        // does not merely lose precision — it answers one search with a
        // different search's total.
        // The refresh key too: a count still in flight from before a delete
        // must not answer the one asked after it.
        const cacheKey = `${path}|${filterKey}|${sortKey}|${searchString ?? ""}|${refreshKey ?? ""}`;
        let countPromise = inflightCountRequests.get(cacheKey);
        if (!countPromise) {
            countPromise = accessor.count!({
                where: whereParams,
                orderBy: orderByParams,
                searchString
            });
            inflightCountRequests.set(cacheKey, countPromise);
            // Clean up the inflight entry once resolved/rejected
            countPromise.finally(() => inflightCountRequests.delete(cacheKey));
        }

        countPromise.then((c) => {
            if (!cancelled) onCountChangeRef.current?.(c);
        }).catch((e) => {
            console.warn("Error fetching count", e);
            if (!cancelled) onCountChangeRef.current?.(undefined);
        });

        return () => { cancelled = true; };
        // `filterKey` and `sortKey` ARE `filter` and `sortBy` — the memoized
        // serializations a few lines up, and the only stable identity either
        // has. Both arrive as freshly built objects on every render, so
        // depending on them directly would re-run this effect each time and
        // fire a count request per render. The keys change exactly when the
        // values do, which is the condition this effect actually wants.
        // eslint-disable-next-line react-hooks/exhaustive-deps -- `filterKey` and `sortKey` are `filter` and `sortBy`, serialized
    }, [path, filterKey, sortKey, searchString, refreshKey]);

    // The toolbar renders the count; this component only fetches and reports it
    return null;
}
