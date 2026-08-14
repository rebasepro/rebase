import React from "react";
import {
    CellRendererParams,
    OnRowClickParams,
    OnVirtualTableColumnResizeParams,
    VirtualTableColumn,
    VirtualTableFilterValues,
    VirtualTableWhereFilterOp
} from "./VirtualTableProps";
import { FilterFormFieldProps } from "./VirtualTableHeader";

export type VirtualTableRowProps<T extends Record<string, unknown>> = {
    style: React.CSSProperties,
    rowHeight: number,
    rowData: T;
    rowIndex: number;
    onRowClick?: (props: OnRowClickParams<Record<string, unknown>>) => void;
    children: React.ReactNode[];
    columns: VirtualTableColumn[];
    hoverRow?: boolean;
    rowClassName?: (rowData: T) => string | undefined;
};

export type VirtualTableContextProps<T> = {
    data?: T[];
    rowHeight?: number,
    headerHeight?: number,
    columns: VirtualTableColumn[];
    cellRenderer: React.ComponentType<CellRendererParams<T>>;
    /** Each sorted column's direction and its rank in the sort, keyed by column. */
    sortIndex: Map<string, { direction: "asc" | "desc"; position: number }>;
    filter?: VirtualTableFilterValues<string>;
    onRowClick?: (props: OnRowClickParams<Record<string, unknown>>) => void;
    onColumnSort: (key: string, additive?: boolean) => void;
    onColumnResize: (params: OnVirtualTableColumnResizeParams) => void;
    onColumnResizeEnd: (params: OnVirtualTableColumnResizeParams) => void;
    onFilterUpdate: (column: VirtualTableColumn, filterForProperty?: [VirtualTableWhereFilterOp, unknown]) => void;
    customView?: React.ReactNode,
    hoverRow: boolean;
    createFilterField?: (props: FilterFormFieldProps<unknown>) => React.ReactNode;
    rowClassName?: (rowData: T) => string | undefined;
    endAdornment?: React.ReactNode;
    AddColumnComponent?: React.ComponentType;
    onColumnsOrderChange?: (columns: VirtualTableColumn[]) => void;
    draggingColumnId?: string | null;
    extraData?: unknown;
};
