import type { SnapshotCollection } from "@rebasepro/types";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Snapshot, SnapshotTableController, EnumValueConfig, SelectionController } from "@rebasepro/types";
import { SnapshotBoardCard } from "./SnapshotBoardCard";
import {
    Button,
    ChipColorKey,
    ChipColorScheme,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    getColorSchemeForSeed,
    IconButton,
    iconSize,
    RefreshCwIcon,
    Tooltip,
    Typography,
    KanbanView,
    BoardItem,
    BoardItemViewProps,
    ColumnLoadingState
} from "@rebasepro/ui";
import { resolveEnumValues } from "@rebasepro/common";
import { getPropertyInPath } from "../../util/property_utils";
import {
    saveSnapshotWithCallbacks,
    SaveSnapshotWithCallbacksProps,
    useAuthController,
    useCustomizationController,
    useData,
    useRebaseContext,
    useTranslation,
    useSlot
} from "@rebasepro/core";
import { useAnalyticsController } from "@rebasepro/core";
import { setIn } from "@rebasepro/formex";
import { useBoardDataController } from "./useBoardDataController";
import { useKanbanDragAndDrop } from "./hooks/useKanbanDragAndDrop";
import { useSideSnapshotController } from "../../index";
import { generateNKeysBetween } from "fractional-indexing";

export type SnapshotCollectionBoardViewProps<M extends Record<string, unknown> = Record<string, unknown>> = {
    collection: SnapshotCollection<M>;
    tableController: SnapshotTableController<M>;
    fullPath: string;
    parentCollectionSlugs?: string[], parentSnapshotIds?: string[];
    columnProperty: string;
    onSnapshotClick?: (snapshot: Snapshot<M>) => void;
    selectionController?: SelectionController<M>;
    selectionEnabled?: boolean;
    highlightedSnapshots?: Snapshot<M>[];
    emptyComponent?: React.ReactNode;
    /** Called when snapshots are deleted - used for optimistic count updates */
    deletedSnapshots?: Snapshot<M>[];
};

/**
 * Kanban board view for displaying snapshots grouped by a string enum property.
 */
