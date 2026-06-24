import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
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
import { BoardItem, BoardItemMap, BoardItemViewProps, BoardProps } from "./board_types";
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
    const [activeColumn, setActiveColumn] = useState<COLUMN | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [dragOverColumnId, setDragOverColumnId] = useState<string | null>(null);

    const grabOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
    const [overlayPos, setOverlayPos] = useState<{ x: number; y: number } | null>(null);

    const handleMouseMove = useCallback((e: MouseEvent) => {
        setOverlayPos({
            x: e.clientX - grabOffsetRef.current.x,
            y: e.clientY - grabOffsetRef.current.y
        });
    }, []);

    useEffect(() => {
        return () => {
            window.removeEventListener("mousemove", handleMouseMove);
            window.removeEventListener("pointermove", handleMouseMove);
        };
    }, [handleMouseMove]);

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

        const activatorEvt = event.activatorEvent as PointerEvent | MouseEvent;
        if (activatorEvt) {
            const target = activatorEvt.target as HTMLElement;
            const draggableEl = target.closest<HTMLElement>("[role='button']") ?? target;
            const rect = draggableEl.getBoundingClientRect();
            grabOffsetRef.current = {
                x: activatorEvt.clientX - rect.left,
                y: activatorEvt.clientY - rect.top
            };
            setOverlayPos({
                x: rect.left,
                y: rect.top
            });
        }
        window.addEventListener("mousemove", handleMouseMove);
        window.addEventListener("pointermove", handleMouseMove);

        if (active.data.current?.type === "COLUMN") {
            const columnId = active.id as string;
            const column = columnsProp.find(col => String(col) === columnId);
            if (column) {
                setActiveColumn(column);
            }
        } else if (active.data.current?.type === "ITEM") {
            const columnId = findColumnByItemId(active.id as string);
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
        const activeColumn = findColumnByItemId(activeId);
        let overColumnForMove = findColumnByItemId(overId);

        if (!overColumnForMove && overDataType === "ITEM-LIST") {
            overColumnForMove = overId;
        }
        if (!overColumnForMove && columnsProp.includes(overId as COLUMN)) {
            overColumnForMove = overId;
        }

        if (!activeColumn || !overColumnForMove) return;
        if (activeColumn === overColumnForMove) return;

        if (itemMapState[overColumnForMove]?.some(i => i.id === activeId)) {
            return;
        }

        setItemMapState(currentMap => {
            const activeItems = [...(currentMap[activeColumn] || [])];
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
            newItemMap[activeColumn] = activeItems;
            newItemMap[overColumnForMove!] = overItems;
            return newItemMap;
        });
    };

    const handleDragEnd = (event: DragEndEvent) => {
        const {
            active,
            over
        } = event;

        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("pointermove", handleMouseMove);
        setOverlayPos(null);

        setIsDragging(false);
        setActiveItem(null);
        setActiveColumn(null);
        setDragOverColumnId(null);

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

        const activeCol = findColumnByItemId(activeId) as COLUMN | undefined;
        let overCol = findColumnByItemId(overId) as COLUMN | undefined;

        if (!overCol) {
            const overDataType = over.data.current?.type;
            if (overDataType === "ITEM-LIST" || columnsProp.includes(overId as COLUMN)) {
                overCol = overId as COLUMN;
            }
        }

        if (!activeCol || !overCol) return;

        const isSameColumn = activeCol === overCol;
        const activeItems = itemMapState[activeCol] || [];
        const overItems = itemMapState[overCol] || [];

        const activeIndex = activeItems.findIndex(i => i.id === activeId);

        let overIndex;
        if (over.id === overCol) {
            overIndex = overItems.length;
        } else {
            overIndex = overItems.findIndex(i => i.id === overId);
        }

        if (activeIndex === -1 || overIndex === -1) return;

        let finalItems: BoardItem<T>[] = [];

        if (isSameColumn) {
            finalItems = arrayMove(activeItems, activeIndex, overIndex);
        } else {
            const newActiveItems = [...activeItems];
            const newOverItems = [...overItems];
            const [moved] = newActiveItems.splice(activeIndex, 1);
            newOverItems.splice(overIndex, 0, moved);
            finalItems = [...newActiveItems, ...newOverItems];
        }

        const fullFlattenedList: BoardItem<T>[] = [];
        columnsProp.forEach(col => {
            if (col === activeCol) {
                if (isSameColumn) {
                    fullFlattenedList.push(...finalItems);
                } else {
                    fullFlattenedList.push(...activeItems.filter(i => i.id !== activeId));
                }
            } else if (col === overCol) {
                const newOverItems = [...overItems];
                const [moved] = [...activeItems].splice(activeIndex, 1);
                newOverItems.splice(overIndex, 0, moved);
                fullFlattenedList.push(...newOverItems);
            } else {
                fullFlattenedList.push(...(itemMapState[col] || []));
            }
        });

        onItemsReorder?.(fullFlattenedList, {
            itemId: activeId,
            sourceColumn: activeCol,
            targetColumn: overCol
        });
    };

    return (
        <DndContext
            sensors={sensors}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
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

            {typeof document !== "undefined" && createPortal(
                <DragOverlay dropAnimation={null}>
                    {isDragging && activeItem && (
                        <div style={{
                            position: "fixed",
                            left: overlayPos?.x ?? 0,
                            top: overlayPos?.y ?? 0,
                            pointerEvents: "none",
                            zIndex: 9999
                        }}>
                            <ItemComponent
                                item={activeItem}
                                isDragging={true}
                                isClone={true}
                            />
                        </div>
                    )}
                </DragOverlay>,
                document.body
            )}
        </DndContext>
    );
}
