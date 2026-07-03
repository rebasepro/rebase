import type { SnapshotCollection } from "@rebasepro/types";
import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { CollectionSize, Snapshot, SnapshotTableController, SelectionController } from "@rebasepro/types";
import { SnapshotCard } from "./SnapshotCard";
import {
    cls,
    CircularProgress,
    Typography,
    CardView
} from "@rebasepro/ui";
import { useComponentOverride } from "@rebasepro/core";

export type SnapshotCollectionCardViewProps<M extends Record<string, unknown> = Record<string, unknown>> = {
    collection: SnapshotCollection<M>;
    tableController: SnapshotTableController<M>;
    onSnapshotClick?: (snapshot: Snapshot<M>) => void;
    selectionController?: SelectionController<M>;
    selectionEnabled?: boolean;
    highlightedSnapshots?: Snapshot<M>[];
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
 * Card grid view for displaying snapshots with infinite scroll.
 * Alternative to the SnapshotCollectionTable for visual browsing.
 */
export function SnapshotCollectionCardView<M extends Record<string, unknown> = Record<string, unknown>>({
    collection,
    tableController,
    onSnapshotClick,
    selectionController,
    selectionEnabled = true,
    highlightedSnapshots,
    emptyComponent,
    onScroll,
    initialScroll,
    size = "m"
}: SnapshotCollectionCardViewProps<M>) {

    const ResolvedSnapshotCard = useComponentOverride("Collection.Card", SnapshotCard) as typeof SnapshotCard;

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

    const handleSnapshotClick = useCallback((snapshot: Snapshot<M>) => {
        onSnapshotClick?.(snapshot);
    }, [onSnapshotClick]);

    const handleSelectionChange = useCallback((snapshot: Snapshot<M>, selected: boolean) => {
        selectionController?.toggleSnapshotSelection(snapshot, selected);
    }, [selectionController]);

    const selectedIds = useMemo(() => new Set(selectionController?.selectedSnapshots.map(e => e.id)), [selectionController?.selectedSnapshots]);
    const highlightedIds = useMemo(() => new Set(highlightedSnapshots?.map(e => e.id)), [highlightedSnapshots]);

    const handleRowSelectionChange = useCallback((snapshot: Snapshot<M>, selected: boolean) => {
        handleSelectionChange(snapshot, selected);
    }, [handleSelectionChange]);

    return (
        <CardView<Snapshot<M>>
            data={data}
            dataLoading={dataLoading}
            noMoreToLoad={noMoreToLoad}
            dataLoadingError={dataLoadingError}
            itemCount={itemCount}
            setItemCount={setItemCount}
            pageSize={pageSize}
            paginationEnabled={paginationEnabled}
            onItemClick={handleSnapshotClick}
            selectedIds={selectedIds}
            highlightedIds={highlightedIds}
            selectionEnabled={selectionEnabled}
            onSelectionChange={handleRowSelectionChange}
            onScroll={onScroll}
            initialScroll={initialScroll}
            size={size}
            emptyComponent={emptyComponent}
            renderCard={useCallback((snapshot, { selected, highlighted, onClick }) => (
                <ResolvedSnapshotCard
                    key={`${snapshot.path}_${snapshot.id}`}
                    snapshot={snapshot}
                    collection={collection}
                    onClick={onClick as any}
                    selected={selected}
                    highlighted={highlighted}
                    onSelectionChange={handleRowSelectionChange}
                    selectionEnabled={selectionEnabled}
                    size={size}
                />
            ), [collection, selectionEnabled, size, handleRowSelectionChange, ResolvedSnapshotCard])}
        />
    );
}
