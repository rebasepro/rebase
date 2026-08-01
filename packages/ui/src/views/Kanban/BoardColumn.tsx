import React, { memo, useMemo } from "react";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { BoardSortableList } from "./BoardSortableList";
import { BoardColumnTitle } from "./BoardColumnTitle";
import { BoardItem, BoardItemViewProps } from "./board_types";
import {
    IconButton
} from "../../components";
import { cls } from "../../util";
import { iconSize, PlusIcon } from "../../icons";

export interface BoardColumnProps<T> {
    id: string;
    title: string;
    items: BoardItem<T>[];
    index: number;
    ItemComponent: React.ComponentType<BoardItemViewProps<T>>;
    isDragging: boolean;
    isDragOverColumn: boolean;
    allowReorder?: boolean;
    loading?: boolean;
    hasMore?: boolean;
    error?: Error;
    onLoadMore?: () => void;
    onAddItem?: () => void;
    totalCount?: number;
    color?: any;
    style?: React.CSSProperties;
}

export const BoardColumn = memo(function BoardColumn<T>({
    id,
    title,
    items,
    ItemComponent,
    isDragging,
    isDragOverColumn,
    allowReorder = false,
    loading = false,
    hasMore = false,
    error,
    onLoadMore,
    onAddItem,
    totalCount,
    color,
    style
}: BoardColumnProps<T>) {
    const {
        setNodeRef,
        attributes,
        listeners,
        isDragging: isColumnBeingDragged,
        transform,
        transition
    } = useSortable({
        id,
        data: { type: "COLUMN" },
        disabled: !allowReorder
    });

    const combinedStyle = useMemo(() => ({
        ...style,
        transform: CSS.Translate.toString(transform),
        transition,
        zIndex: isColumnBeingDragged ? 2 : 1
    }), [style, transform, transition, isColumnBeingDragged]);

    const dragListeners = allowReorder ? listeners : {};

    const columnClassName = useMemo(() => cls(
        "border h-full w-80 min-w-80 mx-2 flex flex-col rounded-md border-surface-200 dark:border-surface-800",
        isColumnBeingDragged ? "ring-2 ring-primary" : ""
    ), [isColumnBeingDragged]);

    const headerClassName = useMemo(() => cls(
        "flex items-center justify-between px-2 rounded-t-md transition-colors duration-200 ease-in-out",
        isColumnBeingDragged
            ? "bg-surface-100 dark:bg-surface-700"
            : "bg-surface-50 hover:bg-surface-100 dark:bg-surface-800 dark:hover:bg-surface-700",
        allowReorder ? "cursor-grab" : ""
    ), [isColumnBeingDragged, allowReorder]);

    const itemIds = useMemo(() => items.map(i => i.id), [items]);

    return (
        <div
            ref={setNodeRef}
            style={combinedStyle}
            {...attributes}
            className={columnClassName}
        >
            <div
                {...dragListeners}
                className={headerClassName}
            >
                <div className="flex items-center gap-2">
                    <BoardColumnTitle aria-label={`${title} item list`} color={color}>
                        {title}
                    </BoardColumnTitle>
                    {totalCount !== undefined && (
                        <span className="text-xs text-surface-500 dark:text-surface-400">
                            {totalCount}
                        </span>
                    )}
                </div>
                {onAddItem && (
                    <IconButton
                        size="small"
                        onClick={(e: React.MouseEvent) => {
                            e.stopPropagation();
                            onAddItem();
                        }}
                        className="opacity-60 hover:opacity-100"
                    >
                        <PlusIcon size={iconSize.small}/>
                    </IconButton>
                )}
            </div>
            <SortableContext
                items={itemIds}
                strategy={verticalListSortingStrategy}
            >
                <BoardSortableList
                    columnId={id}
                    items={items}
                    ItemComponent={ItemComponent}
                    isDragging={isDragging}
                    isDragOverColumn={isDragOverColumn}
                    loading={loading}
                    hasMore={hasMore}
                    error={error}
                    onLoadMore={onLoadMore}
                />
            </SortableContext>
        </div>
    );
}) as <T>(props: BoardColumnProps<T>) => React.ReactElement;
