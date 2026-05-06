import type { EntityCollection } from "@rebasepro/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Entity, FilterValues } from "@rebasepro/types";
import { useData, useRebaseContext } from "@rebasepro/core";

const DEFAULT_PAGE_SIZE = 20;

/**
 * Data state for a single board column
 */
export interface BoardColumnData<M extends Record<string, unknown> = Record<string, unknown>> {
    /** Entities loaded for this column */
    entities: Entity<M>[];
    /** Whether the column is currently loading data */
    loading: boolean;
    /** Whether there are more items to load */
    hasMore: boolean;
    /** Error if loading failed */
    error?: Error;
    /** Total count of entities in this column */
    totalCount?: number;
}

/**
 * Controller for managing per-column data in a Kanban board
 */
export interface BoardDataController<M extends Record<string, unknown> = any, COLUMN extends string = string> {
    /** Data state for each column */
    columnData: Record<COLUMN, BoardColumnData<M>>;
    /** Load more items for a specific column */
    loadMoreColumn: (column: COLUMN) => void;
    /** Refresh data for a specific column */
    refreshColumn: (column: COLUMN) => void;
    /** Refresh all columns */
    refreshAll: () => void;
    /** Update column counts and optionally move item optimistically */
    moveItemOptimistically: (itemId: string, sourceColumn: COLUMN, targetColumn: COLUMN, newValues?: Record<string, any>, newIndex?: number) => void;
    /** Decrement column counts (for optimistic updates when deleting items) */
    decrementColumnCounts: (columnDeltas: Record<COLUMN, number>) => void;
    /** Whether any column is loading */
    loading: boolean;
    /** Any error from any column */
    error?: Error;
}

export interface UseBoardDataControllerProps<M extends Record<string, unknown> = Record<string, unknown>> {
    /** Full path to the collection */
    fullPath: string;
    /** The entity collection configuration */
    collection: EntityCollection<M>;
    /** Property key used for column assignment */
    columnProperty: string;
    /** Array of column values (enum values from columnProperty) */
    columns: string[];
    /** Property key used for ordering within columns */
    orderProperty?: string;
    /** Number of items to load per page per column */
    pageSize?: number;
    /** Text search string to filter entities */
    searchString?: string;
    /** Additional filter values */
    filterValues?: FilterValues<string>;
}

/**
 * Hook that manages per-column data loading for the Kanban board.
 * Each column gets its own independent query to the data source.
 */
