import { ArrowUpIcon, FilterIcon } from "lucide-react";
import { iconSize } from "../../icons/Icon";

import React, { RefObject, useCallback, useEffect, useState } from "react";
import { deepEqual as equal } from "fast-equals";

import { VirtualTableColumn, VirtualTableSort, VirtualTableWhereFilterOp } from "./VirtualTableProps";
import { ErrorBoundary } from "../ErrorBoundary";
import { Badge } from "../Badge";
import { Button } from "../Button";
import { IconButton } from "../IconButton";
import { Popover } from "../Popover";
import { defaultBorderMixin } from "../../styles";
import { cls } from "../../util/cls";
interface FilterFormProps<T> {
    column: VirtualTableColumn<T>;
    onFilterUpdate: (filter?: [VirtualTableWhereFilterOp, unknown], newOpenFilterState?: boolean) => void;
    filter?: [VirtualTableWhereFilterOp, unknown];
    onHover: boolean,
    createFilterField: (props: FilterFormFieldProps<T>) => React.ReactNode;
    hidden: boolean;
    setHidden: (hidden: boolean) => void;
}

export type FilterFormFieldProps<CustomProps> = {
    id: React.Key,
    filterValue: [VirtualTableWhereFilterOp, unknown] | undefined,
    setFilterValue: (filterValue?: [VirtualTableWhereFilterOp, unknown]) => void;
    column: VirtualTableColumn<CustomProps>;
    hidden: boolean;
    setHidden: (hidden: boolean) => void;
};

type VirtualTableHeaderProps<M extends Record<string, unknown>> = {
    resizeHandleRef: React.Ref<HTMLDivElement>;
    columnIndex: number;
    isResizingIndex: number;
    column: VirtualTableColumn<unknown>;
    onColumnSort: (key: Extract<keyof M, string>, additive?: boolean) => void;
    filter?: [VirtualTableWhereFilterOp, unknown];
    sort: VirtualTableSort;
    /**
     * This column's zero-based rank in a multi-key sort, or `undefined` when
     * only one column is sorted and a rank would say nothing.
     */
    sortPosition?: number;
    onFilterUpdate: (column: VirtualTableColumn, filterForProperty?: [VirtualTableWhereFilterOp, unknown]) => void;
    onClickResizeColumn?: (columnIndex: number, column: VirtualTableColumn) => void;
    createFilterField?: (props: FilterFormFieldProps<unknown>) => React.ReactNode;
    AdditionalHeaderWidget?: (props: { onHover: boolean }) => React.ReactNode;
    isDragging?: boolean;
    isDraggable?: boolean;
};

/**
 * What the next click on this column's sort control will do, spelled out for
 * the tooltip and for screen readers. An unlabelled arrow that means three
 * different things depending on the state it is in is a control you have to
 * click to learn.
 */
function sortActionTitle(sort: VirtualTableSort, sortPosition?: number): string {
    const rank = sortPosition !== undefined ? ` (sort key ${sortPosition + 1})` : "";
    const addKey = " — shift-click to add it under the current sort instead";
    if (sort === "asc") return `Sorted ascending${rank}. Click to sort descending.${addKey}`;
    if (sort === "desc") return `Sorted descending${rank}. Click to remove this sort.${addKey}`;
    return `Click to sort ascending.${addKey}`;
}

