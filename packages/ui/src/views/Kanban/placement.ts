import { arrayMove } from "@dnd-kit/sortable";
import { BoardItem } from "./board_types";

export interface PlaceDroppedCardParams<T> {
    /**
     * The destination column as it stands at the moment of the drop. When the
     * card came from another column it is normally already in here:
     * `handleDragOver` moves it while the pointer is still down, which is what
     * opens the gap under the cursor.
     */
    targetItems: BoardItem<T>[];
    /** The card being dropped. */
    movedItem: BoardItem<T>;
    /** What the pointer was over — a card id, or the column's own droppable id. */
    overId: string;
    /** Whether the card was picked up in a different column than it landed in. */
    changedColumn: boolean;
}

/**
 * Where a dropped card ends up in its destination column.
 *
 * Pulled out of the drop handler because it is the part that was wrong twice:
 * once appending a card that had been dropped into the middle of a column, and
 * once refusing to place a card at all when it was released over an empty
 * column rather than over another card. It is pure, so it can be checked
 * without driving a pointer.
 */
export function placeDroppedCard<T>({
    targetItems,
    movedItem,
    overId,
    changedColumn
}: PlaceDroppedCardParams<T>): BoardItem<T>[] {

    const indexInTarget = targetItems.findIndex(i => i.id === movedItem.id);
    const overIndex = targetItems.findIndex(i => i.id === overId);

    // Not placed during the drag — drop straight into the slot. `-1` means the
    // pointer was over the column itself (an empty one, or the space below the
    // last card), which appends.
    if (indexInTarget === -1) {
        const placed = [...targetItems];
        placed.splice(overIndex === -1 ? targetItems.length : overIndex, 0, movedItem);
        return placed;
    }

    // Released over another card: that card's slot is the one the user chose.
    if (overIndex !== -1) {
        return arrayMove(targetItems, indexInTarget, overIndex);
    }

    // Released over the column rather than a card. The card is already sitting
    // in the gap the drag opened, so its position is the one on screen —
    // appending here is what used to send it to the bottom.
    if (changedColumn) {
        return targetItems;
    }

    // Same column, released below the last card.
    return arrayMove(targetItems, indexInTarget, targetItems.length - 1);
}
