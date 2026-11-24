import React, { createRef, RefObject, useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";

import {
    OnVirtualTableColumnResizeParams,
    VirtualTableColumn,
    VirtualTableFilterValues,
    VirtualTableWhereFilterOp
} from "./VirtualTableProps";
import { ErrorBoundary } from "../ErrorBoundary";
import { FilterFormFieldProps, VirtualTableHeader } from "./VirtualTableHeader";
import { defaultBorderMixin } from "../../styles";
import { cls } from "../../util/cls";
import { useSortable } from "@dnd-kit/sortable";
import { columnClipVar, columnShiftVar, columnTransitionVar, columnWidth, columnWidthVar } from "./columnVars";

const MIN_COLUMN_WIDTH = 100;
const MAX_COLUMN_WIDTH = 800;

type SortIndex = Map<string, { direction: "asc" | "desc"; position: number }>;

// Sortable column header wrapper
const SortableColumnHeader = ({
    column,
    columnIndex,
    columnRefs,
    isResizing,
    onFilterUpdate,
    filter,
    sortIndex,
    sortCount,
    onColumnSort,
    onClickResizeColumn,
    createFilterField,
    isDragging,
    isDraggable,
    rootRef
}: {
    column: VirtualTableColumn;
    columnIndex: number;
    columnRefs: React.Ref<HTMLDivElement>[];
    isResizing: number;
    onFilterUpdate: (column: VirtualTableColumn, filterForProperty?: [VirtualTableWhereFilterOp, unknown]) => void;
    filter: [VirtualTableWhereFilterOp, unknown] | undefined;
    sortIndex: SortIndex;
    sortCount: number;
    onColumnSort: (key: string, additive?: boolean) => void;
    onClickResizeColumn: (index: number) => void;
    createFilterField: ((props: FilterFormFieldProps<unknown>) => React.ReactNode) | undefined;
    isDragging: boolean;
    isDraggable: boolean;
    rootRef: RefObject<HTMLDivElement | null>;
}) => {
    const [isPressing, setIsPressing] = useState(false);

    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition
    } = useSortable({
        id: column.key,
        disabled: !isDraggable || column.frozen
    });

    // Don't transition the dragged item - only other items should animate
    const ownTransition = isDragging ? undefined : transition;
    const shiftX = transform?.x;

    // The body follows this header through the table's custom properties
    // rather than through a `useSortable` of its own in every cell. One per
    // cell on screen was ~300 drag registrations, each row scrolled in or out
    // added or removed a column's worth, and every one of those re-rendered
    // every header and every cell — and since dnd-kit keeps one droppable per
    // id, a cell replaced its header's, and took it away when it scrolled out.
    useLayoutEffect(() => {
        const root = rootRef.current;
        if (!root) return undefined;
        const shiftVar = columnShiftVar(columnIndex);
        const transitionVar = columnTransitionVar(columnIndex);
        if (shiftX) root.style.setProperty(shiftVar, `${shiftX}px`);
        if (ownTransition) root.style.setProperty(transitionVar, ownTransition);
        return () => {
            root.style.removeProperty(shiftVar);
            root.style.removeProperty(transitionVar);
        };
    }, [rootRef, columnIndex, shiftX, ownTransition]);

    const width = columnWidth(columnIndex, column.width);
    const style = {
        // Only use translate, ignore any scale transforms
        transform: shiftX !== undefined ? `translateX(${shiftX}px)` : undefined,
        transition: ownTransition,
        minWidth: width,
        maxWidth: width,
        width
    };

    // Combine our press handlers with dnd-kit listeners
    const combinedListeners = isDraggable ? {
        ...listeners,
        onPointerDown: (e: React.PointerEvent) => {
            setIsPressing(true);
            listeners?.onPointerDown?.(e);
        },
        onPointerUp: () => setIsPressing(false),
        onPointerCancel: () => setIsPressing(false)
    } : {};

    // Reset pressing state when drag ends
    React.useEffect(() => {
        if (!isDragging) {
            setIsPressing(false);
        }
    }, [isDragging]);

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={cls(
                "flex-shrink-0 h-full",
                column.frozen && "sticky left-0 z-10"
            )}
            {...attributes}
            {...combinedListeners}
        >
            <VirtualTableHeader
                resizeHandleRef={columnRefs[columnIndex]}
                columnIndex={columnIndex}
                isResizingIndex={isResizing}
                onFilterUpdate={onFilterUpdate}
                filter={filter}
                sort={sortIndex.get(column.key)?.direction}
                sortPosition={sortCount > 1 ? sortIndex.get(column.key)?.position : undefined}
                onColumnSort={onColumnSort}
                onClickResizeColumn={onClickResizeColumn}
                column={column}
                createFilterField={createFilterField}
                AdditionalHeaderWidget={column.AdditionalHeaderWidget}
                isDragging={isDragging || isPressing}
                isDraggable={isDraggable}/>
        </div>
    );
};

export type VirtualTableHeaderRowProps = {
    columns: VirtualTableColumn[];
    sortIndex: SortIndex;
    onColumnSort: (key: string, additive?: boolean) => void;
    onFilterUpdate: (column: VirtualTableColumn, filterForProperty?: [VirtualTableWhereFilterOp, unknown]) => void;
    filter?: VirtualTableFilterValues<string>;
    /** Called once, when a column's edge is let go. */
    onColumnResizeEnd: (params: OnVirtualTableColumnResizeParams) => void;
    createFilterField?: (props: FilterFormFieldProps<unknown>) => React.ReactNode;
    AddColumnComponent?: React.ComponentType;
    columnsReorderable: boolean;
    draggingColumnId?: string | null;
    headerHeight: number;
    /** The element the column custom properties are written on; the body reads them. */
    rootRef: RefObject<HTMLDivElement | null>;
};

