import { useCallback, useMemo } from "react";
import { setIn } from "@rebasepro/formex";
import { EntityCollection, SaveEntityProps, RebaseData, RebaseContext } from "@rebasepro/types";
import { saveEntityWithCallbacks } from "@rebasepro/core";
import { BoardItem } from "../board_types";

export interface UseKanbanDragAndDropParams<M extends Record<string, unknown>> {
    collection: EntityCollection<M>;
    fullPath: string;
    columnProperty: string;
    orderProperty?: string;
    dataClient: RebaseData;
    context: RebaseContext;
    boardDataController: any;
    analyticsController: any;
}

export function useKanbanDragAndDrop<M extends Record<string, unknown>>({
    collection,
    fullPath,
    columnProperty,
    orderProperty,
    dataClient,
    context,
    boardDataController,
    analyticsController
}: UseKanbanDragAndDropParams<M>) {

    // Helper to calculate new fractional order when items are moved
    const calculateNewOrder = useCallback((
        items: BoardItem<M>[],
        movedItemId: string,
        targetColumn: string
    ) => {
        if (!orderProperty) return 0;

        // Sort items in the target column by their current order
        const targetColumnItems = items
            .filter(item => {
                const col = item.entity.values?.[columnProperty];
                // Keep the moved item in its new context even if its entity hasn't been updated yet
                return col === targetColumn || item.id === movedItemId;
            })
            .sort((a, b) => {
                const orderA = (a.entity.values?.[orderProperty!] as number) ?? 0;
                const orderB = (b.entity.values?.[orderProperty!] as number) ?? 0;
                return orderA - orderB;
            });

        // Find the moved item's new position in the column
        const movedItemIndex = items.findIndex(item => item.id === movedItemId);
        const movedItem = items[movedItemIndex];

        if (!movedItem) return 0;

        let prevOrder: number | null = null;
        let nextOrder: number | null = null;

        const newColumnItems = items.filter(item => {
            if (item.id === movedItemId) return true;
            const col = item.entity.values?.[columnProperty];
            return col === targetColumn;
        });

        const newIndex = newColumnItems.findIndex(item => item.id === movedItemId);

        if (newIndex > 0) {
            const prevItem = newColumnItems[newIndex - 1];
            prevOrder = (prevItem?.entity.values?.[orderProperty!] as number) ?? null;
        }
        if (newIndex < newColumnItems.length - 1) {
            const nextItem = newColumnItems[newIndex + 1];
            nextOrder = (nextItem?.entity.values?.[orderProperty!] as number) ?? null;
        }

        // Calculate new order using fractional indexing
        if (prevOrder !== null && nextOrder !== null) {
            return (prevOrder + nextOrder) / 2;
        } else if (prevOrder !== null) {
            return prevOrder + 1;
        } else if (nextOrder !== null) {
            return nextOrder - 1;
        }
        return 0;
    }, [columnProperty, orderProperty]);

    // Handle item reorder and column changes
    const handleItemsReorder = useCallback(async (
        items: BoardItem<M>[],
        moveInfo?: { itemId: string; sourceColumn: string; targetColumn: string; }
    ) => {
        const entity = items.find(item => item.id === moveInfo?.itemId)?.entity;
        if (!entity) return;

        analyticsController.onAnalyticsEvent?.("kanban_card_moved", {
            path: fullPath,
            entityId: entity.id,
            sourceColumn: moveInfo?.sourceColumn,
            targetColumn: moveInfo?.targetColumn
        });

        const isColumnChange = moveInfo && moveInfo.sourceColumn !== moveInfo.targetColumn;

        // If no orderProperty and not a column change, nothing to do
        if (!orderProperty && !isColumnChange) return;

        // Optimistic update: update column counts immediately when moving between columns
        if (isColumnChange) {
            boardDataController.updateColumnCounts(moveInfo!.sourceColumn, moveInfo!.targetColumn);
        }

        // Build updated values (Partial Payload to avoid stale data overwrite!)
        let updatedValues = {};

        // Calculate and set new order value (only if orderProperty is configured)
        if (orderProperty) {
            const newOrder = calculateNewOrder(items, moveInfo?.itemId ?? "", moveInfo?.targetColumn ?? "");
            updatedValues = setIn(updatedValues, orderProperty, newOrder) as M;
        }

        // Update column if it changed
        if (isColumnChange) {
            updatedValues = setIn(updatedValues, columnProperty, moveInfo!.targetColumn) as M;
        }

        const saveProps: SaveEntityProps = {
            path: entity.path,
            entityId: entity.id,
            values: updatedValues as M,
            previousValues: entity.values,
            collection,
            status: "existing"
        };

        try {
            await saveEntityWithCallbacks({
                ...saveProps,
                collection,
                data: dataClient,
                context,
                afterSave: () => {
                },
                afterSaveError: (e: Error) => console.error("Failed to save entity after reorder:", e)
            });
        } catch (e) {
            console.error("Error saving entity:", e);
        }
    }, [collection, columnProperty, orderProperty, context, dataClient, calculateNewOrder, boardDataController, analyticsController, fullPath]);

    return useMemo(() => ({ calculateNewOrder,
handleItemsReorder }), [calculateNewOrder, handleItemsReorder]);
}
