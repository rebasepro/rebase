
import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { deepEqual as equal } from "fast-equals";
import { Entity } from "@rebasepro/types";
import { CollectionSize, EntityTableController, SelectionController, AdminCollection } from "@rebasepro/cms-types";
import { EntityCardBinding, EntityCardBindingProps } from "./EntityCardBinding";
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

    // Memoised, so a page, a push or a tick draws the cards that changed. The
    // grid draws every loaded card, and drew every one again on each update:
    // the 41st page of 50 cards cost 4,050 card renders.
    const MemoisedCard = useMemo(
        () => React.memo(ResolvedEntityCard, areCardPropsEqual) as unknown as typeof EntityCardBinding,
        [ResolvedEntityCard]);

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

    // The handlers every card gets are the same two functions for the life of
    // the grid, reading what they need when they are called. One per card per
    // render — what `CardView` hands `renderCard` — would draw every card on
    // every update. The selection controller is a new object with each
    // selection, so it is read through the ref as well.
    const latest = useRef({ onEntityClick, selectionController, selectionEnabled });
    latest.current = { onEntityClick, selectionController, selectionEnabled };

    const handleSelectionChange = useCallback((entity: Entity<M>, selected: boolean) => {
        latest.current.selectionController?.toggleEntitySelection(entity, selected);
    }, []);

    /**
     * A card was clicked: a modifier click ticks it, any other opens it — what
     * the grid's own per-card handler does, for a `Collection.Card` override
     * that does not handle the modifier itself.
     */
    const handleCardClick = useCallback((entity: Entity<M>, event?: React.MouseEvent) => {
        const { onEntityClick, selectionController, selectionEnabled } = latest.current;
        if (event && (event.metaKey || event.ctrlKey) && selectionEnabled) {
            event.preventDefault();
            selectionController?.toggleEntitySelection(entity, !selectionController.isEntitySelected(entity));
            return;
        }
        onEntityClick?.(entity);
    }, []);

    // Built from the rows on screen rather than from a list of the selected:
    // in query mode there is no such list, and this Set only ever describes
    // which visible rows draw a ticked checkbox.
    const selectedIds = useMemo(
        () => new Set<string | number>(data.filter(e => selectionController?.isEntitySelected(e)).map(e => e.id)),
        [data, selectionController]
    );
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
            renderCard={useCallback((entity, { selected, highlighted }) => (
                <MemoisedCard
                    key={`${entity.path}_${entity.id}`}
                    entity={entity}
                    collection={collection}
                    searchString={tableController.searchString}
                    onClick={handleCardClick}
                    selected={selected}
                    highlighted={highlighted}
                    onSelectionChange={handleRowSelectionChange}
                    selectionEnabled={selectionEnabled}
                    size={size}
                />
            ), [collection, selectionEnabled, size, handleRowSelectionChange, handleCardClick, MemoisedCard, tableController.searchString])}
        />
    );
}

/**
 * Every prop by reference, except the row: a realtime frame decodes into new
 * row objects whether or not anything in them changed, so the row is compared
 * by value — the same row (id and path) with equal values draws the same card.
 */
function areCardPropsEqual<M extends Record<string, unknown>>(
    a: EntityCardBindingProps<M>,
    b: EntityCardBindingProps<M>
): boolean {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof EntityCardBindingProps<M>>;
    for (const key of keys) {
        if (key === "entity") continue;
        if (a[key] !== b[key]) return false;
    }
    return a.entity === b.entity || (
        a.entity.id === b.entity.id &&
        a.entity.path === b.entity.path &&
        equal(a.entity.values, b.entity.values)
    );
}
