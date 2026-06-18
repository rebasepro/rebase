import type { EntityCollection } from "@rebasepro/types";
import { useEffect, useState, useMemo } from "react";
import { Entity, FilterValues, User } from "@rebasepro/types";
import { useData } from "./useData";
import { isSchemaDriftError, useSchemaDriftContext } from "../../components/SchemaDriftBanner";
/**
 * @group Hooks and utilities
 */
export interface CollectionFetchProps<M extends Record<string, any>> {

    /**
     * Absolute collection path
     */
    path: string;

    /**
     * collection of the entity displayed by this collection
     */
    collection: EntityCollection<M>

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
export interface CollectionFetchResult<M extends Record<string, any>> {
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
export function useCollectionFetch<M extends Record<string, any>, USER extends User>(
    {
        path,
        collection,
        filterValues,
        sortBy,
        itemCount,
        offset,
        page,
        searchString
    }: CollectionFetchProps<M>): CollectionFetchResult<M> {
    const dataClient = useData();
    const { reportSchemaDrift } = useSchemaDriftContext();

    const sortByProperty = sortBy ? sortBy[0] : undefined;
    const currentSort = sortBy ? sortBy[1] : undefined;
    // Map to PostgREST format for orderBy
    const orderByParams = sortByProperty ? `${String(sortByProperty)}:${currentSort}` : undefined;

    // Convert filterValues to PostgREST where clause
    const whereMap: Record<string, string> = {};
    if (filterValues) {
        Object.entries(filterValues).forEach(([key, value]) => {
            if (value && Array.isArray(value)) {
                const [op, val] = value;
                const postgrestOp = op === "==" ? "eq" : op === "!=" ? "neq" : op === ">" ? "gt" : op === ">=" ? "gte" : op === "<" ? "lt" : op === "<=" ? "lte" : op === "in" ? "in" : op === "not-in" ? "nin" : op === "array-contains" ? "cs" : op === "array-contains-any" ? "csa" : "eq";

                let stringVal: string;
                if (Array.isArray(val)) {
                    stringVal = `(${val.join(",")})`;
                } else {
                    stringVal = String(val);
                }
                whereMap[key] = `${postgrestOp}.${stringVal}`;
            }
        });
    }
    const whereParams = Object.keys(whereMap).length > 0 ? whereMap : undefined;

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
        const hasRelations = collection.properties && Object.values(collection.properties).some(
            (p) => p.type === "relation" || p.type === "reference"
        );
        const includeParams = hasRelations ? ["*"] : undefined;

        if (accessor.listen) {
            return accessor.listen({
                where: whereParams,
                limit: itemCount,
                offset,
                page,
                orderBy: orderByParams,
                searchString,
                include: includeParams
            }, (res) => onEntitiesUpdate({ data: res.data as Entity<M>[],
meta: res.meta }), onError);
        } else {
            accessor.find({
                where: whereParams,
                limit: itemCount,
                offset,
                page,
                orderBy: orderByParams,
                searchString,
                include: includeParams
            })
                .then((res) => onEntitiesUpdate({ data: res.data as Entity<M>[],
meta: res.meta }))
                .catch(onError);
            return () => {
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
