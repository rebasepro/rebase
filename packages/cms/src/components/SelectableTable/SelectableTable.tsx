import { createSelectionStore, AdminSelectedCell } from "./SelectionStore";
import type { Property, WhereFilterOp } from "@rebasepro/types";
import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { Entity, FilterValues } from "@rebasepro/types";
import { CollectionSize, EntityTableController, SelectedCellProps, AdminCollection } from "@rebasepro/cms-types";
import { CellRendererParams, VirtualTable, VirtualTableColumn, VirtualTableFilterValues, OnRowClickParams } from "@rebasepro/ui";
import { DEFAULT_PAGE_SIZE, DataCollectionTableController, OnCellValueChange, OnColumnResizeParams } from "@rebasepro/app";
import { FilterFormFieldProps } from "@rebasepro/ui";
import { useOutsideAlerter } from "@rebasepro/ui";
import { SelectableTableContext } from "./SelectableTableContext";
import { getRowHeight } from "@rebasepro/app";
import { FilterFieldBinding } from "./filters/FilterFieldBinding";

export type SelectableTableProps<M extends Record<string, unknown>> = {

    /**
     * Callback when a cell value changes.
     */
    onValueChange?: OnCellValueChange<unknown, M>;

    columns: VirtualTableColumn[];

    cellRenderer: (props: CellRendererParams<Entity<M>>) => React.ReactNode;

    /**
     * Builder for creating the buttons in each row
     * @param entity
     * @param size
     */
    tableRowActionsBuilder?: (params: {
        entity: Entity<M>,
        size: CollectionSize,
        width: number,
        frozen?: boolean
    }) => React.ReactNode;

    /**
     * Callback when anywhere on the table is clicked
     */
    onEntityClick?(entity: Entity<M>): void;

    /**
     * Callback when a column is resized
     */
    onColumnResize?(params: OnColumnResizeParams): void;

    /**
     * Should apply a different style to a row when hovering
     */
    hoverRow?: boolean;

    /**
     * Controller holding the logic for the table
     * {@link useDataTableController}
     * {@link EntityTableController}
     */
    tableController: EntityTableController<M>;

    filterable?: boolean;

    sortable?: boolean;

    inlineEditing?: boolean;

    fixedFilter?: FilterValues<keyof M extends string ? keyof M : never>;

    highlightedRow?: (data: Entity<M>) => boolean;

    size?: CollectionSize;

    initialScroll?: number;

    /**
     * Callback when the table is scrolled
     * @param props
     */
    onScroll?: (props: {
        scrollDirection: "forward" | "backward",
        scrollOffset: number,
        scrollUpdateWasRequested: boolean
    }) => void;

    emptyComponent?: React.ReactNode;

    endAdornment?: React.ReactNode;

    AddColumnComponent?: React.ComponentType;

    /**
     * Callback when columns are reordered via drag-and-drop
     */
    onColumnsOrderChange?: (columns: VirtualTableColumn[]) => void;

    /**
     * Extra data passed to VirtualTable cells. Changes to this object
     * bust the cell memo comparator, triggering re-render of cells
     * even when rowData hasn't changed.
     */
    extraData?: unknown;
}

/**
 * This component is in charge of rendering a collection table with a high
 * degree of customization.
 *
 * This component is used internally by {@link CollectionViewBinding} and
 * {@link useReferenceDialog}
 *
 * Please note that you only need to use this component if you are building
 * a custom view. If you just need to create a default view you can do it
 * exclusively with config options.
 *
 * If you want to bind a {@link AdminCollection} to a table with the default
 * options you see in collections in the top level navigation, you can
 * check {@link CollectionViewBinding}.
 *
 * The data displayed in the table is managed by a {@link EntityTableController}.
 * You can build the default, bound to a path in the driver, by using the hook
 * {@link useDataTableController}
 *
 * @see CollectionTableBindingProps
 * @see CollectionViewBinding
 * @see VirtualTable
 * @group Components
 */
