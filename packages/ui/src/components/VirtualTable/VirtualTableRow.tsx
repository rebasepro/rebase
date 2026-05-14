import React, { useCallback } from "react";

import { deepEqual as equal } from "fast-equals"

import { VirtualTableRowProps } from "./types";
import { cls } from "../../util/cls";
export const VirtualTableRow = React.memo<VirtualTableRowProps<any>>(
    function VirtualTableRow<T>({
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
                    "flex min-w-full text-sm border-b border-surface-200/60 dark:border-surface-700/60 dark:bg-surface-800",
                    rowClassName ? rowClassName(rowData) : "",
                    {
                        "hover:!bg-surface-50/75 dark:hover:!bg-surface-800/75": hoverRow,
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
