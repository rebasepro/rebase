import React from "react";
import { getCollectionDataPath } from "@rebasepro/types";
import { CollectionTableToolbar } from "../CollectionTableBinding/internal/CollectionTableToolbar";
import { CollectionViewStartActions } from "./CollectionViewStartActions";
import { ViewModeToggle } from "./ViewModeToggle";
import { EMPTY_ARRAY } from "./PluginColumnSlots";
import { useCollectionViewScope } from "./CollectionViewScope";

/**
 * The view-mode switcher of the collection view it is drawn in, with the
 * size and kanban-column choices of the active view.
 */
export function CollectionViewModeToggle() {
    const scope = useCollectionViewScope("CollectionViewModeToggle");
    const {
        viewMode,
        onViewModeChange,
        enabledViews,
        resolvedCustomViews,
        activeCustomView,
        customViewSize,
        setCustomViewSize,
        listSize,
        tableSize,
        cardSize,
        setCardSize,
        onListSizeChanged,
        onTableSizeChanged,
        viewModePopoverOpen,
        setViewModePopoverOpen,
        kanbanPropertyOptions,
        selectedKanbanProperty,
        onKanbanPropertyChange
    } = scope;
    return (
        <ViewModeToggle
            viewMode={viewMode}
            onViewModeChange={onViewModeChange}
            enabledViews={enabledViews}
            customViews={resolvedCustomViews}
            size={activeCustomView ? (activeCustomView.sizeable ? customViewSize : undefined) : viewMode === "list" ? listSize : viewMode === "table" ? tableSize : viewMode === "cards" ? cardSize : undefined}
            onSizeChanged={activeCustomView ? (activeCustomView.sizeable ? setCustomViewSize : undefined) : viewMode === "list" ? onListSizeChanged : viewMode === "table" ? onTableSizeChanged : viewMode === "cards" ? setCardSize : undefined}
            open={viewModePopoverOpen}
            onOpenChange={setViewModePopoverOpen}
            kanbanPropertyOptions={kanbanPropertyOptions}
            selectedKanbanProperty={selectedKanbanProperty}
            onKanbanPropertyChange={onKanbanPropertyChange}
        />
    );
}

/**
 * The toolbar of the collection view it is drawn in: the view-mode switcher,
 * selection, filters, sort and count on the left; search, the
 * `Collection.Actions` override with the `collection.toolbar` and
 * `collection.actions` contributions, and the add button on the right.
 */
export function CollectionToolbar() {
    const scope = useCollectionViewScope("CollectionToolbar");
    const {
        collection,
        path,
        parentCollectionSlugs,
        parentEntityIds,
        tableController,
        usedSelectionController,
        resolvedCollection,
        viewMode,
        isCompact,
        activeSelectionEnabled,
        liveSelectionQuery,
        docsCount,
        openNewDocument,
        onNewClick,
        onMultipleDeleteClick,
        isLinkedChildView,
        linkedTargetSlug,
        selectionDialog,
        pluginToolbarWidgets,
        ResolvedCollectionActions
    } = scope;

    return (
        <CollectionTableToolbar
            compact={isCompact}
            loading={tableController.dataLoading}
            onTextSearch={tableController.setSearchString}
            initialSearchText={tableController.searchString}
            viewModeToggle={<CollectionViewModeToggle/>}
            actionsStart={<CollectionViewStartActions
                parentCollectionSlugs={parentCollectionSlugs ?? EMPTY_ARRAY} parentEntityIds={parentEntityIds ?? EMPTY_ARRAY}
                collection={collection}
                tableController={tableController}
                path={path}
                relativePath={getCollectionDataPath(collection)}
                selectionController={usedSelectionController}
                collectionEntitiesCount={docsCount ?? undefined}
                resolvedProperties={resolvedCollection.properties}
                viewMode={viewMode}
                selectionEnabled={activeSelectionEnabled}
                selectionQuery={liveSelectionQuery}
                entitiesCount={docsCount}
                openNewDocument={openNewDocument}
                compact={isCompact}/>}
            actions={
                <ResolvedCollectionActions
                    parentCollectionSlugs={parentCollectionSlugs ?? EMPTY_ARRAY} parentEntityIds={parentEntityIds ?? EMPTY_ARRAY}
                    collection={collection}
                    tableController={tableController}
                    onMultipleDeleteClick={onMultipleDeleteClick}
                    removeUnlinks={isLinkedChildView}
                    onNewClick={onNewClick}
                    onAddExistingClick={linkedTargetSlug ? selectionDialog.open : undefined}
                    openNewDocument={openNewDocument}
                    path={path}
                    relativePath={getCollectionDataPath(collection)}
                    selectionController={usedSelectionController}
                    selectionEnabled={activeSelectionEnabled}
                    collectionEntitiesCount={docsCount ?? undefined}
                    compact={isCompact}
                >
                    {pluginToolbarWidgets}
                </ResolvedCollectionActions>
            }
        />
    );
}
