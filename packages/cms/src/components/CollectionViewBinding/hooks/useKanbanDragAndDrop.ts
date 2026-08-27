import { useCallback, useMemo } from "react";
import { setIn } from "@rebasepro/forms";
import { RebaseData, Entity } from "@rebasepro/types";
import { RebaseContext, AnalyticsController, AdminCollection } from "@rebasepro/cms-types";
import { saveEntityWithCallbacks, SaveEntityWithCallbacksProps } from "@rebasepro/app";
import { BoardItem } from "@rebasepro/ui";
import { BoardDataController } from "../useBoardDataController";
import { generateKeyBetween } from "fractional-indexing";

/**
 * The digits a board order key is built from: base36, lower case only.
 *
 * The library's default alphabet is base62, and its keys only sort correctly
 * under byte ordering. The column is sorted by the *database*, and Postgres'
 * default collation is not byte ordering — under `en_US.UTF-8`, `"aa"` sorts
 * before `"aC"`, so as soon as a board had been dragged around enough to reach
 * the upper-case digits its order stopped matching the keys. One case has no
 * such ambiguity: digits before letters is true of every collation in use.
 *
 * A key written with the old alphabet no longer validates, which is what makes
 * the board offer to initialise the column — one click, and the order is
 * rewritten in a form the database can sort.
 */
export const ORDER_KEY_DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";

/**
 * Whether a stored order value is a key `fractional-indexing` can interpolate
 * against.
 *
 * Anything else — a plain `"12"` from a seed or a migration, an empty string —
 * makes `generateKeyBetween` throw, and the fallback below then hands out the
 * same first key to every card, so each drag lands at the bottom of the column
 * on top of the last one that did. Asking the library itself is the only
 * definition of "valid" worth trusting.
 */
export function isValidOrderKey(value: unknown): value is string {
    if (typeof value !== "string" || value.length === 0) return false;
    try {
        generateKeyBetween(value, null, ORDER_KEY_DIGITS);
        return true;
    } catch {
        return false;
    }
}

export interface UseKanbanDragAndDropParams<M extends Record<string, unknown>> {
    collection: AdminCollection<M>;
    fullPath: string;
    columnProperty: string;
    orderProperty?: string;
    dataClient: RebaseData;
    context: RebaseContext;
    boardDataController: BoardDataController<M>;
    analyticsController: AnalyticsController;
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
        items: BoardItem<Entity<M>>[],
        moveInfo?: { itemId: string; sourceColumn: string; targetColumn: string; }
    ) => {
        const entity = items.find(item => item.id === moveInfo?.itemId)?.data;
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

            // The order keys of the neighbours. A neighbour whose key is not a
            // valid one counts as no neighbour at all: interpolating against it
            // throws, and the whole move then falls back to a key that ignores
            // where the card was actually dropped.
            const keyAt = (index: number): string | null => {
                const value = targetColumnItems[index]?.data.values?.[orderProperty];
                return isValidOrderKey(value) ? value : null;
            };
            const prevKey = movedIndex > 0 ? keyAt(movedIndex - 1) : null;
            const nextKey = movedIndex < targetColumnItems.length - 1 ? keyAt(movedIndex + 1) : null;

            try {
                const a = prevKey;
                let b = nextKey;
                if (a !== null && b !== null && a >= b) {
                    // Handle duplicate or out-of-order keys to prevent fractional-indexing crash
                    b = null;
                }
                const newKey = generateKeyBetween(a, b, ORDER_KEY_DIGITS);
                updatedValues = setIn(updatedValues, orderProperty, newKey) as Record<string, unknown>;
            } catch (e) {
                // Fallback: if keys are somehow invalid, generate from scratch
                console.warn("fractional-indexing error, falling back:", e);
                const newKey = generateKeyBetween(null, null, ORDER_KEY_DIGITS);
                updatedValues = setIn(updatedValues, orderProperty, newKey) as Record<string, unknown>;
            }
        }

        // Update column if it changed
        if (isColumnChange) {
            updatedValues = setIn(updatedValues, columnProperty, moveInfo.targetColumn) as Record<string, unknown>;
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

        const saveProps: SaveEntityWithCallbacksProps<Record<string, unknown>> = {
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
