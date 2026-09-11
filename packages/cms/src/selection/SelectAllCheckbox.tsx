import React, { useMemo } from "react";
import { Entity } from "@rebasepro/types";
import { SelectionController } from "@rebasepro/cms-types";
import { Checkbox, Tooltip } from "@rebasepro/ui";
import { useTranslation } from "@rebasepro/app";

export interface SelectAllCheckboxProps<M extends Record<string, unknown>> {
    selectionController: SelectionController<M>;
    /** The rows the view is holding right now. */
    loadedEntities: Entity<M>[];
    size?: "smallest" | "small" | "medium" | "large";
}

/**
 * Tick every row the view has loaded, or clear the selection.
 *
 * Deliberately *only* the loaded rows: it is the control a table header has
 * always had, and the one thing it must not do is quietly mean something larger
 * than what is on screen. Widening to the whole collection is the banner's
 * second, explicit click — {@link SelectionBanner}.
 *
 * Indeterminate whenever some but not all loaded rows are selected, which in
 * query mode means some have been ticked back off.
 */
export function SelectAllCheckbox<M extends Record<string, unknown>>({
    selectionController,
    loadedEntities,
    size = "small"
}: SelectAllCheckboxProps<M>) {

    const { t } = useTranslation();
    const { selection, isEntitySelected, setSelectedEntities, clearSelection } = selectionController;

    const selectedLoaded = useMemo(
        () => loadedEntities.filter(e => isEntitySelected(e)).length,
        [loadedEntities, isEntitySelected]
    );

    const allSelected = loadedEntities.length > 0 && selectedLoaded === loadedEntities.length;
    const someSelected = selectedLoaded > 0 && !allSelected;

    // A query selection is never "all loaded and nothing more" — unticking it
    // means dropping the whole query, not the rows on screen.
    const label = allSelected || selection.type === "query"
        ? (t("selection_deselect_all") ?? "Deselect all")
        : (t("selection_select_all_loaded") ?? "Select all loaded rows");

    return (
        <Tooltip title={label}>
            <Checkbox
                size={size}
                padding={false}
                aria-label={label}
                disabled={loadedEntities.length === 0 && selection.type !== "query"}
                checked={allSelected}
                indeterminate={someSelected}
                onCheckedChange={(checked) => {
                    if (checked) setSelectedEntities(loadedEntities);
                    else clearSelection();
                }}/>
        </Tooltip>
    );
}