export function SnapshotCollectionBoardView<M extends Record<string, unknown> = Record<string, unknown>>({
    collection,
    tableController,
    fullPath,
    parentCollectionSlugs = [],
    parentSnapshotIds = [],
    columnProperty,
    onSnapshotClick,
    selectionController,
    selectionEnabled = true,
    highlightedSnapshots,
    emptyComponent,
    deletedSnapshots
}: SnapshotCollectionBoardViewProps<M>) {
    const customizationController = useCustomizationController();
    const context = useRebaseContext();
    const dataClient = useData();
    const sideSnapshotController = useSideSnapshotController();
    const analyticsController = useAnalyticsController();
    const { t } = useTranslation();
    const plugins = customizationController.plugins ?? [];

    // State for backfill dialog
    const [showBackfillDialog, setShowBackfillDialog] = useState(false);
    const [backfillLoading, setBackfillLoading] = useState(false);

    // v4: use collection directly without resolving

    // Get orderProperty from collection config, but validate it exists as a real property
    const rawOrderProperty = collection.orderProperty;
    const orderProperty = useMemo(() => {
        if (!rawOrderProperty) return undefined;
        // Check if the property actually exists in the collection
        const property = getPropertyInPath(collection.properties, rawOrderProperty);
        if (!property) {
            console.warn(`orderProperty "${rawOrderProperty}" is defined but does not exist in the collection properties. Treating as unconfigured.`);
            return undefined;
        }
        return rawOrderProperty;
    }, [rawOrderProperty, collection.properties]);

    // Get columns from the property's enumValues
    const {
        enumColumns,
        columnLabels,
        columnColors
    } = useMemo(() => {
        const property = getPropertyInPath(collection.properties, columnProperty);
        if (!property || !("type" in property) || property.type !== "string") {
            return {
                enumColumns: [] as string[],
                columnLabels: {} as Record<string, string>
            };
        }
        const stringProperty = property;
        if (!stringProperty.enum) {
            return {
                enumColumns: [] as string[],
                columnLabels: {} as Record<string, string>
            };
        }
        const enumValues = resolveEnumValues(stringProperty.enum);
        if (!enumValues) {
            return {
                enumColumns: [] as string[],
                columnLabels: {} as Record<string, string>
            };
        }
        const cols = enumValues.map((ev: EnumValueConfig) => String(ev.id));
        const labels = enumValues.reduce((acc: Record<string, string>, ev: EnumValueConfig) => {
            acc[String(ev.id)] = ev.label;
            return acc;
        }, {});
        const colors = enumValues.reduce((acc: Record<string, ChipColorKey | ChipColorScheme | undefined>, ev: EnumValueConfig) => {
            acc[String(ev.id)] = ev.color ?? getColorSchemeForSeed(String(ev.id));
            return acc;
        }, {});
        return {
            enumColumns: cols,
            columnLabels: labels,
            columnColors: colors
        };
    }, [collection, columnProperty]);

    // Track if user has manually reordered columns in this session
    const [hasUserReordered, setHasUserReordered] = useState(false);
    // Column order is derived from the property's enumValues order
    // Local state tracks session reordering before it's persisted
    const [localColumnsOrder, setLocalColumnsOrder] = useState<string[]>(enumColumns);

    useEffect(() => {
        if (!hasUserReordered) {
            // Sync with enumColumns when property changes
            setLocalColumnsOrder(enumColumns);
        } else {
            // User has reordered - only add any missing columns
            const missingColumns = enumColumns.filter(c => !localColumnsOrder.includes(c));
            if (missingColumns.length > 0) {
                setLocalColumnsOrder(prev => [...prev, ...missingColumns]);
            }
        }
    }, [enumColumns, hasUserReordered]);

    const columns = localColumnsOrder;

    // Use the new per-column data controller
    const boardDataController = useBoardDataController<M>({
        fullPath,
        collection,
        columnProperty,
        columns,
        orderProperty,
        pageSize: 30,
        searchString: tableController.searchString,
        filterValues: tableController.filterValues
    });

    // Aggregate loading and error state
    const dataLoading = boardDataController.loading;
    const dataLoadingError = boardDataController.error;

    // Track previously processed deleted snapshots to avoid double-counting
    const processedDeletedRef = useRef<Set<string>>(new Set());

    // Optimistic update for column counts when snapshots are deleted
    useEffect(() => {
        if (!deletedSnapshots || deletedSnapshots.length === 0) return;

        // Calculate column deltas from deleted snapshots
        const deltas: Record<string, number> = {};
        deletedSnapshots.forEach(snapshot => {
            // Skip if we've already processed this snapshot
            if (processedDeletedRef.current.has(String(snapshot.id))) return;
            processedDeletedRef.current.add(String(snapshot.id));

            const col = snapshot.values?.[columnProperty];
            if (col && typeof col === "string") {
                deltas[col] = (deltas[col] ?? 0) + 1;
            }
        });

        if (Object.keys(deltas).length > 0) {
            boardDataController.decrementColumnCounts(deltas);
        }
    }, [deletedSnapshots, columnProperty, boardDataController]);

    // Build all snapshots from all columns for operations that need the full list
    const allSnapshots = useMemo(() => {
        const snapshots: Snapshot<M>[] = [];
        const seenIds = new Set<string>();
        columns.forEach(col => {
            const colData = boardDataController.columnData[col];
            if (colData?.snapshots) {
                colData.snapshots.forEach((snapshot: Snapshot<M>) => {
                    const idStr = String(snapshot.id);
                    if (!seenIds.has(idStr)) {
                        seenIds.add(idStr);
                        snapshots.push(snapshot);
                    }
                });
            }
        });
        return snapshots;
    }, [boardDataController.columnData, columns]);

    const allowColumnReorder = useMemo(() => {
        return plugins.some(plugin => plugin.hooks?.onKanbanColumnsReorder);
    }, [plugins]);

    const handleColumnReorder = useCallback((newColumns: string[]) => {
        analyticsController.onAnalyticsEvent?.("kanban_column_reorder", {
            path: fullPath,
            columnProperty
        });
        setHasUserReordered(true);
        setLocalColumnsOrder(newColumns);
        plugins
            .filter(plugin => plugin.hooks?.onKanbanColumnsReorder)
            .forEach(plugin => {
                plugin.hooks!.onKanbanColumnsReorder!({
                    fullPath,
                    parentCollectionSlugs,
parentSnapshotIds,
                    collection,
                    kanbanColumnProperty: columnProperty,
                    newColumnsOrder: newColumns
                });
            });
    }, [plugins, fullPath, parentCollectionSlugs, parentSnapshotIds, collection, columnProperty, analyticsController]);

    // Collection-level count queries to detect missing order property
    // Just TWO counts: total and ordered (for the entire collection, not per column)
    const [missingOrderCount, setMissingOrderCount] = useState<number>(0);

    const dataClientRef = useRef(dataClient);
    const collectionRef = useRef(collection);
    dataClientRef.current = dataClient;
    collectionRef.current = collection;

    useEffect(() => {
        const currentDataClient = dataClientRef.current;
        const accessor = currentDataClient.collection(fullPath);

        if (!orderProperty || !accessor.count) {
            setMissingOrderCount(0);
            return;
        }

        // Count 1: Total documents in collection
        // Count 2: Documents with orderProperty != null
        let totalCount = 0;
        let orderedCount = 0;
        let completed = 0;

        accessor.count().then(count => {
            totalCount = count;
            completed++;
            if (completed === 2) {
                setMissingOrderCount(Math.max(0, totalCount - orderedCount));
            }
        }).catch(e => console.warn("Failed to get total count:", e));

        accessor.count({
            where: { [orderProperty]: ["!=", null] }
        }).then(count => {
            orderedCount = count;
            completed++;
            if (completed === 2) {
                setMissingOrderCount(Math.max(0, totalCount - orderedCount));
            }
        }).catch(e => console.warn("Failed to get ordered count:", e));
    }, [orderProperty, fullPath]); // Only re-run when these primitives change

    // Check if items need backfill (have no orderProperty values)
    const itemsNeedBackfill = useMemo(() => {
        if (!orderProperty || dataLoading) return false;
        // Use collection-level count detection
        if (missingOrderCount > 0) return true;
        // Fallback to checking loaded snapshots
        return allSnapshots.some((snapshot: Snapshot<M>) => {
            const orderValue = snapshot.values?.[orderProperty];
            return orderValue === undefined || orderValue === null;
        });
    }, [allSnapshots, orderProperty, dataLoading, missingOrderCount]);

    // Create a lookup map of snapshot ID → column from boardDataController data
    // This ensures items stay in the column they were fetched for, not re-evaluated from snapshot.values
    const snapshotColumnMap = useMemo(() => {
        const map: Record<string, string> = {};
        columns.forEach(col => {
            const colData = boardDataController.columnData[col];
            if (colData?.snapshots) {
                colData.snapshots.forEach((snapshot: Snapshot<M>) => {
                    map[String(snapshot.id)] = col;
                });
            }
        });
        return map;
    }, [columns, boardDataController.columnData]);

    // Convert snapshots to board items per column (data already sorted by orderProperty from controller)
    const boardItems: BoardItem<Snapshot<M>>[] = useMemo(() => {
        return allSnapshots.map((snapshot: Snapshot<M>) => ({
            id: String(snapshot.id),
            data: snapshot
        }));
    }, [allSnapshots]);

    // Column loading state from the board data controller
    const columnLoadingState: ColumnLoadingState = useMemo(() => {
        const state: ColumnLoadingState = {};
        columns.forEach(col => {
            const colData = boardDataController.columnData[col];
            state[col] = {
                loading: colData?.loading ?? true,
                hasMore: colData?.hasMore ?? false,
                itemCount: colData?.snapshots?.length ?? 0,
                totalCount: colData?.totalCount
            };
        });
        return state;
    }, [columns, boardDataController.columnData]);

    // Use the lookup map to assign columns - ensures items stay in the column they were fetched for
    const assignColumn = useCallback((item: BoardItem<Snapshot<M>>): string => {
        const column = snapshotColumnMap[item.id];
        if (column) return column;
        // Fallback: read from snapshot values (for newly created items or edge cases)
        const value = item.data.values?.[columnProperty];
        if (value && columns.includes(String(value))) return String(value);
        return columns[0] || "";
    }, [snapshotColumnMap, columnProperty, columns]);

    const { handleItemsReorder } = useKanbanDragAndDrop({
        collection,
        fullPath,
        columnProperty,
        orderProperty,
        dataClient,
        context,
        boardDataController,
        analyticsController
    });

    // Backfill order values for all snapshots
    const handleBackfill = useCallback(async () => {
        if (!orderProperty) {
            return;
        }
        analyticsController.onAnalyticsEvent?.("kanban_backfill_order", {
            path: fullPath
        });
        setBackfillLoading(true);

        try {
            // Fetch ALL documents from collection (not relying on loaded snapshots)
            const allDocsRes = await dataClient.collection(fullPath).find({
                limit: 10000 // Fetch all
            });
            const allDocs = allDocsRes.data as Snapshot<M>[];

            // Find snapshots missing order property
            const snapshotsToUpdate = allDocs.filter((snapshot: Snapshot<M>) => {
                const orderValue = snapshot.values?.[orderProperty];
                return orderValue === undefined || orderValue === null;
            });

            // Generate string fractional keys for all snapshots that need them
            const keys = generateNKeysBetween(null, null, snapshotsToUpdate.length);
            const updates: Promise<void>[] = [];
            snapshotsToUpdate.forEach((snapshot: Snapshot<M>, index: number) => {
                const updatedValues = setIn({ ...snapshot.values }, orderProperty, keys[index]);

                const saveProps: SaveSnapshotWithCallbacksProps<Record<string, unknown>> = {
                    path: snapshot.path,
                    snapshotId: snapshot.id,
                    values: updatedValues as M,
                    previousValues: snapshot.values,
                    collection,
                    status: "existing"
                };

                updates.push(
                    saveSnapshotWithCallbacks({
                        ...saveProps,
                        collection,
                        data: dataClient,
                        context,
                        afterSave: () => {},
                        afterSaveError: (e) => console.error("Backfill save failed:", e)
                    }).then(() => {})
                );
            });

            await Promise.all(updates);
            setShowBackfillDialog(false);

            // Reset missing count to hide banner
            setMissingOrderCount(0);

            // Refresh the board data
            boardDataController.refreshAll();
        } catch (e) {
            console.error("Backfill error:", e);
        } finally {
            setBackfillLoading(false);
        }
    }, [orderProperty, fullPath, collection, dataClient, context, boardDataController, analyticsController]);

    const handleSnapshotClick = useCallback((snapshot: Snapshot<M>) => {
        onSnapshotClick?.(snapshot);
    }, [onSnapshotClick]);

    const handleSelectionChange = useCallback((snapshot: Snapshot<M>, selected: boolean) => {
        selectionController?.toggleSnapshotSelection(snapshot, selected);
    }, [selectionController]);

    const isSnapshotSelected = useCallback((snapshot: Snapshot<M>) => {
        return selectionController?.isSnapshotSelected(snapshot) ?? false;
    }, [selectionController]);

    // Store latest callbacks in refs so the stable ItemComponent always
    // reads fresh values without changing its own identity.
    const handleSnapshotClickRef = useRef(handleSnapshotClick);
    handleSnapshotClickRef.current = handleSnapshotClick;
    const isSnapshotSelectedRef = useRef(isSnapshotSelected);
    isSnapshotSelectedRef.current = isSnapshotSelected;
    const handleSelectionChangeRef = useRef(handleSelectionChange);
    handleSelectionChangeRef.current = handleSelectionChange;
    const selectionEnabledRef = useRef(selectionEnabled);
    selectionEnabledRef.current = selectionEnabled;

    // Stable callback wrappers — identity never changes, delegates to refs.
    const stableOnClick = useCallback((snapshot: Snapshot<M>) => {
        handleSnapshotClickRef.current(snapshot);
    }, []);
    const stableOnSelectionChange = useCallback((snapshot: Snapshot<M>, sel: boolean) => {
        handleSelectionChangeRef.current(snapshot, sel);
    }, []);

    // Build a single, truly stable component reference.
    // Uses refs for ALL dynamic values so the component type never changes.
    // When ItemComponent identity changes, React.memo'd SortableItem remounts
    // the card → DOM is destroyed/recreated → CSS :hover state is lost → flicker.
    const ItemComponent = useMemo(() => {
        const Comp = (props: BoardItemViewProps<Snapshot<M>>) => (
            <SnapshotBoardCard
                {...props}
                collection={collectionRef.current as SnapshotCollection<M>}
                onClick={stableOnClick}
                selected={isSnapshotSelectedRef.current(props.item.data)}
                onSelectionChange={stableOnSelectionChange}
                selectionEnabled={selectionEnabledRef.current}
            />
        );
        Comp.displayName = "KanbanItemComponent";
        return Comp;
    }, []);

    // Get KanbanSetupComponent from plugin slots
    const kanbanSetupSlots = useSlot("kanban.setup", {
        collection,
        fullPath,
        parentCollectionSlugs,
        parentSnapshotIds
    });


    // Get AddKanbanColumnComponent from plugin slots
    const addKanbanColumnSlots = useSlot("kanban.add-column", {
        collection,
        fullPath,
        parentCollectionSlugs,
parentSnapshotIds,
        columnProperty
    });


    // Check for loading error
    const hasError = Boolean(dataLoadingError);
    const errorMessage = dataLoadingError?.message || "";
    const indexUrl = errorMessage.match(/https:\/\/console\.firebase\.google\.com[^\s]+/)?.[0];

    // Error: no enum properties available for Kanban columns
    if (!columnProperty || enumColumns.length === 0) {
        return (
            <div className="h-full flex flex-col items-center justify-center p-8 gap-4">
                <Typography variant="h6">
                    {t("kanban_view_not_available")}
                </Typography>
                <Typography variant="body2" color="secondary" className="text-center max-w-md">
                    {t("kanban_view_requires_enum")}
                </Typography>
                {kanbanSetupSlots.length > 0 && kanbanSetupSlots[0]}
            </div>
        );
    }

    // Note: Empty state is not shown for Kanban view - we show the board with empty columns instead
    // The emptyComponent is handled per-column in BoardColumn

    // No columns
    if (columns.length === 0) {
        return (
            <div className="h-full flex items-center justify-center p-8">
                <Typography variant="label" color="secondary">
                    {t("no_enum_values_configured", { property: columnProperty })}
                </Typography>
            </div>
        );
    }

    return (
        <div className="flex-1 flex flex-col overflow-hidden">
            {/* Error banner - only show when no data loaded */}
            {hasError && allSnapshots.length === 0 && (
                <div
                    className="flex items-center gap-4 px-4 py-3 bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800">
                    <Typography variant="body2" className="text-red-700 dark:text-red-300 flex-1">
                        <strong>Error:</strong>{" "}
                        {indexUrl
                            ? "A Firestore index is required for this query."
                            : errorMessage}
                    </Typography>
                    <Tooltip title={t("refresh_data")}>
                        <IconButton
                            size="small"
                            onClick={() => boardDataController.refreshAll()}
                        >
                            <RefreshCwIcon size={iconSize.smallest}/>
                        </IconButton>
                    </Tooltip>
                    {indexUrl && (
                        <Button
                            size="small"
                            variant="filled"
                            color="error"
                            onClick={() => window.open(indexUrl, "_blank")}
                        >
                            {t("create_index")}
                        </Button>
                    )}
                </div>
            )}

            {/* Warning: orderProperty not configured - drag reorder won't persist */}
            {!orderProperty && !dataLoading && (
                <div
                    className="flex items-center justify-between gap-4 px-4 py-2 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800">
                    <Typography variant="body2" color="secondary">
                        {t("kanban_order_not_configured")}
                    </Typography>
                    {kanbanSetupSlots.length > 0 && kanbanSetupSlots[0]}
                </div>
            )}

            {/* Backfill info bar - non-blocking */}
            {itemsNeedBackfill && !dataLoading && (
                <div
                    className="flex items-center justify-between gap-4 px-4 py-2 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800">
                    <Typography variant="body2" color="secondary">
                        {t("items_need_backfill")}
                    </Typography>
                    <Button
                        size="small"
                        variant="text"
                        onClick={() => setShowBackfillDialog(true)}
                    >
                        {t("initialize")}
                    </Button>
                </div>
            )}

            {/* Main board */}
            <div className="flex-1 overflow-auto no-scrollbar">
                <KanbanView
                    data={boardItems}
                    columns={columns}
                    columnLabels={columnLabels}
                    columnColors={columnColors}
                    assignColumn={assignColumn}
                    allowColumnReorder={allowColumnReorder}
                    onColumnReorder={handleColumnReorder}
                    onItemsReorder={handleItemsReorder}
                    ItemComponent={ItemComponent}
                    columnLoadingState={columnLoadingState}
                    onLoadMoreColumn={(column) => boardDataController.loadMoreColumn(column)}
                    onAddItemToColumn={(column) => {
                        analyticsController.onAnalyticsEvent?.("kanban_new_snapshot_in_column", {
                            path: fullPath,
                            column
                        });
                        sideSnapshotController.open({
                            path: fullPath,
                            collection,
                            snapshotId: undefined,
                            updateUrl: true,
                            formProps: {
                                initialDirtyValues: {
                                    [columnProperty]: column
                                } as Partial<M>
                            }
                        });
                    }}
                    AddColumnComponent={addKanbanColumnSlots.length > 0 ? addKanbanColumnSlots[0] : undefined}
                />
            </div>

            {/* Backfill dialog */}
            <Dialog open={showBackfillDialog} onOpenChange={setShowBackfillDialog}>
                <DialogTitle hidden>{t("initialize_kanban_order")}</DialogTitle>
                <DialogContent>
                    <Typography variant="h6" className="mb-4">{t("initialize_kanban_order")}</Typography>
                    <Typography variant="body2">
                        {t("initialize_kanban_order_desc")}
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button variant="text" onClick={() => setShowBackfillDialog(false)} disabled={backfillLoading}>
                        {t("cancel")}
                    </Button>
                    <Button onClick={handleBackfill} disabled={backfillLoading}>
                        {backfillLoading ? <CircularProgress size="smallest"/> : t("initialize")}
                    </Button>
                </DialogActions>
            </Dialog>
        </div>
    );
}
