
import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { Entity } from "@rebasepro/types";
import { CollectionSize, EntityTableController, SelectionController, AdminCollection } from "@rebasepro/admin-types";
import { EntityCardBinding } from "./EntityCardBinding";
import {
    cls,
    CircularProgress,
    Typography,
    CardView
} from "@rebasepro/ui";
import { useComponentOverride } from "@rebasepro/app";

export type CollectionCardViewBindingProps<M extends Record<string, unknown> = Record<string, unknown>> = {
    collection: AdminCollection<M>;
    tableController: EntityTableController<M>;
    onEntityClick?: (entity: Entity<M>) => void;
    selectionController?: SelectionController<M>;
    selectionEnabled?: boolean;
    highlightedEntities?: Entity<M>[];
    emptyComponent?: React.ReactNode;
    onScroll?: (props: {
        scrollDirection: "forward" | "backward";
        scrollOffset: number;
        scrollUpdateWasRequested: boolean;
    }) => void;
    initialScroll?: number;
    /**
     * Size of the cards in the grid view.
     * - "xs": Extra small cards, most cards per row
     * - "s": Small cards
     * - "m": Medium cards (default)
     * - "l": Large cards
     * - "xl": Extra large cards, fewest cards per row
     */
    size?: CollectionSize;
};

/**
 * Get grid column classes based on the size.
 * Smaller size = more columns (smaller cards)
 * Larger size = fewer columns (larger cards)
 */
function getGridColumnsClass(size: CollectionSize): string {
    switch (size) {
        case "xs":
            // Compact: many small cards
            return "grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10";
        case "s":
            // Small: more cards per row
            return "grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8";
        case "m":
            // Medium: balanced (default)
            return "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6";
        case "l":
            // Large: fewer, bigger cards
            return "grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4";
        case "xl":
            // Extra large: fewest, biggest cards
            return "grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3";
        default:
            return "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6";
    }
}

function getScrollParent(element: HTMLElement | null): HTMLElement | null {
    if (!element) return null;
    let parent = element.parentElement;
    while (parent) {
        const overflowY = window.getComputedStyle(parent).overflowY;
        if (overflowY === "auto" || overflowY === "scroll") {
            return parent;
        }
        parent = parent.parentElement;
    }
    return document.documentElement;
}

/**
 * Card grid view for displaying entities with infinite scroll.
 * Alternative to the CollectionTableBinding for visual browsing.
 */
export function CollectionCardViewBinding<M extends Record<string, unknown> = Record<string, unknown>>({
    collection,
    tableController,
    onEntityClick,
    selectionController,
    selectionEnabled = true,
    highlightedEntities,
    emptyComponent,
    onScroll,
    initialScroll,
    size = "m"
}: CollectionCardViewBindingProps<M>) {

    const ResolvedEntityCard = useComponentOverride("Collection.Card", EntityCardBinding) as typeof EntityCardBinding;

    const {
        data,
        dataLoading,
        noMoreToLoad,
        dataLoadingError,
        itemCount,
        setItemCount,
        pageSize = 50,
        paginationEnabled
    } = tableController;

    const handleEntityClick = useCallback((entity: Entity<M>) => {
        onEntityClick?.(entity);
    }, [onEntityClick]);

    const handleSelectionChange = useCallback((entity: Entity<M>, selected: boolean) => {
        selectionController?.toggleEntitySelection(entity, selected);
    }, [selectionController]);

    const selectedIds = useMemo(() => new Set(selectionController?.selectedEntities.map(e => e.id)), [selectionController?.selectedEntities]);
    const highlightedIds = useMemo(() => new Set(highlightedEntities?.map(e => e.id)), [highlightedEntities]);

    const handleRowSelectionChange = useCallback((entity: Entity<M>, selected: boolean) => {
        handleSelectionChange(entity, selected);
    }, [handleSelectionChange]);

    return (
        <CardView<Entity<M>>
            data={data}
            dataLoading={dataLoading}
            noMoreToLoad={noMoreToLoad}
            dataLoadingError={dataLoadingError}
            itemCount={itemCount}
            setItemCount={setItemCount}
            pageSize={pageSize}
            paginationEnabled={paginationEnabled}
            onItemClick={handleEntityClick}
            selectedIds={selectedIds}
            highlightedIds={highlightedIds}
            selectionEnabled={selectionEnabled}
            onSelectionChange={handleRowSelectionChange}
            onScroll={onScroll}
            initialScroll={initialScroll}
            size={size}
            emptyComponent={emptyComponent}
            renderCard={useCallback((entity, { selected, highlighted, onClick }) => (
                <ResolvedEntityCard
                    key={`${entity.path}_${entity.id}`}
                    entity={entity}
                    collection={collection}
                    searchString={tableController.searchString}
                    onClick={onClick as any}
                    selected={selected}
                    highlighted={highlighted}
                    onSelectionChange={handleRowSelectionChange}
                    selectionEnabled={selectionEnabled}
                    size={size}
                />
            ), [collection, selectionEnabled, size, handleRowSelectionChange, ResolvedEntityCard])}
        />
    );
}