export const VirtualTableHeader = React.memo<VirtualTableHeaderProps<Record<string, unknown>>>(
    function VirtualTableHeader<M extends Record<string, unknown>>({
        resizeHandleRef,
        columnIndex,
        isResizingIndex,
        sort,
        sortPosition,
        onColumnSort,
        onFilterUpdate,
        filter,
        column,
        onClickResizeColumn,
        createFilterField,
        AdditionalHeaderWidget,
        isDragging,
        isDraggable
    }: VirtualTableHeaderProps<M>) {

        const [onHover, setOnHover] = useState(false);

        const [openFilter, setOpenFilter] = React.useState(false);
        const [hidden, setHidden] = React.useState(false);

        const handleSettingsClick = useCallback((_event: React.MouseEvent) => {
            setOpenFilter(true);
        }, []);

        const update = useCallback((filterForProperty?: [VirtualTableWhereFilterOp, unknown], newOpenFilterState?: boolean) => {
            onFilterUpdate(column, filterForProperty);
            if (newOpenFilterState !== undefined)
                setOpenFilter(newOpenFilterState);
        }, [column, onFilterUpdate]);

        const thisColumnIsResizing = isResizingIndex === columnIndex;
        const anotherColumnIsResizing = isResizingIndex !== columnIndex && isResizingIndex > 0;

        const hovered = !anotherColumnIsResizing && (onHover || thisColumnIsResizing);

        return (
            <ErrorBoundary>
                <div
                    className={cls("flex py-0 px-3 h-full text-xs uppercase font-semibold relative select-none items-center",
                        isDragging
                            ? "bg-primary-bg dark:bg-primary-bg-dark"
                            : "bg-surface-50 dark:bg-surface-900",
                        "text-text-secondary hover:text-text-primary dark:text-text-secondary-dark dark:hover:text-text-primary-dark",
                        !isDragging && "hover:bg-surface-100 dark:hover:bg-surface-900 hover:bg-opacity-50 hover:bg-surface-100/50 dark:hover:bg-opacity-50 dark:hover:bg-surface-900/50",
                        column.frozen ? "sticky left-0 z-10" : "relative z-0",
                        isDraggable && "cursor-grab"
                    )}
                    style={{
                        left: column.frozen ? 0 : undefined,
                        minWidth: column.width,
                        maxWidth: column.width
                    }}
                    onMouseEnter={() => setOnHover(true)}
                    onMouseMove={() => setOnHover(true)}
                    onMouseLeave={() => setOnHover(false)}
                >

                    <div className="overflow-hidden grow">
                        <div
                            className={`flex items-center justify-${column.headerAlign} flex-row`}>

                            {column.icon && (
                                <div className="flex-shrink-0 flex items-center justify-center mr-1">
                                    {React.isValidElement(column.icon) ? (
                                        React.cloneElement(column.icon as React.ReactElement<any>, {
                                            size: 14,
                                            className: cls((column.icon as React.ReactElement<any>).props?.className, "flex-shrink-0")
                                        })
                                    ) : (
                                        column.icon
                                    )}
                                </div>
                            )}

                            <div
                                className="truncate -webkit-box w-full mr-1 overflow-hidden"
                                style={{
                                    WebkitBoxOrient: "vertical",
                                    WebkitLineClamp: 2,
                                    justifyContent: column.align
                                }}>
                                {column.title}
                            </div>

                        </div>
                    </div>
                    <>

                        {AdditionalHeaderWidget &&
                            <AdditionalHeaderWidget onHover={onHover || openFilter}/>}

                        {column.sortable && (sort || hovered || openFilter) &&
                            <div className="flex-shrink-0 flex items-center">
                                <Badge color="secondary"
                                    invisible={!sort}>
                                    <IconButton
                                        size={"small"}
                                        className={onHover || openFilter ? "bg-white dark:bg-surface-900" : undefined}
                                        // Shift keeps the sort already in place
                                        // and adds this column beneath it, which
                                        // is how a two-key order is built from
                                        // header clicks. Plain click still
                                        // replaces the whole sort, so the common
                                        // case takes no modifier and nothing a
                                        // user knew before stops working.
                                        title={sortActionTitle(sort, sortPosition)}
                                        aria-label={sortActionTitle(sort, sortPosition)}
                                        onClick={(event: React.MouseEvent) => {
                                            onColumnSort(column.key as Extract<keyof M, string>, event.shiftKey);
                                        }}
                                    >
                                        {!sort &&
                                            <ArrowUpIcon size={14} className="flex-shrink-0" />}
                                        {sort === "asc" &&
                                            <ArrowUpIcon size={14} className="flex-shrink-0" />}
                                        {sort === "desc" &&
                                            <ArrowUpIcon size={14} className="flex-shrink-0 rotate-180" />}
                                    </IconButton>
                                </Badge>
                                {/* The rank, shown only once there is more than
                                    one key: two arrows with no numbers beside
                                    them say a table is sorted by both columns
                                    and nothing about which one decides. */}
                                {sort && sortPosition !== undefined && (
                                    <span
                                        className="flex-shrink-0 -ml-0.5 mr-0.5 text-[10px] font-bold leading-none tabular-nums text-text-secondary dark:text-text-secondary-dark"
                                        aria-hidden={true}
                                    >
                                        {sortPosition + 1}
                                    </span>
                                )}
                            </div>
                        }
                    </>

                    {column.filter && createFilterField && <div className="flex-shrink-0">
                        <Badge color="secondary"
                            invisible={!filter}>

                            <Popover
                                open={openFilter}
                                onOpenChange={setOpenFilter}
                                className={hidden ? "hidden" : undefined}
                                modal={true}
                                trigger={
                                    <IconButton
                                        className={onHover || openFilter ? "bg-white dark:bg-surface-900" : undefined}
                                        size={"small"}
                                        onClick={handleSettingsClick}>
                                        <FilterIcon size={14} className="flex-shrink-0"/>
                                    </IconButton>}
                            >
                                <FilterForm column={column}
                                    filter={filter}
                                    onHover={onHover}
                                    onFilterUpdate={update}
                                    createFilterField={createFilterField}
                                    hidden={hidden}
                                    setHidden={setHidden}/>

                            </Popover>

                        </Badge>

                    </div>}

                    {column.resizable && <div
                        ref={resizeHandleRef as React.Ref<HTMLDivElement>}
                        data-no-dnd="true"
                        className={cls(
                            "absolute h-full w-[6px] top-0 right-0 cursor-col-resize",
                            hovered && "bg-surface-300 dark:bg-surface-700"
                        )}
                        onPointerDown={(e) => {
                            e.stopPropagation();
                            if (onClickResizeColumn) {
                                onClickResizeColumn(columnIndex, column);
                            }
                        }}
                    />}
                </div>

            </ErrorBoundary>
        );
    }, equal) as React.FunctionComponent<VirtualTableHeaderProps<Record<string, unknown>>>;

