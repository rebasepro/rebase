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

    // Handle item reorder and column changes.
    // Uses simple integer positions: when an item moves, we reassign
    // clean 0, 1, 2, 3… order values to every item in the affected column(s).
    // This avoids fractional indexing precision issues entirely.
    const handleItemsReorder = useCallback(async (
        items: BoardItem<M>[],
        moveInfo?: { itemId: string; sourceColumn: string; targetColumn: string; }
    ) => {
        const entity = items.find(item => item.id === moveInfo?.itemId)?.entity;
        if (!entity || !moveInfo) return;

        analyticsController.onAnalyticsEvent?.("kanban_card_moved", {
            path: fullPath,
            entityId: entity.id,
            sourceColumn: moveInfo.sourceColumn,
            targetColumn: moveInfo.targetColumn
        });

        const isColumnChange = moveInfo.sourceColumn !== moveInfo.targetColumn;

        // If no orderProperty and not a column change, nothing to do
        if (!orderProperty && !isColumnChange) return;

        // Optimistic update: update column counts immediately when moving between columns
        if (isColumnChange) {
            boardDataController.updateColumnCounts(moveInfo.sourceColumn, moveInfo.targetColumn);
        }

        // Collect items per affected column in their new visual order
        const targetColumnItems = items.filter(item => {
            // The moved item is already in its new position in the flat list,
            // so we check: is this item the moved one (assign to target), or
            // does it belong to the target column?
            if (item.id === moveInfo.itemId) return true;
            const col = item.entity.values?.[columnProperty];
            return String(col) === moveInfo.targetColumn;
        });

        // Build save promises for all items in the target column
        const saves: Promise<void>[] = [];

        for (let i = 0; i < targetColumnItems.length; i++) {
            const item = targetColumnItems[i];
            let updatedValues: Record<string, unknown> = {};

            // Set integer order position if orderProperty is configured
            if (orderProperty) {
                updatedValues = setIn(updatedValues, orderProperty, i);
            }

            // Update column value for the moved item
            if (item.id === moveInfo.itemId && isColumnChange) {
                updatedValues = setIn(updatedValues, columnProperty, moveInfo.targetColumn);
            }

            // Skip if nothing to update (same column reorder without orderProperty)
            if (Object.keys(updatedValues).length === 0) continue;

            const saveProps: SaveEntityProps = {
                path: item.entity.path,
                entityId: item.entity.id,
                values: updatedValues as M,
                previousValues: item.entity.values,
                collection,
                status: "existing"
            };

            saves.push(
                saveEntityWithCallbacks({
                    ...saveProps,
                    collection,
                    data: dataClient,
                    context,
                    afterSave: () => {},
                    afterSaveError: (e: Error) => console.error("Failed to save entity after reorder:", e)
                }).then(() => {})
            );
        }

        // If cross-column move, also re-number the source column to close the gap
        if (isColumnChange && orderProperty) {
            const sourceColumnItems = items.filter(item => {
                if (item.id === moveInfo.itemId) return false;
                const col = item.entity.values?.[columnProperty];
                return String(col) === moveInfo.sourceColumn;
            });

            for (let i = 0; i < sourceColumnItems.length; i++) {
                const item = sourceColumnItems[i];
                const updatedValues = setIn({}, orderProperty, i);

                const saveProps: SaveEntityProps = {
                    path: item.entity.path,
                    entityId: item.entity.id,
                    values: updatedValues as M,
                    previousValues: item.entity.values,
                    collection,
                    status: "existing"
                };

                saves.push(
                    saveEntityWithCallbacks({
                        ...saveProps,
                        collection,
                        data: dataClient,
                        context,
                        afterSave: () => {},
                        afterSaveError: (e: Error) => console.error("Failed to save entity after reorder:", e)
                    }).then(() => {})
                );
            }
        }

        try {
            await Promise.all(saves);
        } catch (e) {
            console.error("Error saving entities after reorder:", e);
        }
    }, [collection, columnProperty, orderProperty, context, dataClient, boardDataController, analyticsController, fullPath]);

    return useMemo(() => ({ handleItemsReorder }), [handleItemsReorder]);
}
