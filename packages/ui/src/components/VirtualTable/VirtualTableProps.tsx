

import React from "react";
import type { FilterFormFieldProps } from "./VirtualTableHeader";

export type OnRowClickParams<T extends Record<string, unknown>> = {
    rowData: T;
    rowIndex: number;
    event: React.SyntheticEvent
};

/**
 * @see Table
 * @group Components
 */
export interface VirtualTableProps<T extends Record<string, unknown>> {

    /**
     * Array of arbitrary data
     */
    data?: T[];

    /**
     * Properties displayed in this collection. If this property is not set
     * every property is displayed, you can filter
     */
    columns: VirtualTableColumn[];

    /**
     * Custom cell renderer
     * The renderer receives props `{ cellData, columns, column, columnIndex, rowData, rowIndex, container, isScrolling }`
     */
    cellRenderer: (props: CellRendererParams<T>) => React.ReactNode;

    /**
     * Set this callback if you want to support some combinations
     * of filter combinations only.
     * @param filterValues
     * @param sortBy
     */
    checkFilterCombination?: (filterValues: VirtualTableFilterValues<Extract<keyof T, string>>,
        sortBy?: [string, "asc" | "desc"]) => boolean;

    /**
     * A callback function when scrolling the table to near the end
     */
    onEndReached?: () => void;

    /**
     * Offset in pixels where the onEndReached callback is triggered
     */
    endOffset?: number;

    /**
     * When the pagination should be reset. E.g. the filters or sorting
     * has been reset.
     */
    onResetPagination?: () => void;

    /**
     * Callback when a row is clicked
     */
    onRowClick?: (props: OnRowClickParams<T>) => void;

    /**
     * Callback when a column is resized
     */
    onColumnResize?: (params: OnVirtualTableColumnResizeParams) => void;
    onColumnResizeEnd?: (params: OnVirtualTableColumnResizeParams) => void;

    /**
     * Size of the table
     */
    rowHeight?: number,
    headerHeight?: number,

    /**
     * In case this table should have some filters set by default
     */
    filter?: VirtualTableFilterValues<string>;

    /**
     * Callback used when filters are updated
     * @param filter
     */
    onFilterUpdate?: (filter?: VirtualTableFilterValues<string> | undefined) => void;

    /**
     * Callback when the table is scrolled
     * @param props
     */
    onScroll?: (props: {
        scrollDirection: "forward" | "backward",
        scrollOffset: number,
        scrollUpdateWasRequested: boolean
    }) => void;

    /**
     * Default sort applied to this collection
     */
    sortBy?: [string, "asc" | "desc"];

    /**
     * Callback used when sorting is updated
     * @param sortBy
     */
    onSortByUpdate?: (sortBy?: [string, "asc" | "desc"]) => void;

    /**
     * If there is an error loading data you can pass it here, so it gets
     * displayed instead of the content
     */
    error?: Error;

    /**
     * Message displayed when there is no data
     */
    emptyComponent?: React.ReactNode;

    /**
     * Is the table in a loading state
     */
    loading?: boolean;

    /**
     * Should apply a different style when hovering
     */
    hoverRow?: boolean;

    /**
     * Apply a custom class name to the row
     * @param rowData
     */
    rowClassName?: (rowData: T) => string | undefined;

    /**
     * Callback to create a filter field, displayed in the header as a dropdown
     * @param props
     */
    createFilterField?: (props: FilterFormFieldProps<unknown>) => React.ReactNode;

    /**
     * Class name applied to the table
     */
    className?: string;

    /**
     * Style applied to the table
     */
    style?: React.CSSProperties;

    /**
     * Component rendered at the end of the table, after scroll
     */
    endAdornment?: React.ReactNode;

    /**
     * If adding this callback, a button to add a new column is displayed.
     * @param column
     */
    AddColumnComponent?: React.ComponentType;

    /**
     * Initial scroll position
     */
    initialScroll?: number;