/**
 * The header, drawn again only when one of its own props changes.
 *
 * It sits inside react-window's inner element, which the list redraws on
 * every scroll frame; unmemoised, the header and each column's drag hook,
 * error boundary and title ran again on every one of them. It is handed only
 * what it draws from — not the rows, not the cell renderer — so a realtime
 * frame that changes the rows leaves it alone too.
 */
export const VirtualTableHeaderRow = React.memo(function VirtualTableHeaderRow({
    columns,
    sortIndex,
    onColumnSort,
    onFilterUpdate,
    filter,
    onColumnResizeEnd,
    createFilterField,
    AddColumnComponent,
    columnsReorderable,
    draggingColumnId,
    headerHeight,
    rootRef
}: VirtualTableHeaderRowProps) {

    const columnRefs = useMemo(() => columns.map(() => createRef<HTMLDivElement>()), [columns.length]);
    const [isResizing, setIsResizing] = useState(-1);

    // A live resize writes the column's width as a custom property, which
    // every cell of the column reads; nothing is drawn until the edge is let
    // go. Each move used to replace `columns`, which re-rendered every cell on
    // screen per mouse move. The property is cleared in the commit that draws
    // the new width, so the column never shows its old one in between.
    const clearLiveWidth = useCallback(() => {
        const root = rootRef.current;
        if (!root) return;
        columns.forEach((_, index) => {
            root.style.removeProperty(columnWidthVar(index));
            root.style.removeProperty(columnClipVar(index));
        });
    }, [columns, rootRef]);

    useLayoutEffect(() => clearLiveWidth, [clearLiveWidth]);

    const clampWidth = (width: number) => Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, width));

    const getEventNewWidth = useCallback((e: MouseEvent) => {
        if (isResizing >= 0) {
            const left = columnRefs[isResizing].current?.parentElement?.getBoundingClientRect().left;
            if (!left) return;
            return e.clientX - left;
        }
        return undefined;
    }, [columnRefs, isResizing]);

    const setCursorDocument = useCallback((isResizing: boolean) => {
        document.body.style.cursor = isResizing ? "col-resize" : "auto";
    }, []);

    const handleOnMouseMove = useCallback((e: MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        const newWidth = getEventNewWidth(e);
        const root = rootRef.current;
        if (newWidth && root) {
            root.style.setProperty(columnWidthVar(isResizing), `${clampWidth(newWidth)}px`);
            root.style.setProperty(columnClipVar(isResizing), "hidden");
        }
    }, [getEventNewWidth, isResizing, rootRef]);

    const handleOnMouseUp = useCallback((e: MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        const newWidth = getEventNewWidth(e);
        const column = columns[isResizing];
        if (newWidth && column) {
            const width = clampWidth(newWidth);
            onColumnResizeEnd({
                width,
                key: column.key,
                column: {
                    ...column,
                    width
                }
            });
        } else {
            clearLiveWidth();
        }
        setIsResizing(-1);
        setCursorDocument(false);
    }, [clearLiveWidth, columns, getEventNewWidth, isResizing, onColumnResizeEnd, setCursorDocument]);

    useEffect(() => {
        if (isResizing < 0) return undefined;
        document.addEventListener("mousemove", handleOnMouseMove);
        document.addEventListener("mouseup", handleOnMouseUp);
        return () => {
            document.removeEventListener("mousemove", handleOnMouseMove);
            document.removeEventListener("mouseup", handleOnMouseUp);
        };
    }, [handleOnMouseMove, handleOnMouseUp, isResizing]);

    const onClickResizeColumn = useCallback((index: number) => {
        setIsResizing(index);
        setCursorDocument(true);
    }, [setCursorDocument]);

    return (
        <div
            className={cls(defaultBorderMixin, "z-20 sticky min-w-full flex w-fit flex-row top-0 left-0 border-b bg-surface-sheet")}
            style={{ height: headerHeight }}>
            {columns.map((column, columnIndex) => {
                const columnFilter = filter && filter[column.key] ? filter[column.key] : undefined;
                const filterForThisProperty: [VirtualTableWhereFilterOp, unknown] | undefined =
                    columnFilter
                        ? (Array.isArray(columnFilter[0]) ? (columnFilter as [VirtualTableWhereFilterOp, unknown][])[0] : (columnFilter as [VirtualTableWhereFilterOp, unknown]))
                        : undefined;

                const isDraggable = !column.frozen && columnsReorderable;
                const isDragging = draggingColumnId === column.key;

                return (
                    <ErrorBoundary key={"header_" + column.key}>
                        <SortableColumnHeader
                            column={column}
                            columnIndex={columnIndex}
                            columnRefs={columnRefs}
                            isResizing={isResizing}
                            onFilterUpdate={onFilterUpdate}
                            filter={filterForThisProperty}
                            sortIndex={sortIndex}
                            sortCount={sortIndex.size}
                            onColumnSort={onColumnSort}
                            onClickResizeColumn={onClickResizeColumn}
                            createFilterField={createFilterField}
                            isDragging={isDragging}
                            isDraggable={isDraggable}
                            rootRef={rootRef}
                        />
                    </ErrorBoundary>
                );
            })}

            {AddColumnComponent && <AddColumnComponent/>}

        </div>
    );
});
