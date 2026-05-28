import { useCallback, useMemo } from "react";
import { setIn } from "@rebasepro/formex";
import { EntityCollection, SaveEntityProps, RebaseData, RebaseContext } from "@rebasepro/types";
import { saveEntityWithCallbacks } from "@rebasepro/core";
import { BoardItem } from "../board_types";
import { generateKeyBetween } from "fractional-indexing";

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
    // Uses string-based fractional indexing via `generateKeyBetween`
    // to compute a single new sort key for the moved item.
    // Only one DB write per drag — the moved item gets its new key.
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

        // Build updated values
        let updatedValues: Record<string, unknown> = {};

        // Calculate new order key using string fractional indexing
        if (orderProperty) {
            // Get items in the target column in their new visual order
            // 'items' passed from Board.tsx is exactly the array of items in the target column
            const targetColumnItems = items;

            const movedIndex = targetColumnItems.findIndex(item => item.id === moveInfo.itemId);

            // Get the order keys of the neighbours
            const prevKey = movedIndex > 0
                ? (targetColumnItems[movedIndex - 1].entity.values?.[orderProperty] as string | null) ?? null
                : null;
            const nextKey = movedIndex < targetColumnItems.length - 1
                ? (targetColumnItems[movedIndex + 1].entity.values?.[orderProperty] as string | null) ?? null
                : null;

            try {
                const a = prevKey;
                let b = nextKey;
                if (a !== null && b !== null && a >= b) {
                    // Handle duplicate or out-of-order keys to prevent fractional-indexing crash
                    b = null;
                }
                const newKey = generateKeyBetween(a, b);
                updatedValues = setIn(updatedValues, orderProperty, newKey);
            } catch (e) {
                // Fallback: if keys are somehow invalid, generate from scratch
                console.warn("fractional-indexing error, falling back:", e);
                const newKey = generateKeyBetween(null, null);
                updatedValues = setIn(updatedValues, orderProperty, newKey);
            }
        }

        // Update column if it changed
        if (isColumnChange) {
            updatedValues = setIn(updatedValues, columnProperty, moveInfo.targetColumn);
        }

        // Apply optimistic UI update to boardDataController's internal state
        // This ensures the backend state matches the dragged UI state instantly
        // and prevents the Board component from reverting the dragged item
        if (boardDataController.moveItemOptimistically) {
            const targetIndex = items.findIndex(item => item.id === moveInfo.itemId);
            boardDataController.moveItemOptimistically(
                moveInfo.itemId,
                moveInfo.sourceColumn,
                moveInfo.targetColumn,
                updatedValues,
                targetIndex !== -1 ? targetIndex : undefined
            );
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
                afterSave: () => {},
                afterSaveError: (e: Error) => {
                    console.error("Failed to save entity after reorder:", e);
                    if (boardDataController.refreshAll) {
                        boardDataController.refreshAll();
                    }
                }
            });
        } catch (e) {
            console.error("Error saving entity:", e);
            if (boardDataController.refreshAll) {
                boardDataController.refreshAll();
            }
        }
    }, [collection, columnProperty, orderProperty, context, dataClient, boardDataController, analyticsController, fullPath]);

    return useMemo(() => ({ handleItemsReorder }), [handleItemsReorder]);
}