    /**
     * Callback when columns are reordered via drag-and-drop.
     * @param columns The new column order
     */
    onColumnsOrderChange?: (columns: VirtualTableColumn[]) => void;

    /**
     * Extra data passed to the cell renderer
     */
    extraData?: unknown;

}

export type CellRendererParams<T = unknown> = {
    column: VirtualTableColumn;
    columns: VirtualTableColumn[];
    columnIndex: number;
    rowData?: T;
    rowIndex: number;
    width: number;
    isScrolling?: boolean;
    // Sortable props for dnd-kit integration
    sortableNodeRef?: (node: HTMLElement | null) => void;
    sortableStyle?: React.CSSProperties;
    sortableAttributes?: Record<string, unknown>;
    isDragging?: boolean;
    isDraggable?: boolean;
    frozen?: boolean;
    extraData?: unknown;
};

/**
 * @see Table
 * @group Components
 */
export interface VirtualTableColumn<CustomProps = unknown> {

    /**
     * Data key for the cell value, could be "a.b.c"
     */
    key: string;

    /**
     * The width of the column, gutter width is not included
     */
    width: number;

    /**
     * Label displayed in the header
     */
    title?: string;

    /**
     * This column is frozen to the left
     */
    frozen?: boolean;

    /**
     * How is the
     */
    headerAlign?: "left" | "center" | "right";

    /**
     * Icon displayed in the header
     */
    icon?: React.ReactNode;

    /**
     *
     */
    filter?: boolean;

    /**
     * Alignment of the column cell
     */

    align?: "left" | "right" | "center";

    /**
     * Whether the column is sortable, defaults to false
     */
    sortable?: boolean;

    /**
     * Can it be resized
     */
    resizable?: boolean;

    /**
     * Custom props passed to the cell renderer
     */
    custom?: CustomProps;

    /**
     * Additional children to be rendered in the header when hovering
     */
    AdditionalHeaderWidget?: (props: { onHover: boolean }) => React.ReactNode;
}

/**
 * @see Table
 * @group Collection components
 */
export type OnVirtualTableColumnResizeParams = {
    width: number,
    key: string,
    column: VirtualTableColumn
};

/**
 * The filter operators this table can express.
 *
 * A deliberate copy of `WhereFilterOp` in `@rebasepro/types`, not an import:
 * `@rebasepro/ui` has no dependency on the core types and is meant to stay
 * usable on its own. The cost is that two published packages export the same
 * name, so the two must be kept identical by hand —
 * `packages/types/test/filter-operators-duplication.test.ts` fails if they
 * diverge, because a table that cannot express an operator the query layer
 * supports is a silent gap: the filter simply is not offered.
 *
 * @see Table
 * @group Components
 */
export type WhereFilterOp =
    | "<"
    | "<="
    | "=="
    | "!="
    | ">="
    | ">"
    | "array-contains"
    | "in"
    | "not-in"
    | "array-contains-any"
    | "like"
    | "ilike"
    | "not-like"
    | "not-ilike"
    | "is-null"
    | "is-not-null";

export type FilterValues<Key extends string> =
    Partial<Record<Key, [WhereFilterOp, unknown] | [WhereFilterOp, unknown][]>>;

/**
 * @see Table
 * @group Components
 */
export type VirtualTableSort = "asc" | "desc" | undefined;

/**
 * @see Table
 * @group Components
 */
export type VirtualTableFilterValues<Key extends string> = FilterValues<Key>;

/**
 * Filter conditions in a `Query.where()` clause, named by {@link WhereFilterOp}.
 *
 * The list is not repeated here: this comment used to name eight operators when
 * the type had sixteen, having been written before the SQL pattern and null
 * checks (`like`, `ilike`, `not-like`, `not-ilike`, `is-null`, `is-not-null`)
 * were added. A prose copy of a union drifts from it silently.
 *
 * @see Table
 * @group Models
 */
export type VirtualTableWhereFilterOp = WhereFilterOp;