export const SelectableTable = function SelectableTable<M extends Record<string, unknown>>
    ({
        onValueChange,
        cellRenderer,
        onEntityClick,
        onColumnResize,
        hoverRow = true,
        size = "m",
        inlineEditing = false,
        tableController:
        {
            data,
            dataLoading,
            noMoreToLoad,
            dataLoadingError,
            filterValues,
            setFilterValues,
            sortBy,
            setSortBy,
            itemCount,
            setItemCount,
            pageSize = DEFAULT_PAGE_SIZE,
            paginationEnabled,
            checkFilterCombination,
            setPopupCell
        },
        filterable = true,
        onScroll,
        initialScroll,
        emptyComponent,
        columns,
        fixedFilter,
        highlightedRow,
        endAdornment,
        AddColumnComponent,
        onColumnsOrderChange,
        extraData
    }: SelectableTableProps<M>) {

    const ref = useRef<HTMLDivElement>(null);

    // Create the selection store once
    const selectionStore = useMemo(() => createSelectionStore(), []);
    // We still keep local state for side-effects like outside-alerter, but we don't put it in context
    const [localSelectedCell, setLocalSelectedCell] = React.useState<SelectedCellProps<M> | undefined>(undefined);

    const loadNextPage = useCallback(() => {
        if (!paginationEnabled || dataLoading || noMoreToLoad)
            return;
        if (itemCount !== undefined)
            setItemCount?.(itemCount + pageSize);
    }, [paginationEnabled, dataLoading, noMoreToLoad, itemCount, pageSize, setItemCount]);

    const resetPagination = useCallback(() => {
        setItemCount?.(pageSize);
    }, [pageSize]);

    const onRowClick = useCallback(({ rowData }: OnRowClickParams<Record<string, unknown>>) => {
        if (inlineEditing)
            return;
        return onEntityClick && onEntityClick(rowData as unknown as Entity<M>);
    }, [onEntityClick, inlineEditing]);

    const select = useCallback((cell?: SelectedCellProps<M>) => {
        setLocalSelectedCell(cell);
        if (cell) {
            selectionStore.select({
                ...cell,
                columnKey: cell.propertyKey,
                id: cell.entityId
            } as AdminSelectedCell);
        } else {
            selectionStore.select(undefined);
        }
    }, [selectionStore]);

    const unselect = useCallback(() => {
        setLocalSelectedCell(undefined);
        selectionStore.select(undefined);
    }, [selectionStore]);

    useOutsideAlerter(ref,
        () => {
            if (localSelectedCell) {
                unselect();
            }
        },
        Boolean(localSelectedCell));

    // on ESC key press
    useEffect(() => {
        const escFunction = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                unselect();
            }
        };
        document.addEventListener("keydown", escFunction, false);
        return () => {
            document.removeEventListener("keydown", escFunction, false);
        };
    }, [unselect]);

    const onFilterUpdate = useCallback((updatedFilterValues?: VirtualTableFilterValues<string>) => {
        if (setFilterValues) {
            setFilterValues({
                ...updatedFilterValues,
                ...fixedFilter
            } as FilterValues<Extract<keyof M, string> | (string & {})>);
        }
    }, [fixedFilter, setFilterValues]);

    const contextValue = useMemo(() => ({
        select,
        onValueChange,
        size: size ?? "m",
        selectionStore,
        setPopupCell
    } as unknown as DataCollectionTableController<Record<string, unknown>>), [setPopupCell, select, onValueChange, size, selectionStore]);

    const createFilterField = useCallback(({
        id,
        filterValue,
        setFilterValue,
        column,
        hidden,
        setHidden
    }: FilterFormFieldProps<unknown>): React.ReactNode => {
        if (!column.custom) return null;
        const { resolvedProperty } = column.custom as { resolvedProperty?: Property };
        if (!resolvedProperty) return null;
        // Engine-aware operator resolution happens inside FilterFieldBinding,
        // which reads the collection from the surrounding CollectionScopeProvider.
        return <FilterFieldBinding
            propertyKey={id as string}
            property={resolvedProperty}
            value={filterValue as [WhereFilterOp, unknown] | undefined}
            setValue={setFilterValue as (value?: [WhereFilterOp, unknown]) => void}
            hidden={hidden}
            setHidden={setHidden}/>;
    }, []);

    return (
        <SelectableTableContext.Provider
            value={contextValue}>
            <div className="h-full w-full flex flex-col bg-white dark:bg-surface-900"
                ref={ref}>

                 <VirtualTable
                    data={data as unknown as Record<string, unknown>[]}
                    columns={columns}
                    cellRenderer={(props) => cellRenderer(props as unknown as CellRendererParams<Entity<M>>)}
                    onRowClick={inlineEditing ? undefined : (onEntityClick ? onRowClick : undefined)}
                    onEndReached={loadNextPage}
                    onResetPagination={resetPagination}
                    error={dataLoadingError}
                    onColumnResize={onColumnResize}
                    rowHeight={getRowHeight(size)}
                    loading={dataLoading}
                    filter={filterValues as any}
                    onFilterUpdate={setFilterValues ? onFilterUpdate : undefined}
                    sortBy={sortBy}
                    onSortByUpdate={setSortBy as ((sortBy?: [string, "asc" | "desc"][]) => void)}
                    hoverRow={hoverRow}
                    initialScroll={initialScroll}
                    onScroll={onScroll}
                    checkFilterCombination={checkFilterCombination}
                    createFilterField={filterable ? createFilterField : undefined}
                    rowClassName={useCallback((entity: Record<string, unknown>) => {
                        return highlightedRow?.(entity as unknown as Entity<M>) ? "bg-surface-accent-50 dark:!bg-surface-accent-900" : "";
                    }, [highlightedRow])}
                    className="grow"
                    emptyComponent={emptyComponent}
                    endAdornment={endAdornment}
                    AddColumnComponent={AddColumnComponent}
                    onColumnsOrderChange={onColumnsOrderChange}
                    extraData={extraData}
                />

            </div>
        </SelectableTableContext.Provider>
    );

};

