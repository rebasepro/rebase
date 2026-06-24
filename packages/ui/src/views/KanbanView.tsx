import React from "react";
import { Board } from "./Kanban/Board";
import { BoardItem, BoardItemViewProps, ColumnLoadingState } from "./Kanban/board_types";

export type KanbanViewProps<T, COLUMN extends string> = {
    columns: COLUMN[];
    columnLabels?: Record<COLUMN, string>;
    columnColors?: Record<COLUMN, any>;
    className?: string;
    assignColumn: (item: BoardItem<T>) => COLUMN;
    allowColumnReorder?: boolean;
    onColumnReorder?: (columns: COLUMN[]) => void;
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
    data: BoardItem<T>[];
};

export function KanbanView<T, COLUMN extends string>(props: KanbanViewProps<T, COLUMN>) {
    return <Board {...props} />;
}
export type { BoardItem, BoardItemViewProps, ColumnLoadingState };
