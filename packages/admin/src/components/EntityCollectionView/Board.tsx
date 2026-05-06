import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
    DndContext,
    DragEndEvent,
    DragOverEvent,
    DragOverlay,
    DragStartEvent,
    PointerSensor,
    pointerWithin,
    rectIntersection,
    CollisionDetection,
    useSensor,
    useSensors
} from "@dnd-kit/core";
import { arrayMove, horizontalListSortingStrategy, SortableContext } from "@dnd-kit/sortable";
import { BoardColumn } from "./BoardColumn";
import { BoardItem, BoardItemMap, BoardItemViewProps, BoardProps } from "./board_types";
import { cls } from "@rebasepro/ui";

export function Board<M extends Record<string, unknown>, COLUMN extends string>({
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
}: BoardProps<M, COLUMN>) {

    const [activeItem, setActiveItem] = useState<BoardItem<M> | null>(null);
    const [activeColumn, setActiveColumn] = useState<COLUMN | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [dragOverColumnId, setDragOverColumnId] = useState<string | null>(null);

    // Custom overlay positioning — bypasses position:fixed containment issues
    const grabOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
    const [overlayPos, setOverlayPos] = useState<{ x: number; y: number } | null>(null);

    const handleMouseMove = useCallback((e: MouseEvent) => {
        setOverlayPos({
            x: e.clientX - grabOffsetRef.current.x,
            y: e.clientY - grabOffsetRef.current.y
        });
    }, []);
    // Clean up window listeners on unmount
    useEffect(() => {
        return () => {
            window.removeEventListener("mousemove", handleMouseMove);
            window.removeEventListener("pointermove", handleMouseMove);
        };
    }, [handleMouseMove]);

    const [itemMapState, setItemMapState] = useState<BoardItemMap<M>>(() => {
        const dataColumnMap: Record<string, COLUMN> = data.reduce((prev, item: BoardItem<M>) => ({
            ...prev,
            [item.id]: assignColumn(item)
        }), {});
        return columnsProp.reduce(
            (previous: BoardItemMap<M>, column: COLUMN) => ({
                ...previous,
                [column]: data.filter((item: BoardItem<M>) => dataColumnMap[item.id] === column)
            }),
            {}
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
            (previous: BoardItemMap<M>, column: COLUMN) => ({
                ...previous,
                [column]: data.filter((item: BoardItem<M>) => dataColumnMap[item.id] === column)
            }),
            {} as BoardItemMap<M>
        );

        // Sync Board's itemMapState with incoming data.
        // The incoming data is ordered by the fractional-index order key (from columnData).
        // We accept that order as the source of truth, but avoid triggering re-renders
        // when the data is structurally identical (same IDs in same order, same entity refs).
        setItemMapState(prevMap => {
            let changed = false;

            for (const col of columnsProp) {
                const prevItems = prevMap[col] ?? [];
                const newItems = newItemMap[col] ?? [];

                // Quick structural check: same length, same IDs in same order
                if (prevItems.length !== newItems.length) {
                    changed = true;
                    continue;
                }
                for (let i = 0; i < prevItems.length; i++) {
                    if (prevItems[i].id !== newItems[i].id || prevItems[i].entity !== newItems[i].entity) {
                        changed = true;
                        break;
                    }
                }
            }

            if (!changed) {
                // Nothing changed — return same reference, no re-render
                return prevMap;
            }

            // Something changed — accept the new data.
            // Preserve entity refs that haven't changed to minimize downstream re-renders.
            const updated: BoardItemMap<M> = {};
            for (const col of columnsProp) {
                const prevItems = prevMap[col] ?? [];
                const newItems = newItemMap[col] ?? [];

                // Build prev lookup for entity ref reuse
                const prevById = new Map<string, BoardItem<M>>();
                for (const item of prevItems) {
                    prevById.set(item.id, item);
                }

                updated[col] = newItems.map(newItem => {
                    const prev = prevById.get(newItem.id);
                    if (prev && prev.entity === newItem.entity) {
                        return prev; // Reuse existing object reference
                    }
                    return newItem;
                });
            }
            return updated;
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [data, columnsProp, assignColumn]);

    const findColumnByItemId = (id: string): string | undefined => {
        return Object.keys(itemMapState).find(col => itemMapState[col]?.some(i => i.id === id));
    };

    const handleDragStart = (event: DragStartEvent) => {
        setIsDragging(true);
        setDragOverColumnId(null);
        const { active } = event;

        // Compute grab offset: distance from pointer to element's top-left.
        // active.rect.current.initial may be null at this point (measured async),
        // so we find the DOM element directly from the activator event target.
        const activatorEvt = event.activatorEvent as PointerEvent | MouseEvent;
        if (activatorEvt) {
            const target = activatorEvt.target as HTMLElement;
            // Walk up to the sortable wrapper (the element with role="button"
            // set by useSortable's attributes, or the closest [data-sortable])
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

        // Skip item reordering if dragging a column
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

        // Prevent moving to a column if item with same ID already exists there
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

        // Clean up custom overlay tracking
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

        if (active.data.current?.type === "COLUMN" &&
            over.data.current?.type === "COLUMN" &&
            activeId !== overId) {

            const oldIndex = columnsProp.findIndex(col => String(col) === activeId);
            const newIndex = columnsProp.findIndex(col => String(col) === overId);

            if (oldIndex !== -1 && newIndex !== -1 && onColumnReorder && allowColumnReorder) {
                const newOrder = arrayMove([...columnsProp], oldIndex, newIndex);
                onColumnReorder(newOrder);
            }
        } else if (active.data.current?.type === "ITEM" && onItemsReorder) {
            // Find the original column assignment from the input data
            const originalColumn = data.find(item => item.id === activeId)
                ? assignColumn(data.find(item => item.id === activeId)!)
                : undefined;

            // Find the current column assignment from our internal state
            const currentColumn = findColumnByItemId(activeId) as COLUMN | undefined;
            const overColumn = findColumnByItemId(overId) || currentColumn;


            let finalItemMapState = { ...itemMapState };

            if (currentColumn && currentColumn === overColumn) {
                // Use dnd-kit's sortable indexes if available to avoid race conditions with mutating handleDragOver
                const activeIndex = finalItemMapState[currentColumn].findIndex(i => i.id === activeId);
                
                let overIndex = finalItemMapState[overColumn].findIndex(i => i.id === overId);
                const overType = over.data.current?.type;
                if (overIndex === -1 && (overType === "COLUMN" || overType === "ITEM-LIST")) {
                    if (originalColumn === currentColumn) {
                        overIndex = finalItemMapState[overColumn].length;
                    } else {
                        // For cross-column, handleDragOver already placed it at the correct index (top/bottom)
                        // when dragging over the column background.
                        overIndex = activeIndex;
                    }
                } else if (overIndex === -1 && typeof over.data.current?.sortable?.index === 'number') {
                    overIndex = over.data.current.sortable.index;
                }

                if (activeIndex !== -1 && overIndex !== -1 && activeIndex !== overIndex) {
                    finalItemMapState[currentColumn] = arrayMove(finalItemMapState[currentColumn], activeIndex, overIndex);
                    setItemMapState(finalItemMapState);
                }
            }

            // Notify parent component of the change, including column movement information
            // Pass ONLY the items in the target column, in their new visual order
            if (originalColumn !== currentColumn && originalColumn && currentColumn) {
                // Item has moved between columns
                onItemsReorder(finalItemMapState[currentColumn] as BoardItem<M>[], {
                    itemId: activeId,
                    sourceColumn: originalColumn,
                    targetColumn: currentColumn
                });
            } else if (currentColumn) {
                // Reordering within the same column
                onItemsReorder(finalItemMapState[currentColumn] as BoardItem<M>[], {
                    itemId: activeId,
                    sourceColumn: currentColumn,
                    targetColumn: currentColumn
                });
            }
        }
    };

    const customCollisionDetection: CollisionDetection = (args) => {
        const pointerCollisions = pointerWithin(args);
        
        if (pointerCollisions.length > 0) {
            return pointerCollisions;
        }
        
        return rectIntersection(args);
    };

    return (
        <DndContext
            sensors={sensors}
            collisionDetection={customCollisionDetection}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
        >
            {/* Hidden DragOverlay — keeps dnd-kit's internal collision detection
               and drag tracking working (it needs dragOverlay.rect to be set) */}
            <DragOverlay dropAnimation={null} style={{ opacity: 0 }}>
                {(activeItem || activeColumn) ? <div style={{ width: 1, height: 1 }}/> : null}
            </DragOverlay>

            {/* Visual overlay — rendered at document.body via portal to bypass
               any ancestor transforms/containment that break position:fixed */}
            {overlayPos && (activeItem || activeColumn) && createPortal(
                <div
                    className={document.documentElement.classList.contains("dark") ? "dark" : ""}
                    style={{
                        position: "fixed",
                        top: overlayPos.y,
                        left: overlayPos.x,
                        zIndex: 9999,
                        pointerEvents: "none",
                        touchAction: "none"
                    }}
                >
                    {activeItem ? (
                        <ItemComponent
                            item={activeItem}
                            isDragging={true}
                            index={-1}
                            style={{
                                boxShadow: "0 4px 16px rgba(0,0,0,0.15)",
                                opacity: 0.9,
                                width: "304px"
                            }}
                        />
                    ) : activeColumn ? (
                        <BoardColumn
                            key={String(activeColumn)}
                            index={-1}
                            id={String(activeColumn)}
                            title={columnLabels?.[activeColumn] ?? String(activeColumn)}
                            items={itemMapState[String(activeColumn)] || []}
                            ItemComponent={ItemComponent}
                            isDragging={true}
                            isDragOverColumn={false}
                        />
                    ) : null}
                </div>,
                document.body
            )}

            <SortableContext
                items={columnsProp.map(String)}
                strategy={horizontalListSortingStrategy}
            >
                <div className={cls("p-2 md:p-3 lg:p-4 h-full min-w-full inline-flex", className)}>
                    {columnsProp.map((key: COLUMN, index: number) => (
                        <BoardColumn
                            key={String(key)}
                            index={index}
                            id={String(key)}
                            title={columnLabels?.[key] ?? String(key)}
                            color={columnColors?.[key]}
                            items={itemMapState[String(key)] || []}
                            ItemComponent={ItemComponent}
                            isDragging={isDragging}
                            isDragOverColumn={String(key) === dragOverColumnId}
                            allowReorder={allowColumnReorder}
                            loading={columnLoadingState?.[String(key)]?.loading}
                            hasMore={columnLoadingState?.[String(key)]?.hasMore}
                            totalCount={columnLoadingState?.[String(key)]?.totalCount}
                            onLoadMore={onLoadMoreColumn ? () => onLoadMoreColumn(key) : undefined}
                            onAddItem={onAddItemToColumn ? () => onAddItemToColumn(key) : undefined}
                            style={{
                                opacity: activeColumn === key ? 0 : 1
                            }}
                        />
                    ))}
                    {AddColumnComponent}
                </div>
            </SortableContext>
        </DndContext>
    );
}
