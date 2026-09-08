import React from "react";
import { cls, IconButton, PencilIcon, Tooltip, XIcon } from "@rebasepro/ui";
import { useTranslation } from "@rebasepro/app";

/**
 * The one-line editor a reference or relation cell shows while selected, at
 * the row sizes that carry small previews (`xs`, `s`, `m`).
 *
 * The flow it replaces: at 48px the selected cell swapped its resting inline
 * line for the card editor built for 140px rows, which was clipped to its top
 * third and whose only click opened the picker — there was no way to look at
 * the record. Here the line stays (its title opens the record in the side
 * panel, exactly as it does at rest), a pencil opens the picker and a cross
 * clears the value. Click the name to see it, click the pencil to change it.
 */
export function CompactEntityCellField({
    children,
    empty,
    disabled,
    onEdit,
    onClear,
    emptyLabel
}: {
    /** The inline previews of the current value or values. */
    children?: React.ReactNode;
    /** No value: the line becomes the select prompt. */
    empty: boolean;
    disabled: boolean;
    onEdit: () => void;
    onClear: () => void;
    /** Shown in place of the previews when empty. Defaults to "Select reference". */
    emptyLabel?: string;
}) {
    const { t } = useTranslation();
    return (
        <div className={"w-full min-w-0 flex items-center gap-0.5 min-h-8"}>
            <div className={"grow min-w-0 flex items-center gap-x-3 overflow-hidden text-sm"}>
                {empty
                    ? <button type="button"
                        disabled={disabled}
                        onClick={(e) => {
                            e.stopPropagation();
                            onEdit();
                        }}
                        className={cls("truncate text-left text-text-secondary dark:text-text-secondary-dark",
                            !disabled && "cursor-pointer hover:text-text-primary dark:hover:text-text-primary-dark")}>
                        {emptyLabel ?? t("select_reference")}
                    </button>
                    : children}
            </div>
            {!disabled && <>
                <Tooltip title={t("edit")}>
                    <IconButton size={"small"}
                        aria-label={t("edit")}
                        onClick={(e) => {
                            e.stopPropagation();
                            onEdit();
                        }}>
                        <PencilIcon/>
                    </IconButton>
                </Tooltip>
                {!empty && <Tooltip title={t("clear")}>
                    <IconButton size={"small"}
                        aria-label={t("clear")}
                        onClick={(e) => {
                            e.stopPropagation();
                            onClear();
                        }}>
                        <XIcon/>
                    </IconButton>
                </Tooltip>}
            </>}
        </div>
    );
}
