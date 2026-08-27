
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Entity, EnumValueConfig, MAX_LIST_LIMIT } from "@rebasepro/types";
import { EntityTableController, SelectionController, AdminCollection } from "@rebasepro/cms-types";
import { BoardCardBinding } from "./BoardCardBinding";
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
    saveEntityWithCallbacks,
    SaveEntityWithCallbacksProps,
    useAuthController,
    useCustomizationController,
    useData,
    useRebaseContext,
    useTranslation,
    useSlot
} from "@rebasepro/app";
import { useAnalyticsController } from "@rebasepro/app";
import { setIn } from "@rebasepro/forms";
import { useBoardDataController } from "./useBoardDataController";
import { isValidOrderKey, ORDER_KEY_DIGITS, useKanbanDragAndDrop } from "./hooks/useKanbanDragAndDrop";
import { useSidePanel } from "../../hooks/useSidePanel";
import { generateNKeysBetween } from "fractional-indexing";

export type CollectionBoardViewBindingProps<M extends Record<string, unknown> = Record<string, unknown>> = {
    collection: AdminCollection<M>;
    tableController: EntityTableController<M>;
    fullPath: string;
    parentCollectionSlugs?: string[], parentEntityIds?: string[];
    columnProperty: string;
    onEntityClick?: (entity: Entity<M>) => void;
    selectionController?: SelectionController<M>;
    selectionEnabled?: boolean;
    highlightedEntities?: Entity<M>[];
    emptyComponent?: React.ReactNode;
    /** Called when entities are deleted - used for optimistic count updates */
    deletedEntities?: Entity<M>[];
};

/**
 * Kanban board view for displaying entities grouped by a string enum property.
 */
