import React from "react";
import { VirtualTable } from "../components/VirtualTable/VirtualTable";
import { VirtualTableColumn, CellRendererParams } from "../components/VirtualTable/VirtualTableProps";
import { VirtualTableProps } from "../components/VirtualTable/VirtualTableProps";

export type TableViewProps<T extends Record<string, unknown>> = VirtualTableProps<T>;

export function TableView<T extends Record<string, unknown>>(props: TableViewProps<T>) {
    const Component = VirtualTable as any;
    return <Component {...props} />;
}

export type OnColumnResizeParams = {
    width: number;
    key: string;
};
