import React from "react";
import { getCollectionDataPath } from "@rebasepro/types";
import { useLargeLayout, useTranslation } from "@rebasepro/app";
import { SearchBar } from "@rebasepro/ui";
import { CollectionTableToolbar, useToolbarLabels } from "../CollectionTableBinding/internal/CollectionTableToolbar";
import { FiltersButton } from "./FiltersButton";
import { CollectionViewStartActions } from "./CollectionViewStartActions";
import { ViewModeToggle } from "./ViewModeToggle";
import { EMPTY_ARRAY } from "./PluginColumnSlots";
import { useCollectionViewScope } from "./CollectionViewScope";

/**
 * The view-mode switcher of the collection view it is drawn in, with the
 * size and kanban-column choices of the active view.
 *
 * @group Collection components
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
 * The search box of the collection view it is drawn in.
 *
 * @group Collection components
 */
export function CollectionSearchBar() {
    const { tableController } = useCollectionViewScope("CollectionSearchBar");
    const { t } = useTranslation();
    if (!tableController.setSearchString) return null;
    return (
        <SearchBar
            size={"small"}
            placeholder={t("search")}
            onTextSearch={tableController.setSearchString}
            expandable={true}
            initialValue={tableController.searchString}/>
    );
}

/**
 * The filters button of the collection view it is drawn in, with the count
 * of filters set, and the dialog it opens.
 *
 * @group Collection components
 */
export function CollectionFiltersButton() {
    const { tableController, resolvedCollection, collection, isCompact } = useCollectionViewScope("CollectionFiltersButton");
    const largeLayout = useLargeLayout();
    const toolbarLabels = useToolbarLabels();
    return (
        <FiltersButton
            tableController={tableController}
            properties={resolvedCollection.properties}
            fixedFilter={collection.fixedFilter}
            iconOnly={!largeLayout || isCompact || !toolbarLabels}/>
    );
}

/**
 * @group Collection components
 */
export type CollectionToolbarProps = {
    /**
     * The leading group. With neither `start` nor `end`, the toolbar draws
     * its full set of pieces.
     */
    start?: React.ReactNode;
    /** The trailing group. */
    end?: React.ReactNode;
};

/**
 * The toolbar of the collection view it is drawn in — the default
 * `toolbar` of a `CollectionPanel`.
 *
 * Without props: the view-mode switcher, selection, filters, sort and count
 * on the left; search, the `Collection.Actions` override with the
 * `collection.toolbar` and `collection.actions` contributions, and the add
 * button on the right. With `start` or `end`: the same bar, holding only
 * those — compose them from `CollectionViewModeToggle`,
 * `CollectionFiltersButton`, `CollectionSearchBar` and `CollectionAddButton`.
 *
 * @group Collection components
 */
export function CollectionToolbar({ start, end }: CollectionToolbarProps) {
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

    if (start !== undefined || end !== undefined) {
        return (
            <CollectionTableToolbar
                loading={tableController.dataLoading}
                actionsStart={start}
                actions={end}/>
        );
    }

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

/** The default toolbar, as the element a view draws when it is given none. */
export const DEFAULT_TOOLBAR = <CollectionToolbar/>;

/** The toolbar a view was given: the default, a composition, or `null`. */
export const CollectionToolbarSlotContext = React.createContext<React.ReactNode>(DEFAULT_TOOLBAR);

/**
 * Draws the view's toolbar. One element for the life of the view, so the
 * toolbar keeps its place in the tree — and the view-mode popover stays open —
 * whichever view is shown below it.
 */
export function CollectionToolbarSlot() {
    return <>{React.useContext(CollectionToolbarSlotContext)}</>;
}
