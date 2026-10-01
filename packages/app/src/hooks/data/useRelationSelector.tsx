
import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { useData } from "./useData";
import { Entity, EntityRelation, FilterValues } from "@rebasepro/types";
import { getRelationIncludeParams } from "../../util/previews";
import { CollectionWindow } from "./collectionWindow";
import { useStableFilterValues } from "./useStableFilterValues";
import type { AdminCollection } from "@rebasepro/cms-types";
export interface RelationItem {
    id: string | number;
    label: string;
    description?: string;
    data: Entity<any>;
    relation: EntityRelation;
}

export interface UseRelationSelectorProps<M extends Record<string, any> = any> {
    /**
     * Full path where the relation data is located
     */
    path: string;
    /**
     * The collection that represents the relation entities
     */
    collection: AdminCollection<M>;
    /**
     * Force filter to be applied to the relation search
     */
    fixedFilter?: FilterValues<string>;
    /**
     * Page size for pagination
     */
    pageSize?: number;
    /**
     * Function to extract the label from a entity
     */
    getLabelFromEntity?: (entity: Entity<M>) => string;
    /**
     * Function to extract the description from a entity
     */
    getDescriptionFromEntity?: (entity: Entity<M>) => string | undefined;
    /**
     * Property name to use as the secondary display field
     */
    descriptionProperty?: keyof M;
    /**
     * Whether the list should be fetched at all. Defaults to `true`.
     *
     * A picker that is mounted is not a picker that is open, and the two used
     * to be the same thing here: the fetch ran on mount, so a collection table
     * with a relation column paid for one query — or one realtime subscription
     * — per rendered row before anyone clicked a cell. Pass `false` until the
     * list is actually needed and nothing is requested; flipping it to `true`
     * fetches once, and it never goes back.
     */
    enabled?: boolean;
}

