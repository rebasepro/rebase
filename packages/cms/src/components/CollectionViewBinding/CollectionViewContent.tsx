import React from "react";
import type { CollectionCustomViewParams } from "@rebasepro/cms-types";
import { resolveComponentRef } from "@rebasepro/app";
import { cls, ErrorBoundary, Typography } from "@rebasepro/ui";
import { CollectionCardViewBinding } from "./CollectionCardViewBinding";
import { CollectionListViewBinding } from "./CollectionListViewBinding";
import { CollectionBoardViewBinding } from "./CollectionBoardViewBinding";
import { PluginAddColumnsContext, PluginHeaderActions, PluginHeaderActionsContext } from "./PluginColumnSlots";
import type { CollectionViewState } from "./useCollectionViewState";
import { EntityActionsScopeContext, renderCollectionEntityActions } from "./CollectionEntityActions";
import { EmptyImagePlaceContext } from "./usePreviewSlots";
import { CustomViewHost } from "./CustomViewHost";

/**
 * The view the collection is drawn in: a custom view, the board, the cards,
 * the list or the table — and, for the list, its titled reading surface.
 */
export function CollectionViewContent({ state }: { state: CollectionViewState }) {
    const {
        path,
        parentCollectionSlugs,
        parentEntityIds,
        collection,
        resolvedCollection,
        tableController,
        activeCustomView,
        viewMode,
        onEntityClick,
        onNewClick,
        canCreateEntities,
        usedSelectionController,
        selectionEnabled,
        highlightedEntities,
        deletedEntities,
        emptyComponent,
        customViewSize,
        selectedKanbanProperty,
        cardSize,
        listSize,
        tableSize,
        selectedEntityId,
        getActionsForEntity,
        openEntityMode,
        pluginAddColumnComponents,
        headerActionsScope,
        ResolvedCollectionTable,
        additionalFields,
        displayedColumnIds,
        onTableSizeChanged,
        onColumnResize,
        onValueChange,
        tableRowActionsBuilder,
        uniqueFieldValidator,
        getPropertyFor,
        hoverRow,
        inlineEditingEnabled,
        addColumnComponentInternal,
        getIdColumnWidth,
        idHeaderWidget,
        onColumnsOrderChange,
        pluginWidgets,
        viewCollection,
        entityActionsScope,
        title
    } = state;

    // A custom view wins over the built-in chain, but only after the
    // built-in keys have been ruled out — `resolveCollectionViews` refuses
    // a view keyed "table", so this cannot shadow one.
    const CustomViewBuilder = activeCustomView
        ? resolveComponentRef<CollectionCustomViewParams>(activeCustomView.Builder)
        : undefined;

    const innerView = CustomViewBuilder ? (
        <ErrorBoundary>
            <CustomViewHost
                key={`custom-view-${activeCustomView!.key}-${path}`}
                Builder={CustomViewBuilder}
                collection={collection}
                tableController={tableController}
                path={path}
                parentCollectionSlugs={parentCollectionSlugs}
                parentEntityIds={parentEntityIds}
                onEntityClick={onEntityClick}
                onNewClick={canCreateEntities ? onNewClick : undefined}
                canCreate={canCreateEntities}
                selectionController={usedSelectionController}
                selectionEnabled={selectionEnabled}
                highlightedEntities={highlightedEntities}
                deletedEntities={deletedEntities}
                emptyComponent={emptyComponent}
                size={activeCustomView!.sizeable ? customViewSize : undefined}
                viewMode={viewMode}
            />
        </ErrorBoundary>
    ) : viewMode === "kanban" ? (
        <CollectionBoardViewBinding
            key={`kanban-view-${path}-${selectedKanbanProperty}`}
            collection={collection}
            cardCollection={viewCollection !== collection ? viewCollection : undefined}
            renderActions={renderCollectionEntityActions}
            tableController={tableController}
            fullPath={path}
            parentCollectionSlugs={parentCollectionSlugs} parentEntityIds={parentEntityIds}
            columnProperty={selectedKanbanProperty}
            onEntityClick={onEntityClick}
            selectionController={usedSelectionController}
            selectionEnabled={selectionEnabled}
            highlightedEntities={highlightedEntities}
            deletedEntities={deletedEntities}
            emptyComponent={emptyComponent}
        />
    ) : viewMode === "cards" ? (
        <CollectionCardViewBinding
            key={`cards-view-${path}`}
            collection={viewCollection}
            renderActions={renderCollectionEntityActions}
            tableController={tableController}
            onEntityClick={onEntityClick}
            selectionController={usedSelectionController}
            selectionEnabled={selectionEnabled}
            highlightedEntities={highlightedEntities}
            onScroll={tableController.onScroll}
            initialScroll={tableController.initialScroll}
            size={cardSize}
            emptyComponent={emptyComponent}
        />
    ) : viewMode === "list" ? (
        <CollectionListViewBinding
            key={`list-view-${path}`}
            collection={viewCollection}
            tableController={tableController}
            onEntityClick={onEntityClick}
            selectionController={usedSelectionController}
            selectionEnabled={selectionEnabled}
            highlightedEntities={highlightedEntities}
            size={listSize}
            emptyComponent={emptyComponent}
            selectedEntityId={selectedEntityId}
            getActionsForEntity={getActionsForEntity}
            path={path}
            openEntityMode={openEntityMode}
        />
    ) : (
        <PluginAddColumnsContext.Provider value={pluginAddColumnComponents}>
            <PluginHeaderActionsContext.Provider value={headerActionsScope}>
                <ResolvedCollectionTable
                    key={`collection_table_${path}`}
                    hideToolbar={true}
                    additionalFields={additionalFields}
                    tableController={tableController}
                    fixedFilter={collection.fixedFilter}
                    enablePopupIcon={true}
                    displayedColumnIds={displayedColumnIds}
                    onSizeChanged={onTableSizeChanged}
                    onEntityClick={onEntityClick}
                    onColumnResize={onColumnResize}
                    onValueChange={onValueChange}
                    tableRowActionsBuilder={tableRowActionsBuilder}
                    uniqueFieldValidator={uniqueFieldValidator}
                    selectionController={usedSelectionController}
                    highlightedEntities={highlightedEntities}
                    defaultSize={tableSize}
                    properties={resolvedCollection.properties}
                    getPropertyFor={getPropertyFor}
                    onScroll={tableController.onScroll}
                    initialScroll={tableController.initialScroll}
                    emptyComponent={emptyComponent}
                    hoverRow={hoverRow}
                    inlineEditing={inlineEditingEnabled}
                    AdditionalHeaderWidget={PluginHeaderActions}
                    AddColumnComponent={addColumnComponentInternal}
                    getIdColumnWidth={getIdColumnWidth}
                    additionalIDHeaderWidget={idHeaderWidget}
                    openEntityMode={openEntityMode}
                    onColumnsOrderChange={onColumnsOrderChange}
                />
            </PluginHeaderActionsContext.Provider>
        </PluginAddColumnsContext.Provider>
    );

    // Given `fields`, the rows draw only the places those fill.
    const withActions = (
        <EntityActionsScopeContext.Provider value={entityActionsScope}>
            <EmptyImagePlaceContext.Provider value={viewCollection === collection}>
                {innerView}
            </EmptyImagePlaceContext.Provider>
        </EntityActionsScopeContext.Provider>
    );

    if (viewMode !== "list") return withActions;

    const detailOpen = selectedEntityId !== undefined;

    // List view gets a centered, titled reading surface. Opening a detail
    // panel collapses the title and drops the centering so the list can
    // shrink into the master column.
    return (
        <div
            className={cls(
                "flex flex-col w-full",
                detailOpen ? "" : "max-w-6xl mx-auto px-3 @3xl/collection:px-4 @5xl/collection:px-6 py-4"
            )}
        >
            {/* Collapsible title — grid-rows for smooth height, transform for GPU */}
            {title !== false && <div
                className={cls(
                    "grid transition-[grid-template-rows,transform,margin] duration-150 ease-out",
                    detailOpen
                        ? "grid-rows-[0fr] -translate-y-2 mt-0 mb-0"
                        : "grid-rows-[1fr] translate-y-0 mt-12 mb-6"
                )}
            >
                <div className="overflow-hidden flex items-center gap-4">
                    <Typography gutterBottom variant="h4" className="grow mb-0" component="h4">
                        {title ?? collection.name}
                    </Typography>
                </div>
            </div>}
            {pluginWidgets.length > 0 && (
                <div
                    className={cls(
                        "grid transition-[grid-template-rows] duration-150 ease-out",
                        detailOpen ? "grid-rows-[0fr]" : "grid-rows-[1fr]"
                    )}
                >
                    <div className="overflow-hidden flex-shrink-0">
                        {pluginWidgets}
                    </div>
                </div>
            )}
            {withActions}
        </div>
    );
}
