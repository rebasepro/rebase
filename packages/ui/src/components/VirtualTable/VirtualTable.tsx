

import React, { createContext, forwardRef, RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { deepEqual as equal } from "fast-equals"

import { FixedSizeList as List } from "react-window";
import useMeasure from "react-use-measure";

import { CircularProgress } from "../CircularProgress";
import {
    OnVirtualTableColumnResizeParams,
    VirtualTableColumn,
    VirtualTableFilterValues,
    VirtualTableProps,
    VirtualTableSortKey,
    VirtualTableWhereFilterOp
} from "./VirtualTableProps";

import { VirtualTableContextProps } from "./types";
import { VirtualTableHeaderRow } from "./VirtualTableHeaderRow";
import { VirtualTableRow } from "./VirtualTableRow";
import { VirtualTableCell } from "./VirtualTableCell";
import { CenteredView } from "../CenteredView";
import { Typography } from "../Typography";
import { cls } from "../../util/cls";
import { useDebounceCallback } from "../../hooks/useDebounceCallback";
import {
    closestCenter,
    DndContext,
    DragEndEvent,
    DragStartEvent,
    PointerSensor,
    useSensor,
    useSensors
} from "@dnd-kit/core";
import { arrayMove, horizontalListSortingStrategy, SortableContext, useSortable } from "@dnd-kit/sortable";


const VirtualListContext = createContext<VirtualTableContextProps<Record<string, unknown>>>(null! as VirtualTableContextProps<Record<string, unknown>>);
VirtualListContext.displayName = "VirtualListContext";

type InnerElementProps = {
    children: React.ReactNode,
    style: React.CSSProperties
};

// eslint-disable-next-line react/display-name
const innerElementType = forwardRef<HTMLDivElement, InnerElementProps>(({
    children,
    ...rest
}: InnerElementProps, ref) => {

    return (
        <VirtualListContext.Consumer>
            {(virtualTableProps) => {
                const customView = virtualTableProps.customView;
                const headerHeight = virtualTableProps.headerHeight ?? 48;
                return (
                    <>
                        <div
                            id={"virtual-table"}
                            style={{
                                position: "relative",
                                height: "100%",
                                zIndex: 0
                            }}>
                            <div
                                ref={ref}
                                {...rest}
                                style={{
                                    ...rest?.style,
                                    height: (typeof rest?.style?.height === "number" ? rest.style.height : parseFloat((rest?.style?.height as string) || "0")) + headerHeight,
                                    minHeight: "100%",
                                    position: "relative"
                                }}>
                                <div style={{ position: "sticky",
top: 0,
zIndex: 20 }}>
                                    <VirtualTableHeaderRow {...virtualTableProps}/>
                                </div>
                                {!customView && children}
                            </div>

                        </div>

                        {customView && <div style={{
                            position: "sticky",
                            top: virtualTableProps.headerHeight ?? 48,
                            flexGrow: 1,
                            height: `calc(100% - ${virtualTableProps.headerHeight ?? 48}px)`,
                            marginTop: `calc(${(virtualTableProps.headerHeight ?? 48)}px - 100vh)`,
                            left: 0
                        }}>{customView}</div>}

                    </>
                );
            }}
        </VirtualListContext.Consumer>
    );
})
    ;

/**
 * This is a Table component that allows displaying arbitrary data, not
 * necessarily related to entities or properties. It is the component
 * that powers the entity collections but has a generic API, so it
 * can be reused.
 *
 * @group Components
 */
const VirtualTableInner = React.memo<VirtualTableProps<Record<string, unknown>>>(
    function VirtualTable<T extends Record<string, unknown>>({
        data,
        onResetPagination,
        onEndReached,
        endOffset = 600,
        rowHeight = 54,
        headerHeight = 48,
        columns: columnsProp,
        onRowClick,
        onColumnResize,
        onColumnResizeEnd,
        filter: filterInput,
        checkFilterCombination,
        onFilterUpdate,
        sortBy,
        error,
        emptyComponent,
        onSortByUpdate,
        onScroll: onScrollProp,
        loading,
        cellRenderer,
        hoverRow,
        createFilterField,
        rowClassName,
        style,
        className,
        endAdornment,
        AddColumnComponent,
        initialScroll = 0,
        onColumnsOrderChange,
        extraData
    }: VirtualTableProps<T>) {

        // Where each sorted column sits in the order, so a header can show both
        // which way it runs and how much it counts: `roles ↑1, created_at ↓2`
        // reads as "by role, newest first within each role". Without the rank a
        // multi-key sort shows two arrows and no way to tell which one wins.
        const sortIndex = useMemo(() => {
            const index = new Map<string, { direction: "asc" | "desc"; position: number }>();
            (sortBy ?? []).forEach(([key, direction], position) => {
                if (!index.has(key)) index.set(key, { direction,
position });
            });
            return index;
        }, [sortBy]);

        const [columns, setColumns] = useState(columnsProp);

        const tableRef = useRef<HTMLDivElement>(null);
        const endReachCallbackThreshold = useRef<number>(0);

        const debouncedScroll = useDebounceCallback(onScrollProp, 200);

        // Drag and drop state
        const [draggingColumnId, setDraggingColumnId] = useState<string | null>(null);

        const sensors = useSensors(
            useSensor(PointerSensor, {
                activationConstraint: {
                    distance: 5
                }
            })
        );

        const handleDragStart = useCallback((event: DragStartEvent) => {
            setDraggingColumnId(event.active.id as string);
        }, []);

        const handleDragEnd = useCallback((event: DragEndEvent) => {
            const {
                active,
                over
            } = event;
            setDraggingColumnId(null);

            if (over && active.id !== over.id && onColumnsOrderChange) {
                const oldIndex = columns.findIndex((col) => col.key === active.id);
                const newIndex = columns.findIndex((col) => col.key === over.id);

                if (oldIndex !== -1 && newIndex !== -1) {
                    const newColumns = arrayMove(columns, oldIndex, newIndex);
                    setColumns(newColumns);
                    onColumnsOrderChange(newColumns);
                }
            }
        }, [columns, onColumnsOrderChange]);

        const handleDragCancel = useCallback(() => {
            setDraggingColumnId(null);
        }, []);

        // Set initial scroll position
        useEffect(() => {
            if (tableRef.current && initialScroll) {
                const { scrollLeft } = tableRef.current;
                tableRef.current.scrollTo(scrollLeft, initialScroll);
            }
        }, [tableRef, initialScroll]);

        useEffect(() => {
            setColumns(columnsProp);
        }, [columnsProp]);

    // Removed redundant ResizeObserver to prevent performance issues and UI flickering.

        const [measureRef, bounds] = useMeasure({
            polyfill: ResizeObserver,
            scroll: true,
            // This is important for handling zooming in react-flow
            offsetSize: true
        });

        const onColumnResizeInternal = useCallback((params: OnVirtualTableColumnResizeParams) => {
            setColumns(prevColumns =>
                prevColumns.map((column) =>
                    column.key === params.column.key ? params.column : column
                )
            );
        }, []);

        const onColumnResizeEndInternal = useCallback((params: OnVirtualTableColumnResizeParams) => {
            setColumns(columns.map((column) => column.key === params.column.key ? params.column : column));
            if (onColumnResize) {
                onColumnResize(params);
            }
            if (onColumnResizeEnd) {
                onColumnResizeEnd(params);
            }
        }, [columns, onColumnResize, onColumnResizeEnd]);

        // saving the current filter as a ref as a workaround for header closure
        const filterRef = useRef<VirtualTableFilterValues<string> | undefined>(undefined);

        useEffect(() => {
            filterRef.current = filterInput;
        }, [filterInput]);

        const scrollToTop = useCallback(() => {
            endReachCallbackThreshold.current = 0;
            if (tableRef.current) {
                tableRef.current.scrollTo(tableRef.current?.scrollLeft, 0);
            }
        }, []);

        /**
         * Click a header to sort by that column: ascending, descending, then
         * off. Shift-click to keep the sort you already have and add this
         * column under it — the same idiom spreadsheets use, and the only way
         * to build "by role, newest first" out of two clicks.
         *
         * Shift cycles the column it lands on through the same three states, so
         * a key added by mistake is removed by shift-clicking it twice more,
         * without disturbing the keys around it.
         */
        const onColumnSort = useCallback((key: string, additive = false) => {

            const current = sortIndex.get(key);
            const next: "asc" | "desc" | undefined = current === undefined
                ? "asc"
                : current.direction === "asc" ? "desc" : undefined;

            const existing = sortBy ?? [];
            let newSortBy: VirtualTableSortKey[] | undefined;
            if (!additive) {
                newSortBy = next ? [[key, next]] : undefined;
            } else if (next === undefined) {
                newSortBy = existing.filter(([existingKey]) => existingKey !== key);
            } else if (current === undefined) {
                newSortBy = [...existing, [key, next]];
            } else {
                newSortBy = existing.map((entry) => entry[0] === key ? [key, next] as VirtualTableSortKey : entry);
            }
            if (newSortBy?.length === 0) newSortBy = undefined;

            const filter = filterRef.current;
            if (filter) {
                if (checkFilterCombination && !checkFilterCombination(filter, newSortBy)) {
                    if (onFilterUpdate)
                        onFilterUpdate(undefined);
                }
            }

            if (onResetPagination) {
                onResetPagination();
            }

            if (onSortByUpdate) {
                onSortByUpdate(newSortBy);
            }

            scrollToTop();
        }, [checkFilterCombination, onFilterUpdate, onResetPagination, onSortByUpdate, scrollToTop, sortBy, sortIndex]);

        const maxScroll = Math.max((data?.length ?? 0) * rowHeight - bounds.height, 0);

        const onEndReachedInternal = useCallback((scrollOffset: number) => {
            if (onEndReached && (data?.length ?? 0) > 0 && scrollOffset > endReachCallbackThreshold.current + endOffset) {
                endReachCallbackThreshold.current = scrollOffset;
                onEndReached();
            }
        }, [data?.length, onEndReached]);

        const onScroll = useCallback(({
            scrollDirection,
            scrollOffset,
            scrollUpdateWasRequested
        }: {
            scrollDirection: "forward" | "backward",
            scrollOffset: number,
            scrollUpdateWasRequested: boolean;
        }) => {
            if (onScrollProp) {
                debouncedScroll({
                    scrollDirection,
                    scrollOffset,
                    scrollUpdateWasRequested
                })
            }
            if (!scrollUpdateWasRequested && (scrollOffset >= maxScroll - endOffset))
                onEndReachedInternal(scrollOffset);
        }, [maxScroll, onEndReachedInternal]);

        const onFilterUpdateInternal = useCallback((column: VirtualTableColumn, filterForProperty?: [VirtualTableWhereFilterOp, unknown]) => {

            endReachCallbackThreshold.current = 0;
            const filter = filterRef.current;
            let newFilterValue: VirtualTableFilterValues<string> = filter ? { ...filter } : {};

            if (!filterForProperty) {
                delete newFilterValue[column.key];
            } else {
                newFilterValue[column.key] = filterForProperty;
            }
            const isNewFilterCombinationValid = !checkFilterCombination || checkFilterCombination(newFilterValue, sortBy);
            if (!isNewFilterCombinationValid) {
                newFilterValue = filterForProperty ? { [column.key]: filterForProperty } as VirtualTableFilterValues<Extract<keyof T, string>> : {};
            }

            if (onFilterUpdate) onFilterUpdate(newFilterValue);
        }, [checkFilterCombination, onFilterUpdate, sortBy]);

        const empty = !loading && (data?.length ?? 0) === 0;
        const customView = (error && (data?.length ?? 0) === 0)
            ? <CenteredView maxWidth={"2xl"}
                className="flex flex-col gap-2">

                <Typography variant={"h6"}>
                    {"Error"}
                </Typography>

                {error?.message && <SafeLinkRenderer text={error.message}/>}

            </CenteredView>
            : (empty
                ? (loading
                    ? <div className="flex items-center justify-center py-12 px-8">
                        <CircularProgress size="small"/>
                    </div>
                    : <div
                        className="flex flex-col overflow-auto items-center justify-center py-12 px-8">
                        {emptyComponent}
                    </div>)
                : undefined);

        const virtualListController = useMemo(() => ({
            data,
            rowHeight: rowHeight,
            headerHeight: headerHeight,
            cellRenderer,
            columns,
            onRowClick,
            customView,
            onColumnResize: onColumnResizeInternal,
            onColumnResizeEnd: onColumnResizeEndInternal,
            filter: filterRef.current,
            onColumnSort,
            onFilterUpdate: onFilterUpdateInternal,
            sortIndex,
            hoverRow: hoverRow ?? false,
            createFilterField,
            rowClassName,
            endAdornment,
            AddColumnComponent,
            onColumnsOrderChange: onColumnsOrderChange ? (newColumns: VirtualTableColumn[]) => {
                setColumns(newColumns);
                onColumnsOrderChange(newColumns);
            } : undefined,
            draggingColumnId,
            extraData
        }), [data, rowHeight, cellRenderer, columns, onRowClick, customView, onColumnResizeInternal, onColumnResizeEndInternal, filterInput, onColumnSort, onFilterUpdateInternal, sortIndex, hoverRow, createFilterField, rowClassName, endAdornment, AddColumnComponent, onColumnsOrderChange, draggingColumnId, extraData]);

        // Get sortable column keys (excluding frozen columns)
        const sortableColumnKeys = columns
            .filter(col => !col.frozen)
            .map(col => col.key);

        const tableContent = (
            <div
                ref={measureRef}
                style={style}
                className={cls(
                    "h-full w-full",
                    className,
                    draggingColumnId && "overflow-hidden"
                )}>
                {/* SAFETY: T extends Record<string, any> is structurally assignable to Record<string, unknown> */}
                <VirtualListContext.Provider
                    value={virtualListController as VirtualTableContextProps<Record<string, unknown>>}>

                    <MemoizedList
                        outerRef={tableRef}
                        key={rowHeight}
                        width={bounds.width}
                        height={bounds.height}
                        itemCount={(data?.length ?? 0) + (endAdornment ? 1 : 0)}
                        onScroll={draggingColumnId ? undefined : onScroll}
                        includeAddColumn={Boolean(AddColumnComponent)}
                        itemSize={rowHeight}/>

                </VirtualListContext.Provider>
            </div>
        );

        // Wrap with DndContext if column reorder is enabled
        if (onColumnsOrderChange) {
            return (
                <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                    onDragCancel={handleDragCancel}
                >
                    <SortableContext
                        items={sortableColumnKeys}
                        strategy={horizontalListSortingStrategy}
                    >
                        {tableContent}
                    </SortableContext>
                </DndContext>
            );
        }

        return tableContent;
    },
    equal
);

/**
 * `React.memo` is not generic-preserving: it takes the props type as its own
 * type argument, so annotating the call with
 * `VirtualTableProps<Record<string, unknown>>` pinned `T` at the boundary and
 * discarded the `<T>` the inner function declares. The exported component was
 * therefore not generic at all — every consumer got `Record<string, unknown>`,
 * `columns` and `cellRenderer` were unrelated to `data`, and a caller writing
 * `<VirtualTable<Post> …>` was told the component expects no type arguments.
 *
 * Re-asserting the call signature is the standard way to carry a type parameter
 * across `memo`; it is the only cast here, and it restores the generic the
 * implementation always had. Runtime behaviour is unchanged — this is the same
 * memoized component under a type that describes it.
 */
export const VirtualTable = VirtualTableInner as <T extends Record<string, unknown>>(
    props: VirtualTableProps<T>
) => React.ReactElement | null;
// Wrapper that applies sortable transforms to cells
const SortableCellWrapper = ({
    columnKey,
    width,
    isDragging,
    isDraggable,
    frozen,
    children
}: {
    columnKey: string;
    width: number;
    isDragging: boolean;
    isDraggable: boolean;
    frozen?: boolean;
    children: React.ReactNode;
}) => {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition
    } = useSortable({
        id: columnKey,
        disabled: !isDraggable || frozen
    });

    // Remove tabIndex from attributes to avoid capturing focus before cell content
    const { tabIndex: _tabIndex, ...attrsWithoutTabIndex } = attributes;

    const style = {
        // Only use translate, ignore any scale transforms
        transform: transform ? `translateX(${transform.x}px)` : undefined,
        // Don't transition the dragged item - only other items should animate
        transition: isDragging ? undefined : transition,
        minWidth: width,
        maxWidth: width,
        width: width
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={cls(
                "flex-shrink-0",
                frozen && "sticky left-0 z-10 bg-white dark:bg-surface-900"
            )}
            {...attrsWithoutTabIndex}
        >
            {children}
        </div>
    );
};

