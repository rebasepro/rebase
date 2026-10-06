import React from "react";

import { deepEqual as equal } from "fast-equals"

import { CellRendererParams, VirtualTableColumn } from "./VirtualTableProps";

type VirtualTableCellProps<T> = {
    dataKey: string;
    column: VirtualTableColumn;
    columns: VirtualTableColumn[];
    rowData: T;
    cellData: unknown;
    rowIndex: number;
    columnIndex: number;
    cellRenderer: (props: CellRendererParams<T>) => React.ReactNode;
    // Sortable props
    sortableNodeRef?: (node: HTMLElement | null) => void;
    sortableStyle?: React.CSSProperties;
    sortableAttributes?: Record<string, unknown>;
    isDragging?: boolean;
    isDraggable?: boolean;
    frozen?: boolean;
    extraData?: unknown;
};

export const VirtualTableCell = React.memo<VirtualTableCellProps<unknown>>(
    function VirtualTableCell<T>(props: VirtualTableCellProps<T>) {
        return props.rowData ? props.cellRenderer(
            {
                cellData: props.cellData,
                rowData: props.rowData,
                rowIndex: props.rowIndex,
                isScrolling: false,
                column: props.column,
                columns: props.columns,
                columnIndex: props.columnIndex,
                width: props.column.width,
                sortableNodeRef: props.sortableNodeRef,
                sortableStyle: props.sortableStyle,
                sortableAttributes: props.sortableAttributes,
                isDragging: props.isDragging,
                isDraggable: props.isDraggable,
                frozen: props.frozen,
                extraData: props.extraData
            } as CellRendererParams<T>
        ) : null;
    },
    areCellPropsEqual
);

/**
 * Every prop the cell hands `cellRenderer` is compared, and so is
 * `cellRenderer` itself: a cell that kept the renderer it was first given kept
 * every value that renderer closed over — inline editing switched off, a
 * permission revoked, a new row-actions builder — until its row changed.
 *
 * Values that a parent rebuilds on each render (the row, its cell value, the
 * column, `extraData`) are compared by value; `deepEqual` returns at once for
 * the same reference. Functions and `columns` are compared by reference —
 * `VirtualTable` holds `columns` by value already.
 */
function areCellPropsEqual(a: VirtualTableCellProps<unknown>, b: VirtualTableCellProps<unknown>): boolean {
    return a.cellRenderer === b.cellRenderer &&
        a.columns === b.columns &&
        a.dataKey === b.dataKey &&
        a.rowIndex === b.rowIndex &&
        a.columnIndex === b.columnIndex &&
        a.isDragging === b.isDragging &&
        a.isDraggable === b.isDraggable &&
        a.frozen === b.frozen &&
        a.sortableNodeRef === b.sortableNodeRef &&
        a.sortableStyle === b.sortableStyle &&
        a.sortableAttributes === b.sortableAttributes &&
        equal(a.column, b.column) &&
        equal(a.cellData, b.cellData) &&
        equal(a.extraData, b.extraData) &&
        equal(a.rowData, b.rowData);
}
