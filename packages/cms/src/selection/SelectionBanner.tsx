import React, { useMemo } from "react";
import { Entity } from "@rebasepro/types";
import { SelectionController, SelectionQuery } from "@rebasepro/cms-types";
import { Button, Typography, cls } from "@rebasepro/ui";
import { useTranslation } from "@rebasepro/app";

export interface SelectionBannerProps<M extends Record<string, unknown>> {
    selectionController: SelectionController<M>;
    /** The view's live query — what "select all matching" will stand for. */
    query: SelectionQuery<M>;
    /** The view's filtered count. `undefined` while loading or where the accessor has none. */
    collectionEntitiesCount?: number;
    /** Rows the view currently holds, so the banner can say what "all loaded" means. */
    loadedEntities: Entity<M>[];
    collectionName: string;
}

/**
 * The strip under the toolbar that turns "the rows I ticked" into "every row
 * that matches".
 *
 * Selection in a paginated view has always had a gap in it: a view holds a few
 * hundred rows of a collection with hundreds of thousands, so ticking every
 * checkbox on screen selects a sample and looks exactly like selecting the lot.
 * This is Gmail's answer — say plainly how many are actually selected, and
 * offer the whole match as a second, deliberate click.
 *
 * It appears only once something is selected. There is nothing to escalate from
 * an empty selection, and a permanently-present strip above every collection
 * would be chrome that is inert almost all of the time.
 */
export function SelectionBanner<M extends Record<string, unknown>>({
    selectionController,
    query,
    collectionEntitiesCount,
    loadedEntities,
    collectionName
}: SelectionBannerProps<M>) {

    const { t } = useTranslation();
    const {
        selection,
        selectedCount,
        hasSelection,
        selectAllMatching,
        clearSelection
    } = selectionController;

    // Every loaded row being ticked is what makes "…and the rest?" worth
    // asking. Below that the user is picking rows deliberately and an offer to
    // widen it to the whole collection is noise.
    const allLoadedSelected = useMemo(() => {
        if (selection.type === "query") return true;
        if (loadedEntities.length === 0) return false;
        const selected = new Set(selection.entities.map(e => `${e.path}/${e.id}`));
        return loadedEntities.every(e => selected.has(`${e.path}/${e.id}`));
    }, [selection, loadedEntities]);

    if (!hasSelection) return null;

    const isQuery = selection.type === "query";

    // The count can outrun the loaded rows without there being more to select —
    // it is fetched separately and settles at its own pace.
    const moreToSelect = collectionEntitiesCount === undefined
        || selectedCount === undefined
        || collectionEntitiesCount > selectedCount;

    const offerSelectAll = !isQuery && allLoadedSelected && moreToSelect;

    let message: string;
    if (isQuery) {
        message = selectedCount === undefined
            ? (t("selection_all_matching_selected_unknown") ?? "Every row matching the current filter is selected.")
            : (t("selection_all_matching_selected", {
                total: selectedCount.toLocaleString(),
                collection: collectionName
            }) ?? `All ${selectedCount.toLocaleString()} ${collectionName} are selected.`);
    } else {
        message = t("selection_selected_count", {
            selected: (selectedCount ?? 0).toLocaleString()
        }) ?? `${selectedCount ?? 0} selected.`;
    }

    return (
        <div
            data-testid="selection-banner"
            className={cls(
                "flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 flex-shrink-0",
                "border-b border-hairline bg-surface-raised"
            )}>

            <Typography variant="body2" color="secondary">
                {message}
            </Typography>

            {offerSelectAll && <Button
                size="small"
                variant="text"
                onClick={() => selectAllMatching(query, collectionEntitiesCount)}>
                {collectionEntitiesCount === undefined
                    ? (t("selection_select_all_matching_unknown") ?? "Select every matching row")
                    : (t("selection_select_all_matching", {
                        total: collectionEntitiesCount.toLocaleString(),
                        collection: collectionName
                    }) ?? `Select all ${collectionEntitiesCount.toLocaleString()} ${collectionName}`)}
            </Button>}

            <Button
                size="small"
                variant="text"
                color="neutral"
                onClick={clearSelection}>
                {t("selection_clear") ?? "Clear selection"}
            </Button>
        </div>
    );
}