function FilterForm<M>({
    column,
    onFilterUpdate,
    filter,
    onHover,
    createFilterField,
    hidden,
    setHidden
}: FilterFormProps<M>) {

    const id = column.key;

    const [filterInternal, setFilterInternal] = useState<[VirtualTableWhereFilterOp, unknown] | undefined>(filter);

    useEffect(() => {
        setFilterInternal(filter);
    }, [filter]);

    if (!column.filter) return null;

    const submit = () => {
        onFilterUpdate(filterInternal, false);
    };

    const reset = (_e: React.MouseEvent) => {
        onFilterUpdate(undefined, false);
    };

    const filterIsSet = !!filter;

    const filterField = createFilterField({
        id,
        filterValue: filterInternal,
        setFilterValue: setFilterInternal,
        column,
        hidden,
        setHidden
    });

    if (!filterField) return null;
    return (
        <form noValidate={true}
            onSubmit={(e) => {
                e.stopPropagation();
                e.preventDefault();
                submit();
            }}
            className={"text-surface-900 dark:text-white"}>
            <div
                className={cls(defaultBorderMixin, "py-4 px-6 typography-label border-b")}>
                {column.title ?? id}
            </div>
            {filterField && <div className="m-4 w-[400px]">
                {filterField}
            </div>}
            <div className="flex justify-end m-4">
                <Button
                    className="mr-4"
                    disabled={!filterIsSet}
                    variant={"text"}
                    type="reset"
                    aria-label="filter clear"
                    onClick={reset}>Clear</Button>
                <Button
                    type="submit">Filter</Button>
            </div>
        </form>
    );

}
