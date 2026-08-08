
import { Entity, FilterValues, MAX_LIST_LIMIT } from "@rebasepro/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getRelationIncludeParams, useData, useRebaseContext } from "@rebasepro/app";
import type { AdminCollection } from "@rebasepro/admin-types";

const DEFAULT_PAGE_SIZE = 20;

/**
 * How long a column waits for its subscription's first payload before reading
 * once over HTTP instead. Long enough that a healthy socket always wins the
 * race, short enough that a dead one does not hold a blank board.
 */
const LIVE_FIRST_PAINT_TIMEOUT_MS = 2500;

/**
 * Shallow equality for entity value records.
 * Handles primitives and reference equality for nested values.
 * Avoids JSON.stringify allocation on every comparison.
 */
function shallowEqualValues(
    a: Record<string, unknown> | undefined,
    b: Record<string, unknown> | undefined
): boolean {
    if (a === b) return true;
    if (!a || !b) return false;
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    for (const key of keysA) {
        if (a[key] !== b[key]) return false;
    }
    return true;
}

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
    collection: AdminCollection<M>;
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

    // Track items that are currently in an optimistic state (awaiting DB sync)
    const pendingItemsRef = useRef<Record<string, { entity: Entity<M>, expectedValues: Record<string, any> }>>({});

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

    /**
     * Check if a column value is excluded by the active filter on the columnProperty.
     * E.g. if the user sets "Status IN (Open, In Progress)", this returns true
     * for "Waiting on Customer" since that column should show as empty.
     */
    const isColumnExcludedByFilter = useCallback((column: string, filterValues?: FilterValues<string>, colProperty?: string): boolean => {
        if (!filterValues || !colProperty) return false;
        const filterForColumn = filterValues[colProperty as keyof typeof filterValues];
        if (!filterForColumn || !Array.isArray(filterForColumn)) return false;

        const [op, val] = filterForColumn as [string, unknown];

        if (op === "==" && typeof val === "string") {
            return column !== val;
        }
        if (op === "!=" && typeof val === "string") {
            return column === val;
        }
        if (op === "in" && Array.isArray(val)) {
            return !val.map(String).includes(column);
        }
        if (op === "not-in" && Array.isArray(val)) {
            return val.map(String).includes(column);
        }

        return false;
    }, []);

    // Helper function to subscribe to a single column - uses refs to avoid dependency issues
    const subscribeToColumn = useCallback((column: string, itemCount: number) => {
        // Skip if we're in the middle of cleanup
        if (isCleaningUpRef.current) return;

        // `itemCount` grows by one page per "load more" click with nothing
        // stopping it, and a read above `MAX_LIST_LIMIT` is refused rather than
        // trimmed — a column would stop loading with an error instead of
        // stopping at the ceiling. Ask for what the platform serves; `hasMore`
        // below still compares against the count the board asked for, so the
        // column reports itself exhausted exactly where it did before.
        const requestedCount = Math.min(itemCount, MAX_LIST_LIMIT);

        const currentDataClient = dataClientRef.current;
        const currentCollection = collectionRef.current;
        const currentContext = contextRef.current;
        const currentFilterValues = filterValuesRef.current;
        const currentColumnProperty = columnPropertyRef.current;
        const currentOrderProperty = orderPropertyRef.current;
        const currentSearchString = searchStringRef.current;
        const currentResolvedPath = resolvedPathRef.current;

        // If the column is excluded by the active filter on the column property,
        // set it as empty immediately without querying.
        const excluded = isColumnExcludedByFilter(column, currentFilterValues, currentColumnProperty);
        if (excluded) {
            setColumnData(prev => ({
                ...prev,
                [column]: {
                    entities: [],
                    loading: false,
                    hasMore: false,
                    error: undefined,
                    totalCount: 0
                }
            }));
            return;
        }

        // Build filter map for this column — pass FilterValues directly
        const whereFilter: FilterValues<string> = {
            ...(currentFilterValues ?? {}),
            [currentColumnProperty]: ["==", column]
        };

        const orderByParam: [string, "asc" | "desc"] | undefined = currentOrderProperty ? [currentOrderProperty, "asc"] : undefined;

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

            const pendingMap = pendingItemsRef.current;

            // Apply pending updates to incoming entities
            const mergedEntities = entities.map(e => {
                const pending = pendingMap[String(e.id)];
                if (pending) {
                    // Check if DB entity has caught up to the expected column and order
                    const expectedCol = pending.expectedValues[currentColumnProperty];
                    const expectedOrder = currentOrderProperty ? pending.expectedValues[currentOrderProperty] : undefined;

                    let caughtUp = true;
                    if (e.values?.[currentColumnProperty] !== expectedCol) {
                        caughtUp = false;
                    }
                    if (currentOrderProperty && e.values?.[currentOrderProperty] !== expectedOrder) {
                        caughtUp = false;
                    }

                    if (caughtUp) {
                        // DB has caught up, clear pending state
                        delete pendingMap[String(e.id)];
                        return e; // Use the real DB entity
                    }

                    // DB hasn't caught up, overlay expected values
                    return { ...e,
values: { ...e.values,
...pending.expectedValues } };
                }
                return e;
            });

            // Add any pending items that belong to this column but aren't in the incoming entities yet
            // (e.g. backend hasn't moved them to this column yet)
            Object.values(pendingMap).forEach(pending => {
                if (pending.expectedValues[currentColumnProperty] === column) {
                    if (!mergedEntities.some(e => String(e.id) === String(pending.entity.id))) {
                        mergedEntities.push(pending.entity);
                    }
                }
            });

            // Always filter in memory to only show entities that belong to this specific column.
            // This is required because text search returns all matches, and collection_entity_patch
            // may contain entities that have just been moved out of this column.
            let processed = mergedEntities.filter(e => e.values?.[currentColumnProperty] === column);

            // Sort locally if orderProperty is defined. This ensures that collection_entity_patch
            // insertions (which prepend by default in websocket.ts) are correctly placed.
            if (currentOrderProperty) {
                processed = [...processed].sort((a, b) => {
                    const valA = a.values?.[currentOrderProperty] as string | undefined | null;
                    const valB = b.values?.[currentOrderProperty] as string | undefined | null;

                    const isAEmpty = valA === undefined || valA === null || valA === "";
                    const isBEmpty = valB === undefined || valB === null || valB === "";

                    if (isAEmpty && isBEmpty) return 0;
                    if (isAEmpty) return 1;
                    if (isBEmpty) return -1;

                    return valA < valB ? -1 : valA > valB ? 1 : 0;
                });
            }

            // Apply afterRead callbacks if any.
            // afterRead operates on flat rows; unwrap the Entity view-model
            // before invoking and re-wrap the processed row after.
            if (currentCollection.callbacks?.afterRead) {
                try {
                    processed = await Promise.all(
                        processed.map(async (entity) => {
                            const processedRow = await currentCollection.callbacks!.afterRead!({
                                collection: currentCollection,
                                path: currentResolvedPath,
                                row: { id: entity.id, ...entity.values },
                                context: currentContext
                            });
                            return {
                                ...entity,
                                values: processedRow as M
                            };
                        })
                    );
                } catch (e) {
                    console.error("Error in afterRead callback:", e);
                }
            }

            const newHasMore = entities.length >= itemCount;

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
                        // Shallow-compare values to avoid JSON.stringify allocations
                        // entity.values are flat records from the DB, so shallow suffices
                        if (!shallowEqualValues(a.values, b.values)) {
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

        const accessor = currentDataClient.collection(currentResolvedPath);

        // Eagerly include relations to avoid N+1 fetches.
        const includeParams = getRelationIncludeParams(currentCollection);

        const fetchOnce = () => accessor.find({
            where: whereFilter,
            limit: requestedCount,
            orderBy: orderByParam,
            include: includeParams,
            searchString: currentSearchString
        });

        const onError = (error: Error) => {
            // Skip error handling if we're cleaning up
            if (isCleaningUpRef.current) return;

            console.error(`Error loading column ${column}:`, error);

            // A live subscription that fails is not the same thing as a column
            // with nothing in it, but that is exactly what this used to render:
            // entities cleared, no error surfaced, and a column reading "No
            // items" above a header still counting eleven of them. Read once
            // over HTTP instead — the board loses its live updates, not its
            // contents — and only report the failure if that fails too.
            fetchOnce()
                .then(res => onUpdate(res.data as Entity<M>[]))
                .catch(() => {
                    if (isCleaningUpRef.current) return;
                    setColumnData(prev => ({
                        ...prev,
                        [column]: {
                            ...prev[column],
                            entities: prev[column]?.entities ?? [],
                            loading: false,
                            hasMore: false,
                            error
                        }
                    }));
                });
        };

        if (accessor.listen) {
            let liveDataReceived = false;
            const unsubscribe = accessor.listen({
                where: whereFilter,
                limit: requestedCount,
                orderBy: orderByParam,
                include: includeParams,
                // Read into a local at the top of this function and then used
                // nowhere, in both places it was read. The board took a search
                // term, re-subscribed every column when it changed, and
                // returned the same rows.
                searchString: currentSearchString
            }, res => {
                liveDataReceived = true;
                onUpdate(res.data as Entity<M>[]);
            }, onError);

            // A subscription that is never going to answer takes the client's
            // full 30s watchdog to say so, and the board spins the whole time.
            // If the socket has not delivered shortly after mount, read once
            // over HTTP and paint that; the live data still wins whenever it
            // arrives. Costs nothing when realtime is healthy.
            const firstPaintFallback = setTimeout(() => {
                if (liveDataReceived || isCleaningUpRef.current) return;
                fetchOnce()
                    .then(res => {
                        if (liveDataReceived || isCleaningUpRef.current) return;
                        onUpdate(res.data as Entity<M>[]);
                    })
                    .catch(() => undefined);
            }, LIVE_FIRST_PAINT_TIMEOUT_MS);

            unsubscribersRef.current[column] = () => {
                clearTimeout(firstPaintFallback);
                unsubscribe?.();
            };
        } else {
            fetchOnce()
                .then(res => onUpdate(res.data as Entity<M>[]))
                .catch((error: Error) => {
                    if (isCleaningUpRef.current) return;
                    setColumnData(prev => ({
                        ...prev,
                        [column]: {
                            ...prev[column],
                            entities: prev[column]?.entities ?? [],
                            loading: false,
                            hasMore: false,
                            error
                        }
                    }));
                });
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

                // Skip count query for columns excluded by the filter — subscribeToColumn
                // already set them to totalCount: 0.
                if (isColumnExcludedByFilter(column, currentFilterValues, currentColumnProperty)) {
                    return;
                }

                // Count query for column (for display in column header)
                const accessor = currentDataClient.collection(currentResolvedPath);
                if (accessor.count) {

                    const whereFilter: FilterValues<string> = {
                        ...(currentFilterValues ?? {}),
                        [currentColumnProperty]: ["==", column]
                    };

                    accessor.count({
                        where: whereFilter,
                        // Or the column header counts the unsearched collection
                        // while the column beneath it shows searched rows.
                        searchString: currentSearchString
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
                const newValuesMerged = {
                    ...itemToMove.values,
                    ...(newValues || {})
                };

                const updatedEntity = {
                    ...itemToMove,
                    values: newValuesMerged
                };

                // Store in pending items ref
                pendingItemsRef.current[String(updatedEntity.id)] = {
                    entity: updatedEntity,
                    expectedValues: newValuesMerged
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