export interface RelationSelectorController {
    items: RelationItem[];
    isLoading: boolean;
    error: Error | undefined;
    search: (searchString: string) => void;
    loadMore: () => void;
    hasMore: boolean;
    entityToRelationItem: (entity: Entity<any>, relation: EntityRelation) => RelationItem;
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
        getLabelFromEntity,
        getDescriptionFromEntity,
        descriptionProperty,
        enabled = true
    }: UseRelationSelectorProps<M>
): RelationSelectorController {

    const dataClient = useData();
    // Held by content, not identity: callers write it inline.
    const stableFixedFilter = useStableFilterValues(fixedFilter);

    const [items, setItems] = useState<RelationItem[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const isLoadingRef = useRef(false);
    const [error, setError] = useState<Error | undefined>();
    const [hasMore, setHasMore] = useState(true);
    const [currentSearch, setCurrentSearch] = useState<string>("");
    const [limit, setLimit] = useState<number>(pageSize);

    const unsubscribeRef = useRef<(() => void) | null>(null);
    const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    // Whether a fetch has ever completed. Between `enabled` flipping and the
    // effect running there is one paint with no items and no request in
    // flight; without this the list shows "no results" for that frame.
    const hasLoadedRef = useRef(false);

    const setLoading = useCallback((loading: boolean) => {
        isLoadingRef.current = loading;
        setIsLoading(loading);
    }, []);

    // Function to convert entity to RelationItem
    const entityToRelationItem = useCallback((entity: Entity<M>, relation?: EntityRelation): RelationItem => {
        let label: string;
        let description: string | undefined;

        if (getLabelFromEntity) {
            label = getLabelFromEntity(entity);
        } else {
            // Fallback: try common label properties
            const commonLabelProps = ["name", "title", "label", "displayName"];
            let foundProp: string | undefined;

            if (entity.values) {
                foundProp = commonLabelProps.find(prop => entity.values[prop] != null && entity.values[prop] !== "");
            }

            if (foundProp && entity.values[foundProp]) {
                label = String(entity.values[foundProp]);
            } else {
                // Ultimate fallback: use entity ID
                label = String(entity.id);
            }
        }

        if (getDescriptionFromEntity) {
            description = getDescriptionFromEntity(entity);
        } else if (descriptionProperty && entity.values && entity.values[descriptionProperty]) {
            description = String(entity.values[descriptionProperty]);
        }

        return {
            id: entity.id,
            label,
            description,
            data: entity,
            relation: relation ? relation : new EntityRelation(entity.id, path)
        };
    }, [getLabelFromEntity, getDescriptionFromEntity, descriptionProperty]);

    // Clean up any existing subscription
    const cleanupSubscription = useCallback(() => {
        if (unsubscribeRef.current) {
            unsubscribeRef.current();
            unsubscribeRef.current = null;
        }
    }, []);

    // Eagerly include relations to avoid N+1 fetches. Referentially stable, so
    // it can be a dependency below without re-triggering the fetch.
    const includeParams = getRelationIncludeParams(collection);

    // How many rows the picker wants, read by the window below a page at a
    // time. A ref so that asking for more grows the window instead of
    // re-opening it.
    const limitRef = useRef(limit);
    limitRef.current = limit;
    const windowRef = useRef<CollectionWindow<M> | null>(null);

    const fetchData = useCallback(() => {
        cleanupSubscription();
        setError(undefined);
        setLoading(true);

        // fixedFilter is already FilterValues — pass directly
        const whereParams = stableFixedFilter && Object.keys(stableFixedFilter).length > 0 ? stableFixedFilter : undefined;

        // The first page is live when the client has a socket; every later
        // page is read by offset, past the rows already held, and never above
        // the API's read ceiling. "Load more" used to raise one read's
        // `limit`, which re-read every option before it and was refused once
        // it passed 1,000.
        //
        // `dispose` is what keeps this hook's results matching the query that
        // asked for them: an answer for "ab" that lands after the window for
        // "abc" opened is dropped, not painted.
        const collectionWindow = new CollectionWindow<M>({
            accessor: dataClient.collection<M>(path),
            query: {
                where: whereParams,
                searchString: currentSearch || undefined,
                include: includeParams
            },
            pageSize,
            target: limitRef.current,
            onChange: (state) => {
                if (state.rows) {
                    hasLoadedRef.current = true;
                    setItems(state.rows.map((e) => entityToRelationItem(e)));
                    setHasMore(!state.complete && !state.error);
                }
                if (state.error) {
                    console.error("useRelationSelector: Error fetching data:", state.error);
                    hasLoadedRef.current = true;
                }
                setError(state.error);
                setLoading(state.loading);
            }
        });
        windowRef.current = collectionWindow;
        collectionWindow.start();

        unsubscribeRef.current = () => {
            collectionWindow.dispose();
            if (windowRef.current === collectionWindow) windowRef.current = null;
        };
    }, [dataClient, path, stableFixedFilter, pageSize, currentSearch, entityToRelationItem, cleanupSubscription, setLoading, includeParams]);

    // "Load more" asks the open window for the next page.
    useEffect(() => {
        windowRef.current?.setTarget(limit);
    }, [limit]);

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
        if (!enabled) return;
        fetchData();

        return () => {
            cleanupSubscription();
        };
    }, [fetchData, enabled, cleanupSubscription]);

    useEffect(() => {
        return () => {
            if (searchTimeoutRef.current) {
                clearTimeout(searchTimeoutRef.current);
            }
        };
    }, []);

    return useMemo(() => ({
        items,
        // Enabled but not answered yet still counts as loading, so the frame
        // between opening the picker and the request starting shows a spinner
        // rather than "no results".
        isLoading: isLoading || (enabled && !hasLoadedRef.current),
        error,
        search,
        loadMore,
        hasMore,
        entityToRelationItem
    }), [items, isLoading, error, search, loadMore, hasMore, entityToRelationItem, enabled]);
}
