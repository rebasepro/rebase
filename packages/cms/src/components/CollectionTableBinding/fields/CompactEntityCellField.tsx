import React from "react";
import { cls, IconButton, Tooltip, XIcon } from "@rebasepro/ui";
import { useTranslation } from "@rebasepro/app";
import { EmptyValue } from "../../../preview";

/**
 * A reference or relation cell, at the row sizes that carry small previews
 * (`xs`, `s`, `m`), for the pickers that open a selection dialog.
 *
 * The value is one line of inline previews, the same at rest and selected:
 * each title opens its record in the side panel. The cell's opener — the
 * chevron it reveals on hover — opens the dialog, and a cross beside it clears
 * the value. The cross follows the opener: hidden at rest, shown on hover and
 * while the cell is selected.
 */
export function CompactEntityCellField({
    children,
    empty,
    disabled,
    selected,
    onClear
}: {
    /** The inline previews of the current value or values. */
    children?: React.ReactNode;
    /** No value: the line shows the empty marker every other empty cell shows. */
    empty: boolean;
    disabled: boolean;
    /** The cell is selected: the cross is shown whether or not it is hovered. */
    selected?: boolean;
    onClear: () => void;
}) {
    const { t } = useTranslation();
    return (
        <div className={"w-full min-w-0 flex items-center gap-0.5 min-h-8"}>
            <div className={"grow min-w-0 flex items-center gap-x-3 overflow-hidden text-sm"}>
                {empty ? <EmptyValue/> : children}
            </div>
            {!disabled && !empty && <Tooltip title={t("clear")}>
                <IconButton size={"smallest"}
                    shape={"square"}
                    aria-label={t("clear")}
                    className={cls("w-6 !h-6 min-w-6 min-h-6 p-0 hover:scale-100 transition-opacity duration-100",
                        selected ? "opacity-100" : "opacity-0 group-hover/cell:opacity-100 focus-visible:opacity-100")}
                    onMouseDown={(e: React.MouseEvent) => e.preventDefault()}
                    onClick={(e: React.MouseEvent) => {
                        e.stopPropagation();
                        onClear();
                    }}>
                    <XIcon size={14}/>
                </IconButton>
            </Tooltip>}
        </div>
    );
}
