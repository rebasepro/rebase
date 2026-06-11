import type { EntityCollection } from "@rebasepro/types";
import React, { useCallback, useEffect, useRef } from "react";
import { CollectionSize, Entity, EntityTableController, SelectionController } from "@rebasepro/types";
import { EntityCard } from "./EntityCard";
import {
    cls,
    CircularProgress,
    Typography
} from "@rebasepro/ui";

export type EntityCollectionCardViewProps<M extends Record<string, unknown> = Record<string, unknown>> = {
    collection: EntityCollection<M>;
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
 * Alternative to the EntityCollectionTable for visual browsing.
 */
export function EntityCollectionCardView<M extends Record<string, unknown> = Record<string, unknown>>({
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
}: EntityCollectionCardViewProps<M>) {

    const containerRef = useRef<HTMLDivElement>(null);
    const hasRestoredScroll = useRef(false);

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

    // Track if we're currently loading to prevent multiple simultaneous load requests
    const isLoadingMore = useRef(false);

    // Keep mutable refs for values used in the scroll listener callback
    // to avoid re-attaching the listener every time pagination state changes.
    const paginationStateRef = useRef({ paginationEnabled, noMoreToLoad, dataLoading, itemCount, pageSize });
    useEffect(() => {
        paginationStateRef.current = { paginationEnabled, noMoreToLoad, dataLoading, itemCount, pageSize };
    }, [paginationEnabled, noMoreToLoad, dataLoading, itemCount, pageSize]);

    // Reset loading flag when new data arrives (separate effect, like list view)
    useEffect(() => {
        if (!dataLoading) isLoadingMore.current = false;
    }, [dataLoading]);

    // Infinite scroll and resize observer
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const scrollEl = getScrollParent(el);
        if (!scrollEl) return;

        let rafId: number | null = null;

        const update = () => {
            rafId = null;

            // Infinite scroll: trigger load-more when near the bottom
            const { paginationEnabled: pe, noMoreToLoad: nm, itemCount: ic, pageSize: ps } = paginationStateRef.current;
            if (
                pe &&
                !nm &&
                !isLoadingMore.current &&
                scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 400
            ) {
                isLoadingMore.current = true;
                setItemCount?.((ic ?? ps) + ps);
            }
        };

        const onScrollEvent = () => {
            if (rafId === null) rafId = requestAnimationFrame(update);
        };

        scrollEl.addEventListener("scroll", onScrollEvent, { passive: true });
        const ro = new ResizeObserver(() => update());
        ro.observe(scrollEl);
        update(); // initial measurement

        return () => {
            scrollEl.removeEventListener("scroll", onScrollEvent);
            ro.disconnect();
            if (rafId !== null) cancelAnimationFrame(rafId);
        };
    }, [setItemCount]);

    // Scroll restoration — deferred to after layout paint
    useEffect(() => {
        if (!containerRef.current || !initialScroll || hasRestoredScroll.current || data.length === 0) return;

        const scrollEl = getScrollParent(containerRef.current);
        if (!scrollEl) return;

        let attempts = 0;
        const maxAttempts = 5;

        const tryRestore = () => {
            if (scrollEl.scrollHeight >= initialScroll || attempts >= maxAttempts) {
                scrollEl.scrollTop = initialScroll;
                hasRestoredScroll.current = true;
            } else {
                attempts++;
                requestAnimationFrame(tryRestore);
            }
        };

        requestAnimationFrame(tryRestore);
    }, [initialScroll, data.length]);

    // Scroll tracking: call onScroll when user scrolls
    const lastScrollOffset = useRef(0);
    useEffect(() => {
        const el = containerRef.current;
        if (!el || !onScroll) return;
        const scrollEl = getScrollParent(el);
        if (!scrollEl) return;

        const handleScroll = () => {
            const currentOffset = scrollEl.scrollTop;
            const direction = currentOffset > lastScrollOffset.current ? "forward" : "backward";
            lastScrollOffset.current = currentOffset;
            onScroll({
                scrollDirection: direction,
                scrollOffset: currentOffset,
                scrollUpdateWasRequested: false
            });
        };

        scrollEl.addEventListener("scroll", handleScroll, { passive: true });
        return () => scrollEl.removeEventListener("scroll", handleScroll);
    }, [onScroll]);

    const handleEntityClick = useCallback((entity: Entity<M>) => {
        onEntityClick?.(entity);
    }, [onEntityClick]);

    const handleSelectionChange = useCallback((entity: Entity<M>, selected: boolean) => {
        selectionController?.toggleEntitySelection(entity, selected);
    }, [selectionController]);

    const isEntitySelected = useCallback((entity: Entity<M>) => {
        return selectionController?.isEntitySelected(entity) ?? false;
    }, [selectionController]);

    const isEntityHighlighted = useCallback((entity: Entity<M>) => {
        return highlightedEntities?.some(e => e.id === entity.id && e.path === entity.path) ?? false;
    }, [highlightedEntities]);

    const gridColumnsClass = getGridColumnsClass(size);

    // Initial loading state (no data yet)
    const isInitialLoading = dataLoading && data.length === 0 && !dataLoadingError;
    // Empty state
    const isEmpty = !dataLoading && data.length === 0 && !dataLoadingError;

    return (
        <div
            ref={containerRef}
            className="w-full p-4"
        >
            {/* Error state */}
            {dataLoadingError ? (
                <div className="h-full flex items-center justify-center p-8">
                    <Typography className="text-red-500">
                        Error loading data: {dataLoadingError.message}
                    </Typography>
                </div>
            ) : isInitialLoading ? (
                <div className="flex items-center justify-center py-12 px-8">
                    <CircularProgress size="small"/>
                </div>
            ) : isEmpty ? (
                <div className="w-full flex items-center justify-center py-12 px-8">
                    {emptyComponent ?? (
                        <Typography variant="label" color="secondary">
                            No entries found
                        </Typography>
                    )}
                </div>
            ) : (
                <>
                    {/* Card Grid with max-width container */}
                    <div className="max-w-7xl mx-auto">
                        <div className={cls(
                            "grid gap-4",
                            gridColumnsClass
                        )}>
                            {data.map((entity) => (
                                <EntityCard
                                    key={`${entity.path}_${entity.id}`}
                                    entity={entity}
                                    collection={collection}
                                    onClick={handleEntityClick}
                                    selected={isEntitySelected(entity)}
                                    highlighted={isEntityHighlighted(entity)}
                                    onSelectionChange={handleSelectionChange}
                                    selectionEnabled={selectionEnabled}
                                    size={size}
                                />
                            ))}
                        </div>

                        {/* Load more trigger / Loading indicator */}
                        <div
                            className="flex items-center justify-center py-8"
                        >
                            {dataLoading && (
                                <CircularProgress size="small"/>
                            )}
                            {!dataLoading && noMoreToLoad && data.length > 0 && (
                                <Typography variant="caption" color="secondary">
                                    All {data.length} entries loaded
                                </Typography>
                            )}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
