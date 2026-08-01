import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
    closestCorners,
    DndContext,
    DragEndEvent,
    DragOverEvent,
    DragOverlay,
    DragStartEvent,
    PointerSensor,
    useSensor,
    useSensors
} from "@dnd-kit/core";
import { arrayMove, SortableContext } from "@dnd-kit/sortable";
import { BoardColumn } from "./BoardColumn";
import { BoardItem, BoardItemMap, BoardProps } from "./board_types";
import { cls } from "../../util";

export function Board<T, COLUMN extends string>({
    data,
    columns: columnsProp,
    columnLabels,
    columnColors,
    className,
    assignColumn,
    allowColumnReorder = false,
    onColumnReorder,
    onItemsReorder,
    ItemComponent,
    columnLoadingState,
    onLoadMoreColumn,
    onAddItemToColumn,
    AddColumnComponent
}: BoardProps<T, COLUMN>) {

    const [activeItem, setActiveItem] = useState<BoardItem<T> | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [dragOverColumnId, setDragOverColumnId] = useState<string | null>(null);

    /**
     * Which column the card was picked up from.
     *
     * `handleDragOver` moves the card between columns in `itemMapState` while
     * the pointer is still down — that is what makes the gap open up under the
     * cursor. So by the time the drop is handled, looking the card up by id
     * finds it in its *destination*, and the board was reporting the move as
     * source === target: a cross-column drop looked like a plain reorder and
     * the column property was never written. The card snapped back on the next
     * fetch.
     */
    const dragSourceColumnRef = useRef<COLUMN | null>(null);

    const [itemMapState, setItemMapState] = useState<BoardItemMap<T>>(() => {
        const dataColumnMap: Record<string, COLUMN> = data.reduce((prev, item: BoardItem<T>) => ({
            ...prev,
            [item.id]: assignColumn(item)
        }), {});
        return columnsProp.reduce(
            (previous: BoardItemMap<T>, column: COLUMN) => ({
                ...previous,
                [column]: data.filter((item: BoardItem<T>) => dataColumnMap[item.id] === column)
            }),
            {} as BoardItemMap<T>
        );
    });

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 5
            }
        })
    );

    useEffect(() => {
        if (isDragging) return;

        const dataColumnMap: Record<string, COLUMN> = data.reduce((prev, item) => ({
            ...prev,
            [item.id]: assignColumn(item)
        }), {});

        const newItemMap = columnsProp.reduce(
            (previous: BoardItemMap<T>, column: COLUMN) => ({
                ...previous,
                [column]: data.filter((item: BoardItem<T>) => dataColumnMap[item.id] === column)
            }),
            {} as BoardItemMap<T>
        );

        setItemMapState(prevMap => {
            let changed = false;

            for (const col of columnsProp) {
                const prevItems = prevMap[col] ?? [];
                const newItems = newItemMap[col] ?? [];

                if (prevItems.length !== newItems.length) {
                    changed = true;
                    continue;
                }
                for (let i = 0; i < prevItems.length; i++) {
                    if (prevItems[i].id !== newItems[i].id || prevItems[i].data !== newItems[i].data) {
                        changed = true;
                        break;
                    }
                }
            }

            if (!changed) {
                return prevMap;
            }

            const updated: BoardItemMap<T> = {};
            for (const col of columnsProp) {
                const prevItems = prevMap[col] ?? [];
                const newItems = newItemMap[col] ?? [];

                const prevById = new Map<string, BoardItem<T>>();
                for (const item of prevItems) {
                    prevById.set(item.id, item);
                }

                updated[col] = newItems.map(newItem => {
                    const prev = prevById.get(newItem.id);
                    if (prev && prev.data === newItem.data) {
                        return prev;
                    }
                    return newItem;
                });
            }
            return updated;
        });
    }, [data, columnsProp, assignColumn]);

    const findColumnByItemId = (id: string): string | undefined => {
        return Object.keys(itemMapState).find(col => itemMapState[col]?.some(i => i.id === id));
    };

    const handleDragStart = (event: DragStartEvent) => {
        setIsDragging(true);
        setDragOverColumnId(null);
        const { active } = event;

        if (active.data.current?.type === "ITEM") {
            const columnId = findColumnByItemId(active.id as string);
            dragSourceColumnRef.current = (columnId as COLUMN | undefined) ?? null;
            if (columnId) {
                const item = itemMapState[columnId]?.find(i => i.id === active.id);
                setActiveItem(item || null);
            }
        }
    };

    const handleDragOver = (event: DragOverEvent) => {
        const {
            active,
            over
        } = event;

        if (!over) {
            setDragOverColumnId(null);
            return;
        }

        let currentHoveredColumnId: string | null = null;
        const overId = over.id as string;
        const overDataType = over.data.current?.type as string | undefined;

        if (overDataType === "ITEM-LIST" || overDataType === "COLUMN") {
            currentHoveredColumnId = overId;
        } else if (overDataType === "ITEM") {
            currentHoveredColumnId = findColumnByItemId(overId) || null;
        } else if (columnsProp.includes(overId as COLUMN)) {
            currentHoveredColumnId = overId;
        }

        setDragOverColumnId(currentHoveredColumnId);

        if (active.data.current?.type !== "ITEM") {
            return;
        }

        const activeId = active.id as string;
        const activeItemColumn = findColumnByItemId(activeId);
        let overColumnForMove = findColumnByItemId(overId);

        if (!overColumnForMove && overDataType === "ITEM-LIST") {
            overColumnForMove = overId;
        }
        if (!overColumnForMove && columnsProp.includes(overId as COLUMN)) {
            overColumnForMove = overId;
        }

        if (!activeItemColumn || !overColumnForMove) return;
        if (activeItemColumn === overColumnForMove) return;

        if (itemMapState[overColumnForMove]?.some(i => i.id === activeId)) {
            return;
        }

        setItemMapState(currentMap => {
            const activeItems = [...(currentMap[activeItemColumn] || [])];
            const overItems = [...(currentMap[overColumnForMove!] || [])];
            const activeIndex = activeItems.findIndex(i => i.id === activeId);

            if (activeIndex === -1) return currentMap;

            let overIndex;
            if (overDataType === "ITEM-LIST" || (columnsProp.includes(overId as COLUMN) && !findColumnByItemId(overId))) {
                overIndex = overItems.length;
            } else {
                overIndex = overItems.findIndex(i => i.id === overId);
                if (overIndex !== -1) {
                    const activeTop = active.rect.current.translated?.top ?? 0;
                    const activeHeight = active.rect.current.translated?.height ?? 0;
                    const activeCenter = activeTop + activeHeight / 2;

                    const overTop = over?.rect.top ?? 0;
                    const overHeight = over?.rect.height ?? 0;
                    const overCenter = overTop + overHeight / 2;

                    const isBelowOverItem = activeCenter > overCenter;

                    const modifier = isBelowOverItem ? 1 : 0;
                    overIndex = overIndex >= 0 ? overIndex + modifier : overItems.length;
                } else {
                    overIndex = overItems.length;
                }
            }

            const newItemMap = { ...currentMap };
            const [moved] = activeItems.splice(activeIndex, 1);
            overItems.splice(overIndex, 0, moved);
            newItemMap[activeItemColumn] = activeItems;
            newItemMap[overColumnForMove!] = overItems;
            return newItemMap;
        });
    };

    // Escape, or a drop outside the board. `handleDragOver` may already have
    // moved the card between columns, so the next `data` effect has to be
    // allowed to put it back.
    const handleDragCancel = () => {
        setIsDragging(false);
        setActiveItem(null);
        setDragOverColumnId(null);
        dragSourceColumnRef.current = null;
    };

    const handleDragEnd = (event: DragEndEvent) => {
        const {
            active,
            over
        } = event;

        const sourceColumn = dragSourceColumnRef.current;

        setIsDragging(false);
        setActiveItem(null);
        setDragOverColumnId(null);
        dragSourceColumnRef.current = null;

        if (!over) return;

        const activeId = active.id as string;
        const overId = over.id as string;

        if (active.data.current?.type === "COLUMN") {
            if (activeId !== overId) {
                const oldIndex = columnsProp.indexOf(activeId as COLUMN);
                const newIndex = columnsProp.indexOf(overId as COLUMN);
                if (oldIndex !== -1 && newIndex !== -1) {
                    const reordered = arrayMove(columnsProp, oldIndex, newIndex);
                    onColumnReorder?.(reordered);
                }
            }
            return;
        }

        // Where the card sits right now — `handleDragOver` has already put it in
        // the column being hovered, so this is the destination, not the origin.
        const currentCol = findColumnByItemId(activeId) as COLUMN | undefined;
        let targetCol = findColumnByItemId(overId) as COLUMN | undefined;

        if (!targetCol) {
            const overDataType = over.data.current?.type;
            if (overDataType === "ITEM-LIST" || columnsProp.includes(overId as COLUMN)) {
                targetCol = overId as COLUMN;
            }
        }
        targetCol = targetCol ?? currentCol;

        if (!currentCol || !targetCol) return;

        const targetItems = itemMapState[targetCol] || [];
        const activeIndex = (itemMapState[currentCol] || []).findIndex(i => i.id === activeId);
        if (activeIndex === -1) return;

        // Which card the pointer was over. `-1` means it was over the column
        // itself: an empty column, or the space under the last card. That used
        // to abort the drop outright, so a card dragged to an empty column
        // moved on screen and was never saved.
        const overIndexInTarget = targetItems.findIndex(i => i.id === overId);
        const indexInTarget = targetItems.findIndex(i => i.id === activeId);
        const changedColumn = (sourceColumn ?? currentCol) !== targetCol;

        let finalTargetItems: BoardItem<T>[];
        if (indexInTarget === -1) {
            // Not placed by `handleDragOver` — drop straight into the slot.
            const moved = (itemMapState[currentCol] || [])[activeIndex];
            finalTargetItems = [...targetItems];
            finalTargetItems.splice(overIndexInTarget === -1 ? targetItems.length : overIndexInTarget, 0, moved);
        } else if (overIndexInTarget !== -1) {
            finalTargetItems = arrayMove(targetItems, indexInTarget, overIndexInTarget);
        } else if (changedColumn) {
            // Over the column, not a card, and `handleDragOver` already opened
            // the gap the card is sitting in. Appending here is what sent a
            // card dropped into the middle of another column to the bottom of
            // it — the position it was dropped at is the one on screen.
            finalTargetItems = targetItems;
        } else {
            // Same column, released below the last card.
            finalTargetItems = arrayMove(targetItems, indexInTarget, targetItems.length - 1);
        }

        onItemsReorder?.(finalTargetItems, {
            itemId: activeId,
            // The column the pointer went down in. `currentCol` would report a
            // cross-column move as a same-column reorder.
            sourceColumn: (sourceColumn ?? currentCol),
            targetColumn: targetCol
        });
    };

    return (
        <DndContext
            sensors={sensors}
            // `rectIntersection`, the default, only reports a target while the
            // dragged rect physically overlaps it, and prefers whichever
            // overlap is largest — on a board of tall columns that means a card
            // held over a gap reports nothing, and one held near a column edge
            // reports the neighbour. `closestCorners` is the sortable-list
            // recommendation and is what makes the drop land where it looks
            // like it will.
            collisionDetection={closestCorners}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
        >
            <div className={cls("flex flex-row h-full w-full overflow-x-auto p-4 select-none items-start", className)}>
                <SortableContext items={columnsProp}>
                    {columnsProp.map((col, index) => {
                        const colItems = itemMapState[col] || [];
                        const loadingState = columnLoadingState?.[col];
                        return (
                            <BoardColumn
                                key={String(col)}
                                id={String(col)}
                                title={columnLabels?.[col] ?? String(col)}
                                items={colItems}
                                index={index}
                                ItemComponent={ItemComponent}
                                isDragging={isDragging}
                                isDragOverColumn={dragOverColumnId === String(col)}
                                allowReorder={allowColumnReorder}
                                loading={loadingState?.loading}
                                hasMore={loadingState?.hasMore}
                                error={loadingState?.error}
                                totalCount={loadingState?.totalCount}
                                color={columnColors?.[col]}
                                onLoadMore={onLoadMoreColumn ? () => onLoadMoreColumn(col) : undefined}
                                onAddItem={onAddItemToColumn ? () => onAddItemToColumn(col) : undefined}
                            />
                        );
                    })}
                </SortableContext>
                {AddColumnComponent}
            </div>

            {/* The overlay used to be positioned by hand, from `mousemove`
                listeners on `window` and a grab offset measured off whatever
                `[role='button']` the pointer went down on. dnd-kit already
                tracks the pointer and already knows the grab offset — the
                hand-rolled copy drifted from the position collision detection
                was actually using, so the card you saw and the slot you got
                were two different things. */}
            {typeof document !== "undefined" && createPortal(
                <DragOverlay dropAnimation={null} zIndex={9999}>
                    {activeItem && (
                        <ItemComponent
                            item={activeItem}
                            isDragging={true}
                            isClone={true}
                        />
                    )}
                </DragOverlay>,
                document.body
            )}
        </DndContext>
    );
}
