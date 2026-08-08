
import { useEffect, useState, useMemo } from "react";
import { Entity, FilterValues, User } from "@rebasepro/types";
import { useData } from "./useData";
import { isSchemaDriftError, useSchemaDriftContext } from "../../components/SchemaDriftBanner";
import { toFindParams } from "./collectionQuery";
import { getRelationIncludeParams } from "../../util/previews";
import type { AdminCollection } from "@rebasepro/admin-types";
/**
 * @group Hooks and utilities
 */
export interface CollectionProps<M extends Record<string, any>> {

    /**
     * Absolute collection path
     */
    path: string;

    /**
     * collection of the entity displayed by this collection
     */
    collection: AdminCollection<M>

    /**
     * Number of entities to fetch
     */
    itemCount?: number;

    /**
     * Number of items to skip
     */
    offset?: number;

    /**
     * Page number (1-indexed), alternative to offset
     */
    page?: number;

    /**
     * Filter the fetched data by the property
     */
    filterValues?: FilterValues<Extract<keyof M, string>>;

    /**
     * Sort the results by
     */
    sortBy?: [Extract<keyof M, string>, "asc" | "desc"];

    /**
     * Search string
     */
    searchString?: string;
}

/**
 * @group Hooks and utilities
 */
export interface CollectionResult<M extends Record<string, any>> {
    data: Entity<M>[];
    dataLoading: boolean;
    noMoreToLoad: boolean;
    dataLoadingError?: Error;
    totalCount?: number;
}

/**
 * This hook is used to fetch collections using a given collection
 * @param path
 * @param collection
 * @param filterValues
 * @param sortBy
 * @param itemCount
 * @param offset
 * @param page
 * @param searchString
 * @group Hooks and utilities
 */
export function useCollection<M extends Record<string, any>, USER extends User>(
    {
        path,
        collection,
        filterValues,
        sortBy,
        itemCount,
        offset,
        page,
        searchString
    }: CollectionProps<M>): CollectionResult<M> {
    const dataClient = useData();
    const { reportSchemaDrift } = useSchemaDriftContext();

    const sortByProperty = sortBy ? sortBy[0] : undefined;
    const currentSort = sortBy ? sortBy[1] : undefined;
    // Map to PostgREST format for orderBy
    const orderByParams: [string, "asc" | "desc"] | undefined = sortBy ? [String(sortBy[0]), sortBy[1]] : undefined;

    // filterValues is already FilterValues — pass directly
    const whereParams = filterValues && Object.keys(filterValues).length > 0 ? filterValues : undefined;

    const [data, setData] = useState<Entity<M>[]>([]);

    const [dataLoading, setDataLoading] = useState<boolean>(false);
    const [dataLoadingError, setDataLoadingError] = useState<Error | undefined>();
    const [noMoreToLoad, setNoMoreToLoad] = useState<boolean>(false);
    const [totalCount, setTotalCount] = useState<number | undefined>();

    useEffect(() => {

        setDataLoading(true);

        const onEntitiesUpdate = async (res: { data: Entity<M>[], meta: { hasMore: boolean; total?: number } }) => {
            const entities = res.data;
            setDataLoading(false);
            setDataLoadingError(undefined);
            setData(entities.map(e => ({
                ...e
            })));
            setNoMoreToLoad(!res.meta.hasMore);
            setTotalCount(res.meta.total);
        };

        const onError = (error: Error) => {
            console.error("ERROR", error);
            setDataLoading(false);
            setData([]);
            setDataLoadingError(error);
            setTotalCount(undefined);
            // Report schema drift to the global banner context
            if (isSchemaDriftError(error)) {
                reportSchemaDrift(error.message);
            }
        };

        const accessor = dataClient.collection(path);

        // Eagerly include relations to avoid N+1 fetches.
        const includeParams = getRelationIncludeParams(collection);

        if (accessor.listen) {
            // Assembled in one place — see `toFindParams`.
            return accessor.listen(
                toFindParams({ where: whereParams, limit: itemCount, offset, page,
                    orderBy: orderByParams, searchString, include: includeParams }),
                (res) => onEntitiesUpdate({ data: res.data as Entity<M>[],
meta: res.meta }), onError);
        } else {
            // The one-shot fallback, taken whenever the client has no socket.
            // `listen` above cancels on cleanup, and every dependency of this
            // effect — the search string, the filters, the sort, the page —
            // changes while a request is in flight. A promise cannot be
            // unsubscribed, so the cleanup has to disown its result instead:
            // without this, whichever response arrives last wins, and responses
            // do not arrive in request order. Typing into search would settle
            // on the results for whichever query the server happened to finish
            // last.
            let cancelled = false;
            accessor.find(
                toFindParams({ where: whereParams, limit: itemCount, offset, page,
                    orderBy: orderByParams, searchString, include: includeParams }))
                .then((res) => {
                    if (cancelled) return;
                    onEntitiesUpdate({ data: res.data as Entity<M>[],
meta: res.meta });
                })
                .catch((e) => {
                    if (cancelled) return;
                    onError(e);
                });
            return () => {
                cancelled = true;
            };
        }
    }, [path, itemCount, offset, page, currentSort, sortByProperty, filterValues, searchString, dataClient, collection]);

    return useMemo(() => ({
        data,
        dataLoading,
        dataLoadingError,
        noMoreToLoad,
        totalCount
    }), [data, dataLoading, dataLoadingError, noMoreToLoad, totalCount]);

}
