import type { Properties } from "@rebasepro/types";
import type { EntityCollection } from "@rebasepro/types";
import React, { useState, useCallback } from "react";
import { useAuthController, useLargeLayout, useTranslation, useSlot } from "@rebasepro/core";
import { CollectionActionsProps, EntityTableController, SelectionController } from "@rebasepro/types";
import { ErrorBoundary , iconSize } from "@rebasepro/ui";
import { ArrowLeftIcon, FilterIcon } from "lucide-react";
import { ClearFilterSortButton } from "../ClearFilterSortButton";
import { FiltersDialog } from "./FiltersDialog";
import { Badge, Button, cls, IconButton, Tooltip } from "@rebasepro/ui";
import { toArray } from "@rebasepro/utils";
import { useNavigate } from "react-router-dom";
import { useUrlController, useCMSContext } from "../../index";

export type EntityCollectionViewStartActionsProps<M extends Record<string, unknown>> = {
    collection: EntityCollection<M>;
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

export function EntityCollectionViewStartActions<M extends Record<string, unknown>>({
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
}: EntityCollectionViewStartActionsProps<M>) {

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
        parentCollectionSlugs, parentEntityIds,
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

    // Filters button
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
                        {t("filters")}{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
                    </Button>
                ) : (
                    <IconButton
                        size="small"
                        onClick={() => setFiltersDialogOpen(true)}
                        className={cls(activeFilterCount > 0 && "text-primary")}
                    >
                        <FilterIcon size={iconSize.small}/>
                    </IconButton>
                )}
            </Badge>
        </Tooltip>
    );

    const actions: React.ReactNode[] = [
        backButton,
        filtersButton,
        <ClearFilterSortButton
            key={"clear_filter"}
            tableController={tableController}
            enabled={!collection.fixedFilter}/>
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

