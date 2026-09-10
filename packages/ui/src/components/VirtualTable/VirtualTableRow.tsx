import React, { useCallback } from "react";

import { deepEqual as equal } from "fast-equals"

import { VirtualTableRowProps } from "./types";
import { cls } from "../../util/cls";
const VirtualTableRowInner = React.memo<VirtualTableRowProps<object>>(
    function VirtualTableRow<T extends object>({
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
            // A row with no data yet is not a row anyone clicked *on*.
            if (onRowClick && rowData)
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
                    rowClassName && rowData ? rowClassName(rowData) : "",
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

/**
 * The same fix `VirtualTable` carries, one level down: `React.memo` takes the
 * props type as its own type argument, so the annotation on the call pins the
 * row type at the boundary and discards the `<T>` the inner function declares.
 * Pinned, the row a caller passes in and the row its `onRowClick` and
 * `rowClassName` receive were unrelated types, which is what every consumer was
 * paying for with a cast.
 */
export const VirtualTableRow = VirtualTableRowInner as <T extends object>(
    props: VirtualTableRowProps<T>
) => React.ReactElement | null;
