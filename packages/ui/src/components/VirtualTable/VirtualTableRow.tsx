import React, { useCallback } from "react";

import { deepEqual as equal } from "fast-equals"

import { VirtualTableRowProps } from "./types";
import { cls } from "../../util/cls";
export const VirtualTableRow = React.memo<VirtualTableRowProps<Record<string, unknown>>>(
    function VirtualTableRow<T extends Record<string, unknown>>({
        rowData,
        rowIndex,
        children,
        onRowClick,
        rowHeight,
        style,
        hoverRow,
        rowClassName
    }: VirtualTableRowProps<T>) {

        const onClick = useCallback((event: React.SyntheticEvent) => {
            if (onRowClick)
                onRowClick({
                    rowData,
                    rowIndex,
                    event
                })
        }, [onRowClick, rowData, rowIndex]);

        return (
            <div
                className={cls(
                    "group flex min-w-full text-sm border-b border-hairline bg-surface-card",
                    rowClassName ? rowClassName(rowData) : "",
                    {
                        "hover:!bg-surface-card-hover": hoverRow,
                        "cursor-pointer ": onRowClick
                    }
                )}
                onClick={onClick}
                style={{
                    ...(style),
                    height: rowHeight,
                    width: "fit-content"
                }}
            >
                {children}
            </div>
        );

    },
    equal
);
