import type { Properties } from "@rebasepro/types";

import React, { useState, useCallback } from "react";
import { useAuthController, useLargeLayout, useTranslation, useSlot } from "@rebasepro/app";
import { CollectionActionsProps, EntityTableController, SelectionController, AdminCollection } from "@rebasepro/admin-types";
import { ErrorBoundary, iconSize } from "@rebasepro/ui";
import { Badge, Button, cls, FilterIcon, IconButton, Tooltip, XIcon } from "@rebasepro/ui";
import { ClearFilterSortButton } from "../ClearFilterSortButton";
import { FiltersDialog } from "./FiltersDialog";
import { FilterPresetsButton } from "./FilterPresetsButton";
import { toArray } from "@rebasepro/utils";
import { useNavigate } from "react-router";
import { useUrlController } from "../../hooks/navigation/contexts/UrlContext";
import { useAdminContext } from "../../hooks/useAdminContext";
import { withViewMode } from "../../util/view_mode";
import { useSplitView } from "./SplitViewContext";

export type CollectionViewStartActionsProps<M extends Record<string, unknown>> = {
    collection: AdminCollection<M>;
    path: string;
    relativePath: string;
    parentCollectionSlugs: string[], parentEntityIds: string[];
    selectionController: SelectionController<M>;
    tableController: EntityTableController<M>;
    collectionEntitiesCount?: number;
    /**
     * Resolved properties from the collection for the filters dialog
     */
    resolvedProperties?: Properties;
    compact?: boolean;
    openNewDocument: (defaultValues?: Record<string, unknown>) => void;
}

export function CollectionViewStartActions<M extends Record<string, unknown>>({
    collection,
    relativePath,
    parentCollectionSlugs, parentEntityIds,
    path,
    selectionController,
    tableController,
    collectionEntitiesCount,
    resolvedProperties,
    compact,
    openNewDocument
}: CollectionViewStartActionsProps<M>) {

    const context = useAdminContext();
    const largeLayout = useLargeLayout();
    const { t } = useTranslation();

    const navigate = useNavigate();
    const urlController = useUrlController();
    const splitView = useSplitView();

    // Filters dialog state
    const [filtersDialogOpen, setFiltersDialogOpen] = useState(false);

    // Count active filters (excluding force filters)
    const filterValues = tableController.filterValues;
    const fixedFilter = collection.fixedFilter;
    const activeFilterCount = filterValues
        ? Object.keys(filterValues).filter(key => !fixedFilter || !(key in fixedFilter)).length
        : 0;

    const actionProps: CollectionActionsProps<M> = {
        path,
        relativePath,
        parentCollectionSlugs,
parentEntityIds,
        collection,
        selectionController,
        context,
        tableController,
        collectionEntitiesCount,
        openNewDocument
    };

    const handleBackClick = useCallback(() => {
        navigate(withViewMode(urlController.buildUrlCollectionPath(path)));
    }, [navigate, urlController, path]);

    // In a split view the control that closes the list lives at the leading
    // edge of the record's app bar (`SplitListCloseButton`), not here.
    //
    // Outside one — a compact list with no record open beside it — the only
    // thing this can mean is "leave the record behind".
    const backButton = compact && !splitView?.detailOpen && (
        <Tooltip title={t("close")} key={"close_tooltip"}>
            <IconButton
                size="small"
                onClick={handleBackClick}
                aria-label={t("close")}
                className="mr-1"
            >
                <XIcon size={iconSize.smallest}/>
            </IconButton>
        </Tooltip>
    );

    const filtersButton = resolvedProperties && tableController.setFilterValues && (
        <Tooltip title={t("filters")}
            key={"filters_tooltip"}>
            <Badge
                color="primary"
                invisible={activeFilterCount === 0}
            >
                {largeLayout && !compact ? (
                    <Button
                        variant="text"
                        size="small"
                        onClick={() => setFiltersDialogOpen(true)}
                        startIcon={<FilterIcon size={iconSize.small}/>}
                        className={cls(activeFilterCount > 0 && "text-primary")}
                    >
                        {activeFilterCount > 0 ? `(${activeFilterCount})` : t("filters")}
                    </Button>
                ) : (
                    <IconButton
                        size={"small"}
                        onClick={() => setFiltersDialogOpen(true)}
                        className={cls(activeFilterCount > 0 && "text-primary")}
                    >
                        <FilterIcon size={iconSize.smallest}/>
                    </IconButton>
                )}
            </Badge>
        </Tooltip>
    );

    // Not in the split view. The toolbar there is a strip a few hundred pixels
    // wide above the list, and a row of preset chips crowded out the controls
    // that act on what you are looking at. The presets are still one click away
    // inside the filters dialog.
    const filterPresetsButton = !compact && collection.filterPresets?.length ? (
        <FilterPresetsButton
            key={"filter_presets"}
            filterPresets={collection.filterPresets}
            tableController={tableController}
            compact={compact}
        />
    ) : null;

    const actions: React.ReactNode[] = [
        backButton,
        filtersButton,
        <ClearFilterSortButton
            key={"clear_filter"}
            tableController={tableController}
            enabled={!collection.fixedFilter}/>,
        filterPresetsButton
    ];

    const pluginActionsStart = useSlot("collection.actions.start", actionProps);

    return (
        <>
            {actions}
            {pluginActionsStart}

            {/* Filters Dialog */}
            {resolvedProperties && tableController.setFilterValues && (
                <FiltersDialog
                    open={filtersDialogOpen}
                    onOpenChange={setFiltersDialogOpen}
                    properties={resolvedProperties}
                    filterValues={tableController.filterValues}
                    setFilterValues={(filterValues) => tableController.setFilterValues?.(filterValues ?? {})}
                    fixedFilter={collection.fixedFilter}
                />
            )}
        </>
    );
}

