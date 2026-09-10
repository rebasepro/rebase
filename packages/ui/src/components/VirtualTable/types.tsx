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

export type VirtualTableRowProps<T extends object> = {
    style: React.CSSProperties,
    rowHeight: number,
    /**
     * Absent while the window is scrolled past what has loaded — the row still
     * has to occupy its slot, so it renders empty rather than not at all.
     *
     * Declared, because it happens. `VirtualTable` used to assert it away with
     * `as Record<string, unknown>` on the way in, and this component then
     * guarded `rowData &&` on the way out — the guard and the type disagreeing
     * about the same value, in the same render.
     */
    rowData: T | undefined;
    rowIndex: number;
    onRowClick?: (props: OnRowClickParams<T>) => void;
    children: React.ReactNode[];
    columns: VirtualTableColumn[];
    hoverRow?: boolean;
    rowClassName?: (rowData: T) => string | undefined;
};

export type VirtualTableContextProps<T extends object> = {
    data?: T[];
    rowHeight?: number,
    headerHeight?: number,
    columns: VirtualTableColumn[];
    cellRenderer: React.ComponentType<CellRendererParams<T>>;
    /** Each sorted column's direction and its rank in the sort, keyed by column. */
    sortIndex: Map<string, { direction: "asc" | "desc"; position: number }>;
    filter?: VirtualTableFilterValues<string>;
    onRowClick?: (props: OnRowClickParams<T>) => void;
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
