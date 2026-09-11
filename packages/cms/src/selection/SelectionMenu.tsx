import React, { useMemo } from "react";
import { Entity } from "@rebasepro/types";
import { SelectionController, SelectionQuery } from "@rebasepro/cms-types";
import { Checkbox, ChevronDownIcon, Menu, MenuItem, Tooltip, cls, iconSize } from "@rebasepro/ui";
import { useTranslation } from "@rebasepro/app";

export interface SelectionMenuProps<M extends Record<string, unknown>> {
    selectionController: SelectionController<M>;
    /** The rows the view is holding right now. */
    loadedEntities: Entity<M>[];
    /** The view's live query — what "all matching" stands for. */
    query: SelectionQuery<M>;
    /** The view's filtered count. `undefined` while loading, or where the accessor has none. */
    collectionEntitiesCount?: number;
    collectionName: string;
}

/**
 * The whole of selecting rows, in one control: a checkbox for the common case
 * and a caret for everything else.
 *
 * The escalation from "the rows on screen" to "every row that matches" lived in
 * a strip under the toolbar, which was wrong in a way that only shows up in
 * use: it appears the moment you tick a single checkbox, and the list you were
 * reading jumps down by its height. A control that punishes the first click is
 * not worth whatever the strip was explaining.
 *
 * So the escalation is a menu item — clicked deliberately, costing no layout,
 * and in the place you already go to select everything.
 */
export function SelectionMenu<M extends Record<string, unknown>>({
    selectionController,
    loadedEntities,
    query,
    collectionEntitiesCount,
    collectionName
}: SelectionMenuProps<M>) {

    const { t } = useTranslation();
    const {
        selection,
        selectedCount,
        hasSelection,
        isEntitySelected,
        setSelectedEntities,
        selectAllMatching,
        clearSelection
    } = selectionController;

    const selectedLoaded = useMemo(
        () => loadedEntities.filter(e => isEntitySelected(e)).length,
        [loadedEntities, isEntitySelected]
    );

    const allLoadedSelected = loadedEntities.length > 0 && selectedLoaded === loadedEntities.length;
    const someSelected = selectedLoaded > 0 && !allLoadedSelected;
    const isQuery = selection.type === "query";

    // The count can outrun the loaded rows without there being more to select —
    // it is fetched separately and settles at its own pace.
    const moreThanLoaded = collectionEntitiesCount !== undefined
        && collectionEntitiesCount > loadedEntities.length;

    const label = hasSelection
        ? (t("selection_deselect_all") ?? "Deselect all")
        : (t("selection_select_all_loaded") ?? "Select all loaded rows");

    return (
        <div className={cls("flex items-center rounded-md",
            hasSelection && "bg-surface-hover")}>

            <Tooltip title={label}>
                <div className="pl-1.5 pr-0.5 py-1 flex items-center">
                    <Checkbox
                        size="small"
                        padding={false}
                        aria-label={label}
                        disabled={loadedEntities.length === 0 && !isQuery}
                        checked={allLoadedSelected || isQuery}
                        indeterminate={someSelected}
                        onCheckedChange={(checked) => {
                            if (checked) setSelectedEntities(loadedEntities);
                            else clearSelection();
                        }}/>
                </div>
            </Tooltip>

            <Menu
                align="start"
                trigger={
                    <button
                        type="button"
                        aria-label={t("selection_options") ?? "Selection options"}
                        className={cls(
                            "pr-1 pl-0 py-1 flex items-center rounded-r-md",
                            "hover:bg-surface-hover focus:outline-none",
                            "text-surface-accent-500 dark:text-surface-accent-300"
                        )}>
                        <ChevronDownIcon size={iconSize.smallest}/>
                    </button>
                }>

                <MenuItem dense onClick={() => setSelectedEntities(loadedEntities)}>
                    {t("selection_menu_all_loaded") ?? "All on this page"}
                </MenuItem>

                {/* The point of the whole feature, and the only place it is
                    offered. Absent when the view already holds every matching
                    row, because then it is the item above under another name. */}
                {moreThanLoaded && <MenuItem
                    dense
                    onClick={() => selectAllMatching(query, collectionEntitiesCount)}>
                    {t("selection_menu_all_matching", {
                        total: collectionEntitiesCount!.toLocaleString(),
                        collection: collectionName
                    }) ?? `All ${collectionEntitiesCount!.toLocaleString()} ${collectionName}`}
                </MenuItem>}

                <MenuItem dense disabled={!hasSelection} onClick={clearSelection}>
                    {t("selection_menu_none") ?? "None"}
                </MenuItem>
            </Menu>

            {/* What is selected, where the control is — not in a strip that
                moves the rows. `undefined` is "every matching row, and nobody
                knows how many", which is why it is not defaulted to a number. */}
            {hasSelection && <span
                data-testid="selection-count"
                className="pl-1 pr-2 text-xs font-mono tabular-nums text-text-secondary dark:text-text-secondary-dark">
                {selectedCount === undefined ? "…" : selectedCount.toLocaleString()}
            </span>}
        </div>
    );
}
