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
    (a, b) => {
        return equal(a.rowData, b.rowData) &&
            equal(a.column, b.column) &&
            equal(a.cellData, b.cellData) &&
            a.rowIndex === b.rowIndex &&
            a.columnIndex === b.columnIndex &&
            a.isDragging === b.isDragging &&
            a.isDraggable === b.isDraggable &&
            a.frozen === b.frozen &&
            equal(a.extraData, b.extraData)
    }
);
