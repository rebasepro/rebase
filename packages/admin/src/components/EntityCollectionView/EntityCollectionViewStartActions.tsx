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
    parentCollectionIds: string[];
    selectionController: SelectionController<M>;
    tableController: EntityTableController<M>;
    collectionEntitiesCount?: number;
    /**
     * Resolved properties from the collection for the filters dialog
     */
    resolvedProperties?: Properties;
    compact?: boolean;
}

export function EntityCollectionViewStartActions<M extends Record<string, unknown>>({
    collection,
    relativePath,
    parentCollectionIds,
    path,
    selectionController,
    tableController,
    collectionEntitiesCount,
    resolvedProperties,
    compact
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
    const forceFilter = collection.forceFilter;
    const activeFilterCount = filterValues
        ? Object.keys(filterValues).filter(key => !forceFilter || !(key in forceFilter)).length
        : 0;

    const actionProps: CollectionActionsProps<M> = {
        path,
        relativePath,
        parentCollectionIds,
        collection,
        selectionController,
        context,
        tableController,
        collectionEntitiesCount
    };

    const handleBackClick = useCallback(() => {
        const collectionUrl = urlController.buildUrlCollectionPath(path);
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
            enabled={!collection.forceFilter}/>
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
                    forceFilter={collection.forceFilter}
                />
            )}
        </>
    );
}

