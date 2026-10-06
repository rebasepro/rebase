import React, { useCallback } from "react";

import { VirtualTableRowProps } from "./types";
import { cls } from "../../util/cls";

/**
 * Not memoised itself: `VirtualTableRowRenderer` (in `VirtualTable`) decides
 * when a row is drawn again, from the inputs its cells are built from. A memo
 * here could only compare the `children` it is handed, and those are new
 * elements every time the renderer runs — it deep-compared every cell element
 * and the full `columns` array each one carries, to find them unequal.
 */
export function VirtualTableRow<T extends object>({
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
}
