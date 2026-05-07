import { Skeleton } from "@rebasepro/ui";
import { Type } from "lucide-react";
import React from "react";
import { CellRendererParams, VirtualTable, VirtualTableColumn } from "@rebasepro/ui";
import { DataRow, DataType, TableColumn } from "../types";
import { DataTableCell } from "./DataTableCell";


export type DataTableProps = {
    columns: TableColumn[];
    data?: DataRow[];
    zoom?: number;
    maxWidth?: number;
    ref: React.RefObject<HTMLDivElement | null>,
    onEndReached?: () => void;
    onColumnResize?: (params: { key: string, width: number }) => void;
    loading?: boolean;
    sortBy?: [string, "asc" | "desc"];
    onSortByUpdate?: (sortBy?: [string, "asc" | "desc"]) => void;
}

export function DataTable({
    data,
    columns,
    ref,
    zoom = 1,
    onColumnResize,
    maxWidth,
    onEndReached,
    loading,
    sortBy,
    onSortByUpdate
}: DataTableProps) {

    function cellRenderer({
        columns,
        column,
        columnIndex,
        rowData,
        rowIndex,
        isScrolling
    }: CellRendererParams) {

        if (rowData.__isSkeleton) {
            return <DataTableCell
                align={column.align}
                width={column.width}
                value={"__SKELETON__"}>
                <Skeleton height={16} className={"opacity-50 w-4/5"} />
            </DataTableCell>;
        }

        // Use direct property access instead of getIn to handle special characters in keys
        const entry = rowData[column.key];
        let value = entry;
        if (column.custom?.dataType === "date" && typeof entry === "string") {
            const date = new Date(entry);
            if (!isNaN(date.getTime())) {
                value = date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
            }
        }

        return <DataTableCell
            align={column.align}
            width={column.width}
            value={entry}>
            {value}
        </DataTableCell>;
    }

    const tableColumns: VirtualTableColumn[] = columns.map(col => {
        return {
            key: col.key,
            title: col.name,
            width: col.width ?? getColumnWidth(col.dataType),
            resizable: true,
            sortable: true,
            custom: {
                dataType: col.dataType
            }
        };
    });

    return (
        <>
            <div className="rounded-xl border border-surface-100 dark:border-surface-800/80 nowheel nodrag flex h-full w-full flex-col bg-white dark:bg-surface-950"
                style={{
                    maxWidth
                }}
                ref={ref}>

                <VirtualTable
                    loading={loading}
                    data={data}
                    rowHeight={48}
                    columns={tableColumns}
                    cellRenderer={cellRenderer}
                    onColumnResize={onColumnResize}
                    onEndReached={onEndReached}
                    endOffset={1600}
                    className={"rounded-xl w-full h-full overflow-hidden"}
                    sortBy={sortBy}
                    onSortByUpdate={onSortByUpdate}
                />

            </div>

        </>
    );

};

function getColumnWidth(dataType?: DataType) {
    switch (dataType) {
        case "object":
            return 300;
        case "string":
            return 300;
        case "number":
            return 180;
        case "date":
            return 240;
        case "array":
            return 240;
        default:
            return 200;
    }
}
