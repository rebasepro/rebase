"use client";
import React, { useCallback, useMemo } from "react";
import { VirtualTable } from "../../components/VirtualTable/VirtualTable";
import type { VirtualTableColumn, CellRendererParams, OnVirtualTableColumnResizeParams } from "../../components/VirtualTable/VirtualTableProps";
import { DefaultCellRenderer } from "./DefaultCellRenderer";
import { cls } from "../../util";
import type {
    CollectionPropertyConfig,
    CollectionDataController,
    CellRendererOverride,
    CollectionViewSize,
    CollectionSelectionController,
    CellRendererProps,
} from "./CollectionViewTypes";

import { getValueInPath } from "./utils";

const DEFAULT_COLUMN_WIDTHS: Record<string, number> = {
    string: 200,
    number: 140,
    date: 160,
    boolean: 120,
    array: 200,
    map: 200,
    reference: 200,
    relation: 200,
    geopoint: 180,
};
const FALLBACK_COLUMN_WIDTH = 200;

const SIZE_TO_ROW_HEIGHT: Record<CollectionViewSize, number> = {
    xs: 36,
    s: 44,
    m: 52,
    l: 64,
    xl: 80,
};

const SORTABLE_TYPES = new Set(["string", "number", "date"]);

type RendererSize = "tiny" | "small" | "medium" | "large";

const VIEW_SIZE_TO_RENDERER_SIZE: Record<CollectionViewSize, RendererSize> = {
    xs: "tiny",
    s: "small",
    m: "medium",
    l: "large",
    xl: "large",
};

/**
 * Props for the {@link CollectionTableView} component.
 * @group Collection View
 */
export type CollectionTableViewProps<T = Record<string, unknown>> = {
    dataController: CollectionDataController<T>;
    properties: Record<string, CollectionPropertyConfig>;
    propertiesOrder?: string[];
    displayedColumnIds?: string[];
    idProperty?: string;
    titleProperty?: string;
    onRowClick?: (row: T) => void;
    cellRenderer?: CellRendererOverride<T>;
    size?: CollectionViewSize;
    selectionEnabled?: boolean;
    selectionController?: CollectionSelectionController<T>;
    highlightedItems?: T[];
    emptyComponent?: React.ReactNode;
    hoverRow?: boolean;
    className?: string;
    onColumnResize?: (params: { key: string; width: number }) => void;
    onColumnsOrderChange?: (keys: string[]) => void;
};

/**
 * Headless table view that wraps {@link VirtualTable}.
 *
 * Converts property configurations into virtual table columns and wires up
 * sorting, pagination, and cell rendering without coupling to any data layer.
 *
 * @group Collection View
 */
export function CollectionTableView<T extends Record<string, unknown> = Record<string, unknown>>({
    dataController,
    properties,
    propertiesOrder,
    displayedColumnIds,
    onRowClick,
    cellRenderer,
    size = "m",
    emptyComponent,
    hoverRow = true,
    className,
    onColumnResize,
    onColumnsOrderChange,
}: CollectionTableViewProps<T>) {
    // ── Build columns ────────────────────────────────────────────────
    const columns = useMemo<VirtualTableColumn[]>(() => {
        const order = propertiesOrder ?? Object.keys(properties);
        const filteredKeys = displayedColumnIds
            ? order.filter((key) => displayedColumnIds.includes(key))
            : order.filter((key) => {
                  const prop = properties[key];
                  return prop && !prop.hideFromCollection;
              });

        return filteredKeys
            .map((key): VirtualTableColumn | null => {
                const prop = properties[key];
                if (!prop) return null;
                return {
                    key,
                    width: prop.columnWidth || DEFAULT_COLUMN_WIDTHS[prop.type] || FALLBACK_COLUMN_WIDTH,
                    title: prop.name,
                    sortable: SORTABLE_TYPES.has(prop.type),
                    resizable: true,
                };
            })
            .filter((col): col is VirtualTableColumn => col !== null);
    }, [properties, propertiesOrder, displayedColumnIds]);

    // ── Row height ───────────────────────────────────────────────────
    const rowHeight = SIZE_TO_ROW_HEIGHT[size];
    const rendererSize = VIEW_SIZE_TO_RENDERER_SIZE[size];

    // ── Cell renderer ────────────────────────────────────────────────
    const tableCellRenderer = useCallback(
        (params: CellRendererParams<Record<string, unknown>>): React.ReactNode => {
            if (!params.rowData) return null;

            const propertyConfig = properties[params.column.key];
            if (!propertyConfig) return null;

            const value = getValueInPath(
                params.rowData,
                params.column.key
            );

            const cellProps: CellRendererProps<T> = {
                row: params.rowData as T,
                propertyKey: params.column.key,
                property: propertyConfig,
                value,
                size: rendererSize,
                width: params.width,
            };

            // Try custom renderer first
            if (cellRenderer) {
                const custom = cellRenderer(cellProps);
                if (custom !== undefined) {
                    return (
                        <div className="flex items-center h-full px-1 overflow-hidden">
                            {custom}
                        </div>
                    );
                }
            }

            return (
                <div className="flex items-center h-full px-1 overflow-hidden">
                    <DefaultCellRenderer {...cellProps} />
                </div>
            );
        },
        [properties, cellRenderer, rendererSize]
    );

    // ── Row click ────────────────────────────────────────────────────
    const handleRowClick = useCallback(
        ({ rowData }: { rowData: Record<string, unknown> }) => {
            onRowClick?.(rowData as T);
        },
        [onRowClick]
    );

    // ── Pagination ──────────────────────────────────────────────────
    const handleEndReached = useCallback(() => {
        if (dataController.paginationEnabled && !dataController.noMoreToLoad) {
            const currentCount = dataController.itemCount ?? dataController.pageSize ?? 50;
            const pageSize = dataController.pageSize ?? 50;
            dataController.setItemCount?.(currentCount + pageSize);
        }
    }, [
        dataController.paginationEnabled,
        dataController.noMoreToLoad,
        dataController.itemCount,
        dataController.pageSize,
        dataController.setItemCount,
    ]);

    // ── Column resize ───────────────────────────────────────────────
    const handleColumnResize = useCallback(
        (params: OnVirtualTableColumnResizeParams) => {
            onColumnResize?.({ key: params.key, width: params.width });
        },
        [onColumnResize]
    );

    // ── Column reorder ──────────────────────────────────────────────
    const handleColumnsOrderChange = useCallback(
        (newColumns: VirtualTableColumn[]) => {
            onColumnsOrderChange?.(newColumns.map((col) => col.key));
        },
        [onColumnsOrderChange]
    );

    return (
        <VirtualTable
            data={dataController.data}
            columns={columns}
            cellRenderer={tableCellRenderer}
            rowHeight={rowHeight}
            sortBy={dataController.sortBy}
            onSortByUpdate={dataController.setSortBy}
            onRowClick={handleRowClick}
            onEndReached={handleEndReached}
            onColumnResize={handleColumnResize}
            onColumnsOrderChange={handleColumnsOrderChange}
            loading={dataController.loading}
            emptyComponent={emptyComponent}
            error={dataController.error}
            hoverRow={hoverRow}
            className={cls("h-full", className)}
            onScroll={dataController.onScroll}
            initialScroll={dataController.initialScroll}
        />
    );
}
