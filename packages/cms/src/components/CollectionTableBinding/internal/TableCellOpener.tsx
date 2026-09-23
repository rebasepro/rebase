import React, { useEffect, useRef } from "react";
import { CalendarIcon, ChevronDownIcon, cls, IconButton, iconSize, Maximize2Icon } from "@rebasepro/ui";

/**
 * What a cell's opener opens.
 *
 * - `dropdown`: a list anchored to the cell — an enum, a user, an inline
 *   relation picker.
 * - `dialog`: the selection dialog of a reference, or of a relation drawn with
 *   the dialog widget. Same chevron: to the person editing, both change which
 *   record the cell points at.
 * - `calendar`: the date picker.
 * - `expand`: the popup form, for values with no editor of their own in a
 *   cell (maps, arrays, custom fields).
 */
export type TableCellOpenerKind = "dropdown" | "dialog" | "calendar" | "expand";

export interface TableCellOpenerProps {
    kind: TableCellOpenerKind;
    /** The editor it opens is open: the chevron turns over and stays shown. */
    open: boolean;
    /** The cell is selected: the opener is shown whether or not it is hovered. */
    selected: boolean;
    /**
     * Take the focus when the cell is selected, so Enter opens the editor.
     * Off when the editor's own trigger takes it instead.
     */
    focusOnSelect: boolean;
    label: string;
    /**
     * Called on a click, with whether the editor should now be open. A click
     * while it is open closes it rather than opening it a second time.
     */
    onToggle: (open: boolean) => void;
}

/**
 * The one control a cell reveals to open its editor.
 *
 * A cell looks the same at rest, hovered and selected: the value, in the same
 * place. This is the only thing that appears — on hover, and for as long as
 * the cell is selected — in a slot the cell keeps for it whether it is shown
 * or not, so revealing it moves nothing.
 *
 * One click on it opens the editor, from rest: it selects the cell on the way.
 * It never takes the focus on a mouse press, because the cell selects itself
 * on focus and doing so first would re-render the cell under the pointer.
 */
export function TableCellOpener({
    kind,
    open,
    selected,
    focusOnSelect,
    label,
    onToggle
}: TableCellOpenerProps) {

    const ref = useRef<HTMLButtonElement>(null);

    // Read on pointer down, before anything else hears the press. A picker
    // that closes itself on an outside mousedown has already closed by the
    // time the click arrives, and the click would open it again.
    const openAtPressRef = useRef<boolean | undefined>(undefined);
    useEffect(() => {
        if (selected && focusOnSelect)
            ref.current?.focus({ preventScroll: true });
    }, [selected, focusOnSelect]);

    const Icon = kind === "calendar"
        ? CalendarIcon
        : kind === "expand"
            ? Maximize2Icon
            : ChevronDownIcon;

    return (
        <IconButton
            ref={ref}
            size={"smallest"}
            shape={"square"}
            aria-label={label}
            aria-haspopup={kind === "calendar" || kind === "expand" ? "dialog" : "listbox"}
            aria-expanded={kind === "dropdown" ? open : undefined}
            tabIndex={-1}
            data-table-cell-opener={kind}
            className={cls(
                "w-6 !h-6 min-w-6 min-h-6 p-0 hover:scale-100",
                "transition-opacity duration-100",
                selected || open
                    ? "opacity-100"
                    : "opacity-0 group-hover/cell:opacity-100 focus-visible:opacity-100"
            )}
            onPointerDown={() => {
                openAtPressRef.current = open;
            }}
            onMouseDown={(event: React.MouseEvent) => event.preventDefault()}
            onClick={(event: React.MouseEvent) => {
                event.stopPropagation();
                const wasOpen = openAtPressRef.current ?? open;
                openAtPressRef.current = undefined;
                onToggle(!wasOpen);
            }}>
            <Icon size={iconSize.smallest}
                className={cls(kind === "dropdown" || kind === "dialog" ? "transition-transform duration-150" : "",
                    open && (kind === "dropdown" || kind === "dialog") ? "rotate-180" : "")}/>
        </IconButton>
    );
}
