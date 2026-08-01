import React, { memo, useEffect, useMemo, useRef } from "react";
import { useDroppable } from "@dnd-kit/core";
import { useSortable, SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CircularProgress } from "../../components";
import { cls } from "../../util";
import { BoardItem, BoardItemViewProps } from "./board_types";

interface BoardSortableListProps<T> {
    columnId: string;
    items: BoardItem<T>[];
    ItemComponent: React.ComponentType<BoardItemViewProps<T>>;
    isDragging: boolean;
    isDragOverColumn: boolean;
    loading?: boolean;
    hasMore?: boolean;
    error?: Error;
    onLoadMore?: () => void;
}

export function BoardSortableList<T>({
    columnId,
    items,
    ItemComponent,
    isDragging,
    isDragOverColumn,
    loading = false,
    hasMore = false,
    error,
    onLoadMore
}: BoardSortableListProps<T>) {
    const {
        setNodeRef
    } = useDroppable({
        id: columnId,
        data: { type: "ITEM-LIST" }
    });

    const sentinelRef = useRef<HTMLDivElement>(null);
    const isLoadingRef = useRef(loading);
    isLoadingRef.current = loading;
    const lastLoadTimeRef = useRef(0);

    useEffect(() => {
        if (!sentinelRef.current || !hasMore || !onLoadMore) return;

        const sentinel = sentinelRef.current;

        const observer = new IntersectionObserver(
            (entries) => {
                const now = Date.now();
                if (
                    entries[0].isIntersecting &&
                    hasMore &&
                    !isLoadingRef.current &&
                    now - lastLoadTimeRef.current > 500
                ) {
                    lastLoadTimeRef.current = now;
                    onLoadMore();
                }
            },
            { threshold: 0.1 }
        );

        observer.observe(sentinel);

        const rect = sentinel.getBoundingClientRect();
        const containerRect = sentinel.parentElement?.getBoundingClientRect();
        if (containerRect && rect.top < containerRect.bottom && rect.bottom > containerRect.top) {
            const now = Date.now();
            if (hasMore && !isLoadingRef.current && now - lastLoadTimeRef.current > 500) {
                lastLoadTimeRef.current = now;
                onLoadMore();
            }
        }

        return () => observer.disconnect();
    }, [hasMore, onLoadMore]);

    const containerClassName = useMemo(() => cls(
        // The scrollbar stays: this is the only thing on the page that scrolls
        // vertically, and hiding it left a column of cards with no sign that
        // there were more below the fold.
        "flex flex-col p-2 transition-opacity duration-100 transition-bg ease-linear w-full overflow-y-auto flex-1 min-h-0 rounded-md",
        isDragging && isDragOverColumn
            ? "bg-surface-accent-200 dark:bg-surface-900"
            : isDragging
                ? "bg-surface-50 dark:bg-surface-900 hover:bg-surface-accent-100 dark:hover:bg-surface-800"
                : "bg-surface-50 dark:bg-surface-900"
    ), [isDragging, isDragOverColumn]);

    return (
        <div
            ref={setNodeRef}
            className={containerClassName}
            style={{ minHeight: 80 }}
        >
            <SortableContext
                items={items.map(i => i.id)}
                strategy={verticalListSortingStrategy}
            >
                {items.length === 0 && !loading ? (
                    <div className="flex-1 flex items-center justify-center px-3 text-center">
                        {/* "No items" over a header counting eleven of them is
                            the wrong thing to say when the read failed. */}
                        <span className={cls(
                            "text-xs",
                            error
                                ? "text-red-600 dark:text-red-400"
                                : "text-surface-400 dark:text-surface-500"
                        )}>
                            {error ? "Could not load this column" : "No items"}
                        </span>
                    </div>
                ) : (
                    <>
                        {items.map((item, index) => (
                            <SortableItem
                                key={item.id}
                                item={item}
                                index={index}
                                columnId={columnId}
                                ItemComponent={ItemComponent}
                            />
                        ))}
                        {(loading || hasMore) && (
                            <div ref={sentinelRef} className="flex items-center justify-center py-2 min-h-6">
                                {loading && <CircularProgress size="smallest"/>}
                            </div>
                        )}
                    </>
                )}
            </SortableContext>
        </div>
    );
}

interface SortableItemProps<T> {
    item: BoardItem<T>;
    index: number;
    columnId: string;
    ItemComponent: React.ComponentType<BoardItemViewProps<T>>;
}

const SortableItem = memo(function SortableItem<T>({
    item,
    index,
    columnId,
    ItemComponent
}: SortableItemProps<T>) {
    const {
        setNodeRef,
        attributes,
        listeners,
        isDragging: isItemBeingDragged,
        transform,
        transition
    } = useSortable({
        id: item.id,
        data: {
            type: "ITEM",
            columnId
        }
    });

    const sortableStyle = useMemo(() => ({
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isItemBeingDragged ? 2 : 1,
        opacity: isItemBeingDragged ? 0 : 1
    }), [transform, transition, isItemBeingDragged]);

    return (
        <div ref={setNodeRef} style={sortableStyle} {...attributes} {...listeners}>
            <ItemComponent
                item={item}
                isDragging={isItemBeingDragged}
                index={index}
            />
        </div>
    );
}) as <T>(props: SortableItemProps<T>) => React.ReactElement;
