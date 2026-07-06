import type { Properties } from "@rebasepro/types";
import type { CollectionConfig } from "@rebasepro/types";
import React, { useState, useCallback } from "react";
import { useAuthController, useLargeLayout, useTranslation, useSlot } from "@rebasepro/core";
import { CollectionActionsProps, EntityTableController, SelectionController } from "@rebasepro/types";
import { ErrorBoundary, iconSize } from "@rebasepro/ui";
import { ArrowLeftIcon, Badge, Button, cls, FilterIcon, IconButton, Tooltip } from "@rebasepro/ui";
import { ClearFilterSortButton } from "../ClearFilterSortButton";
import { FiltersDialog } from "./FiltersDialog";
import { FilterPresetsButton } from "./FilterPresetsButton";
import { toArray } from "@rebasepro/utils";
import { useNavigate } from "react-router-dom";
import { useUrlController, useCMSContext } from "../../index";

export type CollectionViewStartActionsProps<M extends Record<string, unknown>> = {
    collection: CollectionConfig<M>;
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

    const context = useCMSContext();
    const largeLayout = useLargeLayout();
    const { t } = useTranslation();

    const navigate = useNavigate();
    const urlController = useUrlController();

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
        let collectionUrl = urlController.buildUrlCollectionPath(path);
        // Preserve the __view query param so the view mode is retained
        const currentViewParam = new URLSearchParams(window.location.search).get("__view");
        if (currentViewParam) {
            collectionUrl += `${collectionUrl.includes("?") ? "&" : "?"}__view=${currentViewParam}`;
        }
        navigate(collectionUrl);
    }, [navigate, urlController, path]);

    const backButton = compact && (
        <Tooltip title={t("back")} key={"back_tooltip"}>
            <IconButton
                size="small"
                onClick={handleBackClick}
                className="mr-1"
            >
                <ArrowLeftIcon size={iconSize.small}/>
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
                    <Button
                        variant="text"
                        size="small"
                        onClick={() => setFiltersDialogOpen(true)}
                        className={cls(activeFilterCount > 0 && "text-primary")}
                    >
                        <FilterIcon size={iconSize.small}/>
                    </Button>
                )}
            </Badge>
        </Tooltip>
    );

    const filterPresetsButton = collection.filterPresets?.length ? (
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