export function CollectionBoardViewBinding<M extends Record<string, unknown> = Record<string, unknown>>({
    collection,
    tableController,
    fullPath,
    parentCollectionSlugs = [],
    parentEntityIds = [],
    columnProperty,
    onEntityClick,
    selectionController,
    selectionEnabled = true,
    highlightedEntities,
    emptyComponent,
    deletedEntities
}: CollectionBoardViewBindingProps<M>) {
    const customizationController = useCustomizationController();
    const context = useRebaseContext();
    const dataClient = useData();
    const sidePanelController = useSidePanel();
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

    // Track previously processed deleted entities to avoid double-counting
    const processedDeletedRef = useRef<Set<string>>(new Set());

    // Optimistic update for column counts when entities are deleted
    useEffect(() => {
        if (!deletedEntities || deletedEntities.length === 0) return;

        // Calculate column deltas from deleted entities
        const deltas: Record<string, number> = {};
        deletedEntities.forEach(entity => {
            // Skip if we've already processed this entity
            if (processedDeletedRef.current.has(String(entity.id))) return;
            processedDeletedRef.current.add(String(entity.id));

            const col = entity.values?.[columnProperty];
            if (col && typeof col === "string") {
                deltas[col] = (deltas[col] ?? 0) + 1;
            }
        });

        if (Object.keys(deltas).length > 0) {
            boardDataController.decrementColumnCounts(deltas);
        }
    }, [deletedEntities, columnProperty, boardDataController]);

    // Build all entities from all columns for operations that need the full list
    const allEntities = useMemo(() => {
        const entities: Entity<M>[] = [];
        const seenIds = new Set<string>();
        columns.forEach(col => {
            const colData = boardDataController.columnData[col];
            if (colData?.entities) {
                colData.entities.forEach((entity: Entity<M>) => {
                    const idStr = String(entity.id);
                    if (!seenIds.has(idStr)) {
                        seenIds.add(idStr);
                        entities.push(entity);
                    }
                });
            }
        });
        return entities;
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
parentEntityIds,
                    collection,
                    kanbanColumnProperty: columnProperty,
                    newColumnsOrder: newColumns
                });
            });
    }, [plugins, fullPath, parentCollectionSlugs, parentEntityIds, collection, columnProperty, analyticsController]);

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
        // A value that is present but is not a fractional-indexing key is no
        // more usable than a missing one — dropping a card next to it cannot
        // produce a key between the two — so it earns the same offer to
        // initialise the column.
        return allEntities.some((entity: Entity<M>) => !isValidOrderKey(entity.values?.[orderProperty]));
    }, [allEntities, orderProperty, dataLoading, missingOrderCount]);

    // Create a lookup map of entity ID → column from boardDataController data
    // This ensures items stay in the column they were fetched for, not re-evaluated from entity.values
    const entityColumnMap = useMemo(() => {
        const map: Record<string, string> = {};
        columns.forEach(col => {
            const colData = boardDataController.columnData[col];
            if (colData?.entities) {
                colData.entities.forEach((entity: Entity<M>) => {
                    map[String(entity.id)] = col;
                });
            }
        });
        return map;
    }, [columns, boardDataController.columnData]);

    // Convert entities to board items per column (data already sorted by orderProperty from controller)
    const boardItems: BoardItem<Entity<M>>[] = useMemo(() => {
        return allEntities.map((entity: Entity<M>) => ({
            id: String(entity.id),
            data: entity
        }));
    }, [allEntities]);

    // Column loading state from the board data controller
    const columnLoadingState: ColumnLoadingState = useMemo(() => {
        const state: ColumnLoadingState = {};
        columns.forEach(col => {
            const colData = boardDataController.columnData[col];
            state[col] = {
                loading: colData?.loading ?? true,
                hasMore: colData?.hasMore ?? false,
                itemCount: colData?.entities?.length ?? 0,
                totalCount: colData?.totalCount,
                error: colData?.error
            };
        });
        return state;
    }, [columns, boardDataController.columnData]);

    // Use the lookup map to assign columns - ensures items stay in the column they were fetched for
    const assignColumn = useCallback((item: BoardItem<Entity<M>>): string => {
        const column = entityColumnMap[item.id];
        if (column) return column;
        // Fallback: read from entity values (for newly created items or edge cases)
        const value = item.data.values?.[columnProperty];
        if (value && columns.includes(String(value))) return String(value);
        return columns[0] || "";
    }, [entityColumnMap, columnProperty, columns]);

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

    // Backfill order values for all entities
    const handleBackfill = useCallback(async () => {
        if (!orderProperty) {
            return;
        }
        analyticsController.onAnalyticsEvent?.("kanban_backfill_order", {
            path: fullPath
        });
        setBackfillLoading(true);

        try {
            // Fetch the documents to key (not relying on loaded entities). No
            // `orderBy`: with no usable order key there is nothing to order by,
            // and this is the same query the columns themselves run, so the
            // keys are handed out in the order the board is showing — which is
            // what the dialog promises.
            //
            // `MAX_LIST_LIMIT`, not a made-up 10 000: that is the most a single
            // read serves, and asking for more is now refused outright rather
            // than quietly answered with the first thousand. A board past the
            // ceiling still gets only its first page backfilled — the same rows
            // as before this became explicit — and wants a paged walk.
            const allDocsRes = await dataClient.collection(fullPath).find({
                limit: MAX_LIST_LIMIT
            });
            const allDocs = allDocsRes.data as Entity<M>[];

            // Entities without a usable order key. Testing only for null here
            // meant a column full of unusable values — `"12"`, `"6"` — offered
            // an Initialize button that updated nothing and never went away.
            const entitiesToUpdate = allDocs.filter((entity: Entity<M>) =>
                !isValidOrderKey(entity.values?.[orderProperty]));

            // Generate string fractional keys for all entities that need them
            const keys = generateNKeysBetween(null, null, entitiesToUpdate.length, ORDER_KEY_DIGITS);
            const updates: Promise<void>[] = [];
            entitiesToUpdate.forEach((entity: Entity<M>, index: number) => {
                const updatedValues = setIn({ ...entity.values }, orderProperty, keys[index]);

                const saveProps: SaveEntityWithCallbacksProps<Record<string, unknown>> = {
                    path: entity.path,
                    entityId: entity.id,
                    values: updatedValues as M,
                    previousValues: entity.values,
                    collection,
                    status: "existing"
                };

                updates.push(
                    saveEntityWithCallbacks({
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

    const handleEntityClick = useCallback((entity: Entity<M>) => {
        onEntityClick?.(entity);
    }, [onEntityClick]);

    const handleSelectionChange = useCallback((entity: Entity<M>, selected: boolean) => {
        selectionController?.toggleEntitySelection(entity, selected);
    }, [selectionController]);

    const isEntitySelected = useCallback((entity: Entity<M>) => {
        return selectionController?.isEntitySelected(entity) ?? false;
    }, [selectionController]);

    // Store latest callbacks in refs so the stable ItemComponent always
    // reads fresh values without changing its own identity.
    const handleEntityClickRef = useRef(handleEntityClick);
    handleEntityClickRef.current = handleEntityClick;
    const isEntitySelectedRef = useRef(isEntitySelected);
    isEntitySelectedRef.current = isEntitySelected;
    const handleSelectionChangeRef = useRef(handleSelectionChange);
    handleSelectionChangeRef.current = handleSelectionChange;
    const selectionEnabledRef = useRef(selectionEnabled);
    selectionEnabledRef.current = selectionEnabled;

    // Stable callback wrappers — identity never changes, delegates to refs.
    const stableOnClick = useCallback((entity: Entity<M>) => {
        handleEntityClickRef.current(entity);
    }, []);
    const stableOnSelectionChange = useCallback((entity: Entity<M>, sel: boolean) => {
        handleSelectionChangeRef.current(entity, sel);
    }, []);

    // Build a single, truly stable component reference.
    // Uses refs for ALL dynamic values so the component type never changes.
    // When ItemComponent identity changes, React.memo'd SortableItem remounts
    // the card → DOM is destroyed/recreated → CSS :hover state is lost → flicker.
    const ItemComponent = useMemo(() => {
        const Comp = (props: BoardItemViewProps<Entity<M>>) => (
            <BoardCardBinding
                {...props}
                collection={collectionRef.current as AdminCollection<M>}
                onClick={stableOnClick}
                selected={isEntitySelectedRef.current(props.item.data)}
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
        parentEntityIds
    });

    // Get AddKanbanColumnComponent from plugin slots
    const addKanbanColumnSlots = useSlot("kanban.add-column", {
        collection,
        fullPath,
        parentCollectionSlugs,
parentEntityIds,
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
            {hasError && allEntities.length === 0 && (
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

            {/* Main board. It scrolls its own columns vertically and its own
                row horizontally, so an `overflow-auto` here only added a second
                scroll container around both. */}
            <div className="flex-1 min-h-0 overflow-hidden">
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
                        analyticsController.onAnalyticsEvent?.("kanban_new_entity_in_column", {
                            path: fullPath,
                            column
                        });
                        sidePanelController.open({
                            path: fullPath,
                            collection,
                            entityId: undefined,
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