export function useBoardDataController<M extends Record<string, unknown> = any, COLUMN extends string = string>({
    fullPath,
    collection,
    columnProperty,
    columns,
    orderProperty,
    pageSize = DEFAULT_PAGE_SIZE,
    searchString,
    filterValues
}: UseBoardDataControllerProps<M>): BoardDataController<M, COLUMN> {

    const context = useRebaseContext();
    const dataClient = useData();
    // v4: use fullPath directly instead of resolveIdsFrom
    const resolvedPath = fullPath;

    // Stable refs for objects that shouldn't trigger re-subscriptions
    const dataClientRef = useRef(dataClient);
    const collectionRef = useRef(collection);
    const contextRef = useRef(context);
    dataClientRef.current = dataClient;
    collectionRef.current = collection;
    contextRef.current = context;

    // Store filter/order params in refs so they're accessible without causing re-subscriptions
    const filterValuesRef = useRef(filterValues);
    const columnPropertyRef = useRef(columnProperty);
    const orderPropertyRef = useRef(orderProperty);
    const searchStringRef = useRef(searchString);
    const resolvedPathRef = useRef(resolvedPath);
    filterValuesRef.current = filterValues;
    columnPropertyRef.current = columnProperty;
    orderPropertyRef.current = orderProperty;
    searchStringRef.current = searchString;
    resolvedPathRef.current = resolvedPath;

    // Track item count per column for pagination
    const [columnItemCounts, setColumnItemCounts] = useState<Record<string, number>>(() => {
        const initial: Record<string, number> = {};
        columns.forEach(col => {
            initial[col] = pageSize;
        });
        return initial;
    });

    // Per-column data state
    const [columnData, setColumnData] = useState<Record<string, BoardColumnData<M>>>(() => {
        const initial: Record<string, BoardColumnData<M>> = {};
        columns.forEach(col => {
            initial[col] = {
                entities: [],
                loading: true,
                hasMore: true,
                error: undefined,
                totalCount: undefined
            };
        });
        return initial;
    });

    // Track cleanup functions for subscriptions
    const unsubscribersRef = useRef<Record<string, () => void>>({});

    // Flag to prevent race conditions during cleanup
    const isCleaningUpRef = useRef(false);

    // Stable keys for dependency comparison
    const columnsKey = useMemo(() => [...columns].sort().join(","), [columns]);
    const filterKey = useMemo(() => JSON.stringify(filterValues), [filterValues]);

    // Track previous column item counts to detect which column changed
    const prevColumnItemCountsRef = useRef<Record<string, number>>(columnItemCounts);

    // Version counter to trigger full re-subscription when params change (not just load-more)
    const [subscriptionVersion, setSubscriptionVersion] = useState(0);

    // Trigger full re-subscription when key params change
    useEffect(() => {
        setSubscriptionVersion(v => v + 1);
    }, [columnsKey, resolvedPath, columnProperty, orderProperty, searchString, filterKey, pageSize]);

    // Cleanup subscriptions on unmount
    useEffect(() => {
        return () => {
            isCleaningUpRef.current = true;
            Object.values(unsubscribersRef.current).forEach(unsub => unsub?.());
            unsubscribersRef.current = {};
        };
    }, []);

    // Helper function to subscribe to a single column - uses refs to avoid dependency issues
    const subscribeToColumn = useCallback((column: string, itemCount: number) => {
        // Skip if we're in the middle of cleanup
        if (isCleaningUpRef.current) return;

        const currentDataClient = dataClientRef.current;
        const currentCollection = collectionRef.current;
        const currentContext = contextRef.current;
        const currentFilterValues = filterValuesRef.current;
        const currentColumnProperty = columnPropertyRef.current;
        const currentOrderProperty = orderPropertyRef.current;
        const currentSearchString = searchStringRef.current;
        const currentResolvedPath = resolvedPathRef.current;

        // Build where map for this column
        const whereMap: Record<string, string> = {};
        if (currentFilterValues) {
            Object.entries(currentFilterValues).forEach(([key, value]) => {
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
        whereMap[currentColumnProperty] = `eq.${column}`;

        const orderByParam = currentOrderProperty ? `${currentOrderProperty}:asc` : undefined;

        // Mark column as loading
        setColumnData(prev => ({
            ...prev,
            [column]: {
                ...prev[column],
                loading: true,
                error: undefined
            }
        }));

        // onUpdate callback
        const onUpdate = async (entities: Entity<M>[]) => {
            // Skip updates if we're cleaning up
            if (isCleaningUpRef.current) return;

            // When text search is active, the data source returns ALL matching entities
            // regardless of the column filter. We need to filter in memory to only show
            // entities that belong to this specific column.
            let processed = currentSearchString
                ? entities.filter(e => e.values?.[currentColumnProperty] === column)
                : entities;

            // Apply afterRead callbacks if any
            if (currentCollection.callbacks?.afterRead) {
                try {
                    processed = await Promise.all(
                        processed.map(entity =>
                            currentCollection.callbacks!.afterRead!({
                                collection: currentCollection,
                                path: currentResolvedPath,
                                entity,
                                context: currentContext
                            })
                        )
                    );
                } catch (e) {
                    console.error("Error in afterRead callback:", e);
                }
            }

            const newHasMore = entities.length >= itemCount;

            console.log(`[useBoardDataController] Listener update for col ${column}. Length: ${processed.length}. Entities:`, processed.map(e => e.id));

            // Compare with current state — skip update if identical to avoid UI flash
            setColumnData(prev => {
                const existing = prev[column];
                if (existing && !existing.loading && existing.entities.length === processed.length) {
                    // Quick structural equality check: same IDs in same order with same values
                    let identical = true;
                    for (let i = 0; i < processed.length; i++) {
                        const a = existing.entities[i];
                        const b = processed[i];
                        if (a.id !== b.id) {
                            identical = false;
                            break;
                        }
                        // Deep-compare values by JSON serialization
                        // This covers order key, column assignment, and all other fields
                        if (JSON.stringify(a.values) !== JSON.stringify(b.values)) {
                            identical = false;
                            break;
                        }
                    }
                    if (identical && existing.hasMore === newHasMore) {
                        // Data is the same — return previous reference to prevent re-render
                        return prev;
                    }
                }

                return {
                    ...prev,
                    [column]: {
                        entities: processed,
                        loading: false,
                        hasMore: newHasMore,
                        error: undefined,
                        totalCount: prev[column]?.totalCount // Keep existing count
                    }
                };
            });
        };

        const onError = (error: Error) => {
            // Skip error handling if we're cleaning up
            if (isCleaningUpRef.current) return;

            console.error(`Error loading column ${column}:`, error);
            setColumnData(prev => ({
                ...prev,
                [column]: {
                    ...prev[column],
                    entities: [],
                    loading: false,
                    hasMore: false,
                    error
                }
            }));
        };

        // Set up listener or fetch
        const accessor = currentDataClient.collection(currentResolvedPath);
        if (accessor.listen) {
            const unsubscribe = accessor.listen({
                where: whereMap,
                limit: itemCount,
                orderBy: orderByParam
            }, res => onUpdate(res.data as Entity<M>[]), onError);
            unsubscribersRef.current[column] = unsubscribe;
        } else {
            accessor.find({
                where: whereMap,
                limit: itemCount,
                orderBy: orderByParam
            })
                .then(res => onUpdate(res.data as Entity<M>[]))
                .catch(onError);
        }
    }, []); // No dependencies - uses refs for all values

    // Main effect for all column subscriptions - runs when subscriptionVersion changes (i.e., key params change)
    useEffect(() => {
        // Mark that we're setting up new subscriptions
        isCleaningUpRef.current = false;

        // Clean up all existing subscriptions synchronously
        const existingUnsubscribers = { ...unsubscribersRef.current };
        unsubscribersRef.current = {};
        Object.values(existingUnsubscribers).forEach(unsub => {
            try {
                unsub?.();
            } catch (e) {
                // Ignore cleanup errors
            }
        });

        const currentDataClient = dataClientRef.current;
        const currentCollection = collectionRef.current;
        const currentFilterValues = filterValuesRef.current;
        const currentColumnProperty = columnPropertyRef.current;
        const currentSearchString = searchStringRef.current;
        const currentResolvedPath = resolvedPathRef.current;
        const currentColumns = columns;
        const currentColumnItemCounts = columnItemCounts;

        // Small delay to ensure Firestore has cleaned up previous listeners
        const timeoutId = setTimeout(() => {
            if (isCleaningUpRef.current) return;

            currentColumns.forEach(column => {
                const itemCount = currentColumnItemCounts[column] ?? pageSize;
                subscribeToColumn(column, itemCount);

                // Count query for column (for display in column header)
                const accessor = currentDataClient.collection(currentResolvedPath);
                if (accessor.count) {

                    const whereMap: Record<string, string> = {};
                    if (currentFilterValues) {
                        Object.entries(currentFilterValues).forEach(([key, value]) => {
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
                    whereMap[currentColumnProperty] = `eq.${column}`;

                    accessor.count({
                        where: whereMap
                    }).then(count => {
                        if (isCleaningUpRef.current) return;
                        setColumnData(prev => ({
                            ...prev,
                            [column]: {
                                ...prev[column],
                                totalCount: count
                            }
                        }));
                    }).catch(e => {
                        console.warn(`Failed to get count for column ${column}:`, e);
                    });
                }
            });

            // Update the ref after subscribing all
            prevColumnItemCountsRef.current = { ...currentColumnItemCounts };
        }, 0);

        return () => {
            clearTimeout(timeoutId);
            isCleaningUpRef.current = true;
            const unsubscribers = { ...unsubscribersRef.current };
            unsubscribersRef.current = {};
            Object.values(unsubscribers).forEach(unsub => {
                try {
                    unsub?.();
                } catch (e) {
                    // Ignore cleanup errors
                }
            });
        };

    }, [subscriptionVersion, subscribeToColumn, pageSize]);

    // Track which subscription version last updated the counts
    const lastProcessedVersionRef = useRef(subscriptionVersion);

    // Separate effect to handle individual column load-more WITHOUT triggering full re-subscription
    useEffect(() => {
        // If subscriptionVersion changed, the main effect will handle everything
        // Skip this effect to avoid race conditions
        if (subscriptionVersion !== lastProcessedVersionRef.current) {
            lastProcessedVersionRef.current = subscriptionVersion;
            prevColumnItemCountsRef.current = { ...columnItemCounts };
            return;
        }

        const prevCounts = prevColumnItemCountsRef.current;

        columns.forEach(column => {
            const prevCount = prevCounts[column] ?? pageSize;
            const newCount = columnItemCounts[column] ?? pageSize;

            // Only re-subscribe if this specific column's count increased (load more)
            if (newCount > prevCount && !isCleaningUpRef.current) {
                // Unsubscribe only this column
                if (unsubscribersRef.current[column]) {
                    try {
                        unsubscribersRef.current[column]();
                    } catch (e) {
                        // Ignore cleanup errors
                    }
                    delete unsubscribersRef.current[column];
                }
                // Re-subscribe with new limit after a small delay
                setTimeout(() => {
                    if (!isCleaningUpRef.current) {
                        subscribeToColumn(column, newCount);
                    }
                }, 0);
            }
        });

        // Update the ref
        prevColumnItemCountsRef.current = { ...columnItemCounts };
    }, [columnItemCounts, columns, pageSize, subscribeToColumn, subscriptionVersion]);

    const loadMoreColumn = useCallback((column: COLUMN) => {
        setColumnItemCounts(prev => ({
            ...prev,
            [column]: (prev[column] ?? pageSize) + pageSize
        }));
    }, [pageSize]);

    const refreshColumn = useCallback((column: COLUMN) => {
        // Force re-subscribe by resetting to initial count
        setColumnItemCounts(prev => ({
            ...prev,
            [column]: pageSize
        }));
    }, [pageSize]);

    const refreshAll = useCallback(() => {
        const reset: Record<string, number> = {};
        columns.forEach(col => {
            reset[col] = pageSize;
        });
        setColumnItemCounts(reset);
    }, [columns, pageSize]);

    // Optimistic update for when moving an item
    const moveItemOptimistically = useCallback((itemId: string, sourceColumn: COLUMN, targetColumn: COLUMN, newValues?: Record<string, any>, newIndex?: number) => {
        setColumnData(prev => {
            const updated = { ...prev };
            let itemToMove: Entity<M> | undefined;

            const sourceEntities = [...(updated[sourceColumn]?.entities || [])];
            const itemIndex = sourceEntities.findIndex(e => String(e.id) === itemId);

            if (itemIndex !== -1) {
                itemToMove = sourceEntities[itemIndex];
                sourceEntities.splice(itemIndex, 1);
            }

            if (itemToMove) {
                const updatedEntity = {
                    ...itemToMove,
                    values: {
                        ...itemToMove.values,
                        ...(newValues || {})
                    }
                };

                const targetEntities = sourceColumn === targetColumn ? sourceEntities : [...(updated[targetColumn]?.entities || [])];
                
                if (newIndex !== undefined && newIndex >= 0 && newIndex <= targetEntities.length) {
                    targetEntities.splice(newIndex, 0, updatedEntity);
                } else {
                    targetEntities.push(updatedEntity);
                    if (orderPropertyRef.current) {
                        const orderProp = orderPropertyRef.current;
                        targetEntities.sort((a, b) => {
                            const valA = a.values?.[orderProp] as string | undefined | null;
                            const valB = b.values?.[orderProp] as string | undefined | null;
                            
                            // Handle nulls/empty strings to match Postgres NULLS LAST (ASC) behavior
                            const isAEmpty = valA === undefined || valA === null || valA === "";
                            const isBEmpty = valB === undefined || valB === null || valB === "";
                            
                            if (isAEmpty && isBEmpty) return 0;
                            if (isAEmpty) return 1; // A is null, B is not -> A goes after B
                            if (isBEmpty) return -1; // B is null, A is not -> A goes before B
                            
                            return valA < valB ? -1 : valA > valB ? 1 : 0;
                        });
                    }
                }

                updated[sourceColumn] = {
                    ...updated[sourceColumn],
                    entities: sourceColumn === targetColumn ? targetEntities : sourceEntities,
                    totalCount: sourceColumn === targetColumn 
                        ? updated[sourceColumn].totalCount 
                        : Math.max(0, (updated[sourceColumn].totalCount ?? 0) - 1)
                };

                if (sourceColumn !== targetColumn) {
                    updated[targetColumn] = {
                        ...updated[targetColumn],
                        entities: targetEntities,
                        totalCount: (updated[targetColumn].totalCount ?? 0) + 1
                    };
                }

                console.log(`[useBoardDataController] moveItemOptimistically: ${itemId} from ${sourceColumn} (${updated[sourceColumn].entities.length}) to ${targetColumn} (${updated[targetColumn].entities.length})`);
            } else if (sourceColumn !== targetColumn) {
                // If item not found locally but counts need update
                if (updated[sourceColumn]?.totalCount !== undefined) {
                    updated[sourceColumn] = {
                        ...updated[sourceColumn],
                        totalCount: Math.max(0, (updated[sourceColumn].totalCount ?? 0) - 1)
                    };
                }
                if (updated[targetColumn]?.totalCount !== undefined) {
                    updated[targetColumn] = {
                        ...updated[targetColumn],
                        totalCount: (updated[targetColumn].totalCount ?? 0) + 1
                    };
                }
            }

            return updated;
        });
    }, []);

    // Optimistic update for column counts when deleting items
    const decrementColumnCounts = useCallback((columnDeltas: Record<COLUMN, number>) => {
        setColumnData(prev => {
            const updated = { ...prev };

            for (const [column, delta] of Object.entries(columnDeltas) as [COLUMN, number][]) {
                if (updated[column]?.totalCount !== undefined) {
                    updated[column] = {
                        ...updated[column],
                        totalCount: Math.max(0, (updated[column].totalCount ?? 0) - delta)
                    };
                }
            }

            return updated;
        });
    }, []);

    // Aggregate loading and error state
    const loading = useMemo(() => {
        return Object.values(columnData).some((col) => col.loading);
    }, [columnData]);

    const error = useMemo(() => {
        const errors = Object.values(columnData)
            .map((col) => col.error)
            .filter(Boolean);
        return errors[0];
    }, [columnData]);

    return useMemo(() => ({
        columnData: columnData as Record<COLUMN, BoardColumnData<M>>,
        loadMoreColumn,
        refreshColumn,
        refreshAll,
        moveItemOptimistically,
        decrementColumnCounts,
        loading,
        error
    }), [
        columnData,
        loadMoreColumn,
        refreshColumn,
        refreshAll,
        moveItemOptimistically,
        decrementColumnCounts,
        loading,
        error
    ]);
}
