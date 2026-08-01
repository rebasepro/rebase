import { CSSProperties } from "react";

export type ChipColorKey = "primary" | "secondary" | "success" | "warning" | "error" | "info" | "neutral" | string;
export type ChipColorScheme = "filled" | "outlined" | "tinted" | string;

/**
 * Item wrapper for elements in the Board component
 */
export interface BoardItem<T = any> {
    id: string;
    data: T;
}

/**
 * Map of column keys to arrays of board items
 */
export interface BoardItemMap<T = any> {
    [columnKey: string]: BoardItem<T>[];
}

/**
 * Props passed to custom item render components
 */
export interface BoardItemViewProps<T = any> {
    item: BoardItem<T>;
    isDragging: boolean;
    isClone?: boolean;
    isGroupedOver?: boolean;
    style?: CSSProperties;
    index?: number;
}

/**
 * Per-column loading state
 */
export interface ColumnLoadingState {
    [columnKey: string]: {
        loading: boolean;
        hasMore: boolean;
        itemCount: number;
        totalCount?: number;
        /** Set when the column could not be read at all. */
        error?: Error;
    };
}

/**
 * Props for the Board component
 */
export interface BoardProps<T, COLUMN extends string> {
    data: BoardItem<T>[];
    columns: COLUMN[];
    columnLabels?: Record<COLUMN, string>;
    columnColors?: Record<COLUMN, any>;
    className?: string;
    assignColumn: (item: BoardItem<T>) => COLUMN;
    allowColumnReorder?: boolean;
    onColumnReorder?: (columns: COLUMN[]) => void;
    /**
     * A card was dropped.
     *
     * `items` is the target column's contents in their new order — the moved
     * card included — so the neighbours of the moved card are the cards it
     * actually landed between. `sourceColumn` is where the card was picked up,
     * which is not where it now sits whenever the two differ.
     */
    onItemsReorder?: (
        items: BoardItem<T>[],
        moveInfo?: {
            itemId: string;
            sourceColumn: COLUMN;
            targetColumn: COLUMN;
        }
    ) => void;
    ItemComponent: React.ComponentType<BoardItemViewProps<T>>;
    columnLoadingState?: ColumnLoadingState;
    onLoadMoreColumn?: (column: COLUMN) => void;
    onAddItemToColumn?: (column: COLUMN) => void;
    AddColumnComponent?: React.ReactNode;
}
