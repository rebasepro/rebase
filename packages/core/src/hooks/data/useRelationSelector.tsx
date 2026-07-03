import type { SnapshotCollection } from "@rebasepro/types";
import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { useData } from "./useData";
import { Snapshot, SnapshotRelation, FilterValues } from "@rebasepro/types";
export interface RelationItem {
    id: string | number;
    label: string;
    description?: string;
    data: Snapshot<any>;
    relation: SnapshotRelation;
}

export interface UseRelationSelectorProps<M extends Record<string, any> = any> {
    /**
     * Full path where the relation data is located
     */
    path: string;
    /**
     * The collection that represents the relation snapshots
     */
    collection: SnapshotCollection<M>;
    /**
     * Force filter to be applied to the relation search
     */
    fixedFilter?: FilterValues<string>;
    /**
     * Page size for pagination
     */
    pageSize?: number;
    /**
     * Function to extract the label from a snapshot
     */
    getLabelFromSnapshot?: (snapshot: Snapshot<M>) => string;
    /**
     * Function to extract the description from a snapshot
     */
    getDescriptionFromSnapshot?: (snapshot: Snapshot<M>) => string | undefined;
    /**
     * Property name to use as the secondary display field
     */
    descriptionProperty?: keyof M;
}

export interface RelationSelectorController {
    items: RelationItem[];
    isLoading: boolean;
    error: Error | undefined;
    search: (searchString: string) => void;
    loadMore: () => void;
    hasMore: boolean;
    snapshotToRelationItem: (snapshot: Snapshot<any>, relation: SnapshotRelation) => RelationItem;
}

const DEFAULT_PAGE_SIZE = 10;

/**
 * Hook to manage relation selection with data fetching from Rebase data source
 */
export function useRelationSelector<M extends Record<string, any> = any>(
    {
        path,
        collection,
        fixedFilter,
        pageSize = DEFAULT_PAGE_SIZE,
        getLabelFromSnapshot,
        getDescriptionFromSnapshot,
        descriptionProperty
    }: UseRelationSelectorProps<M>
): RelationSelectorController {

    const dataClient = useData();

    const [items, setItems] = useState<RelationItem[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const isLoadingRef = useRef(false);
    const [error, setError] = useState<Error | undefined>();
    const [hasMore, setHasMore] = useState(true);
    const [currentSearch, setCurrentSearch] = useState<string>("");
    const [limit, setLimit] = useState<number>(pageSize);

    const unsubscribeRef = useRef<(() => void) | null>(null);
    const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    const setLoading = useCallback((loading: boolean) => {
        isLoadingRef.current = loading;
        setIsLoading(loading);
    }, []);

    // Function to convert snapshot to RelationItem
    const snapshotToRelationItem = useCallback((snapshot: Snapshot<M>, relation?: SnapshotRelation): RelationItem => {
        let label: string;
        let description: string | undefined;

        if (getLabelFromSnapshot) {
            label = getLabelFromSnapshot(snapshot);
        } else {
            // Fallback: try common label properties
            const commonLabelProps = ["name", "title", "label", "displayName"];
            let foundProp: string | undefined;

            if (snapshot.values) {
                foundProp = commonLabelProps.find(prop => snapshot.values[prop] != null && snapshot.values[prop] !== "");
            }

            if (foundProp && snapshot.values[foundProp]) {
                label = String(snapshot.values[foundProp]);
            } else {
                // Ultimate fallback: use snapshot ID
                label = String(snapshot.id);
            }
        }

        if (getDescriptionFromSnapshot) {
            description = getDescriptionFromSnapshot(snapshot);
        } else if (descriptionProperty && snapshot.values && snapshot.values[descriptionProperty]) {
            description = String(snapshot.values[descriptionProperty]);
        }

        return {
            id: snapshot.id,
            label,
            description,
            data: snapshot,
            relation: relation ? relation : new SnapshotRelation(snapshot.id, path)
        };
    }, [getLabelFromSnapshot, getDescriptionFromSnapshot, descriptionProperty]);

    // Clean up any existing subscription
    const cleanupSubscription = useCallback(() => {
        if (unsubscribeRef.current) {
            unsubscribeRef.current();
            unsubscribeRef.current = null;
        }
    }, []);

    const fetchData = useCallback(() => {
        cleanupSubscription();
        setError(undefined);
        setLoading(true);

        // fixedFilter is already FilterValues — pass directly
        const whereParams = fixedFilter && Object.keys(fixedFilter).length > 0 ? fixedFilter : undefined;

        const onSnapshotsUpdate = (res: { data: Snapshot<M>[], meta: { hasMore: boolean } }) => {
            const newItems = res.data.map((e) => snapshotToRelationItem(e));
            setItems(newItems);
            setHasMore(res.meta.hasMore);
            setLoading(false);
        };

        const onErrorUpdate = (fetchError: Error) => {
            console.error("useRelationSelector: Error fetching data:", fetchError);
            setError(fetchError);
            setLoading(false);
        };

        const accessor = dataClient.collection(path);

        let unsubscribe: (() => void) | undefined;

        if (accessor.listen) {
            unsubscribe = accessor.listen({
                where: whereParams,
                limit: limit,
                orderBy: undefined,
                searchString: currentSearch
            }, (res) => onSnapshotsUpdate({ data: res.data as Snapshot<M>[],
meta: res.meta }), onErrorUpdate);
        } else {
            accessor.find({
                where: whereParams,
                limit: limit,
                offset: 0,
                orderBy: undefined,
                searchString: currentSearch
            })
                .then((res) => onSnapshotsUpdate({ data: res.data as Snapshot<M>[],
meta: res.meta }))
                .catch(onErrorUpdate);
            unsubscribe = () => {};
        }

        unsubscribeRef.current = unsubscribe || null;
    }, [dataClient, path, fixedFilter, limit, currentSearch, snapshotToRelationItem, cleanupSubscription, setLoading]);

    // Search function with debouncing
    const search = useCallback((searchString: string) => {
        // Clear existing timeout
        if (searchTimeoutRef.current) {
            clearTimeout(searchTimeoutRef.current);
        }

        // Debounce search
        searchTimeoutRef.current = setTimeout(() => {
            setLimit(pageSize);
            setCurrentSearch(searchString);
        }, searchString.trim() ? 300 : 0);
    }, [pageSize]);

    // Load more function
    const loadMore = useCallback(() => {
        if (!isLoadingRef.current && hasMore && items.length > 0) {
            setLoading(true);
            setLimit(prev => prev + pageSize);
        }
    }, [hasMore, items.length, pageSize, setLoading]);

    // Load initial data and update upon changes
    useEffect(() => {
        fetchData();

        return () => {
            cleanupSubscription();
        };
    }, [fetchData]);

    useEffect(() => {
        return () => {
            if (searchTimeoutRef.current) {
                clearTimeout(searchTimeoutRef.current);
            }
        };
    }, []);

    return useMemo(() => ({
        items,
        isLoading,
        error,
        search,
        loadMore,
        hasMore,
        snapshotToRelationItem
    }), [items, isLoading, error, search, loadMore, hasMore, snapshotToRelationItem]);
}