function MemoizedList({
    outerRef,
    width,
    height,
    itemCount,
    onScroll,
    itemSize,
    includeAddColumn
}: {
    outerRef: RefObject<HTMLDivElement | null>;
    width: number;
    height: number;
    itemCount: number;
    onScroll?: (params: {
        scrollDirection: "forward" | "backward",
        scrollOffset: number,
        scrollUpdateWasRequested: boolean;
    }) => void;
    itemSize: number;
    includeAddColumn?: boolean;
}) {

    const Row = useCallback(({
        index,
        style
    }: { index: number; style: React.CSSProperties }) => {
        return <VirtualListContext.Consumer>
            {({
                onRowClick,
                data,
                columns,
                rowHeight = 54,
                headerHeight = 48,
                cellRenderer,
                hoverRow,
                rowClassName,
                endAdornment,
                draggingColumnId,
                onColumnsOrderChange,
                extraData
            }) => {

                if (endAdornment && index === (data ?? []).length) {
                    return <div style={{
                        ...style,
                        height: "auto",
                        position: "sticky",
                        bottom: 0,
                        zIndex: 1
                    }}>
                        {endAdornment}
                    </div>;
                }

                const rowData = (data ? data[index] : undefined) as Record<string, unknown>;
                return (
                    <VirtualTableRow
                        key={`row_${index}`}
                        rowData={rowData}
                        rowIndex={index}
                        onRowClick={onRowClick}
                        columns={columns}
                        hoverRow={hoverRow}
                        rowClassName={rowClassName}
                        style={{
                            ...style,
                            top: `calc(${style.top}px + ${headerHeight ?? 48}px)`
                        }}
                        rowHeight={rowHeight}>

                        {columns.map((column: VirtualTableColumn, columnIndex: number) => {
                            const cellData = rowData && rowData[column.key];
                            const isDragging = draggingColumnId === column.key;
                            const isDraggable = !column.frozen && !!onColumnsOrderChange;

                            return onColumnsOrderChange ? (
                                <SortableCellWrapper
                                    key={`cell_wrapper_${column.key}`}
                                    columnKey={column.key}
                                    width={column.width}
                                    isDragging={isDragging}
                                    isDraggable={isDraggable}
                                    frozen={column.frozen}
                                >
                                    <VirtualTableCell
                                        dataKey={column.key}
                                        // @ts-expect-error -- React.memo<VirtualTableProps<any>> erases the generic T, so cellRenderer's parameter type widens to `any` losing structural compatibility with VirtualTableCell<T>. The types are structurally correct at runtime.
                                        cellRenderer={cellRenderer}
                                        column={column}
                                        columns={columns}
                                        rowData={rowData}
                                        cellData={cellData}
                                        rowIndex={index}
                                        columnIndex={columnIndex}
                                        extraData={extraData}/>
                                </SortableCellWrapper>
                            ) : (
                                <div
                                    key={`cell_wrapper_${column.key}`}
                                    className={cls(
                                        "flex-shrink-0 relative",
                                        column.frozen && "sticky left-0 z-10 bg-white dark:bg-surface-900"
                                    )}
                                    style={{
                                        minWidth: column.width,
                                        maxWidth: column.width,
                                        width: column.width
                                    }}
                                >
                                    <VirtualTableCell
                                        dataKey={column.key}
                                        // @ts-expect-error -- React.memo<VirtualTableProps<any>> erases the generic T, so cellRenderer's parameter type widens to `any` losing structural compatibility with VirtualTableCell<T>. The types are structurally correct at runtime.
                                        cellRenderer={cellRenderer}
                                        column={column}
                                        columns={columns}
                                        rowData={rowData}
                                        cellData={cellData}
                                        rowIndex={index}
                                        columnIndex={columnIndex}
                                        extraData={extraData}/>
                                </div>
                            );
                        })}

                        {includeAddColumn && <div className={"w-20"}/>}

                    </VirtualTableRow>
                );
            }}
        </VirtualListContext.Consumer>;
    }, []);

    return <List
        outerRef={outerRef}
        innerElementType={innerElementType}
        width={width}
        height={height}
        overscanCount={4}
        itemCount={itemCount}
        onScroll={onScroll}
        itemSize={itemSize}>
        {Row}
    </List>;
}

const SafeLinkRenderer: React.FC<{
    text: string;
}> = ({ text }) => {
    const urlRegex = /https?:\/\/[^\s]+/g;
    const urls = text.match(urlRegex) || [];
    const parts = text.split(urlRegex);

    return (
        <div className={"break-all"}>
            {parts.map((part, i) => (
                <React.Fragment key={i}>
                    {part}
                    {urls[i] && (
                        <>
                            <a href={urls[i]} className="underline" target="_blank" rel="noopener noreferrer">Link</a>
                            <br/>
                        </>
                    )}
                </React.Fragment>
            ))}
        </div>
    );
};
