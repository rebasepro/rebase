import React, { useCallback, useEffect, useRef } from "react";
import {
    CircularProgress,
    Typography
} from "../components";
import { cls } from "../util";

import { CollectionSize } from "./ListView";

export type CardViewProps<T> = {
    data: T[];
    dataLoading?: boolean;
    noMoreToLoad?: boolean;
    dataLoadingError?: Error;
    itemCount?: number;
    setItemCount?: (itemCount: number) => void;
    pageSize?: number;
    paginationEnabled?: boolean;

    onItemClick?: (item: T) => void;
    selectedIds?: Set<string | number>;
    highlightedIds?: Set<string | number>;
    selectionEnabled?: boolean;
    onSelectionChange?: (item: T, selected: boolean) => void;

    onScroll?: (props: {
        scrollDirection: "forward" | "backward";
        scrollOffset: number;
        scrollUpdateWasRequested: boolean;
    }) => void;
    initialScroll?: number;

    size?: CollectionSize;
    renderCard: (
        item: T,
        extra: {
            selected: boolean;
            highlighted: boolean;
            onSelectionChange: (selected: boolean) => void;
            onClick: (e: React.MouseEvent) => void;
        }
    ) => React.ReactNode;
    emptyComponent?: React.ReactNode;
};

function getGridColumnsClass(size: CollectionSize): string {
    switch (size) {
        case "xs":
            return "grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10";
        case "s":
            return "grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8";
        case "m":
            return "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6";
        case "l":
            return "grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4";
        case "xl":
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

export function CardView<T>({
    data,
    dataLoading = false,
    noMoreToLoad = false,
    dataLoadingError,
    itemCount,
    setItemCount,
    pageSize = 50,
    paginationEnabled = true,

    onItemClick,
    selectedIds,
    highlightedIds,
    selectionEnabled = true,
    onSelectionChange,

    onScroll,
    initialScroll,
    size = "m",
    renderCard,
    emptyComponent
}: CardViewProps<T>) {
    const containerRef = useRef<HTMLDivElement>(null);
    const hasRestoredScroll = useRef(false);
    const isLoadingMore = useRef(false);

    // Sync mutable ref with pagination settings to avoid resetting listeners
    const paginationStateRef = useRef({ paginationEnabled, noMoreToLoad, itemCount, pageSize });
    useEffect(() => {
        paginationStateRef.current = { paginationEnabled, noMoreToLoad, itemCount, pageSize };
    }, [paginationEnabled, noMoreToLoad, itemCount, pageSize]);

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
        update();

        return () => {
            scrollEl.removeEventListener("scroll", onScrollEvent);
            ro.disconnect();
            if (rafId !== null) cancelAnimationFrame(rafId);
        };
    }, [setItemCount]);

    // Scroll restoration
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

    // Scroll tracking: call onScroll callback
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

    const getItemId = useCallback((item: T): string | number => {
        if (item && typeof item === "object" && "id" in item) {
            const id = (item as Record<"id", unknown>).id;
            return typeof id === "number" ? id : String(id);
        }
        return String(item);
    }, []);

    const gridColumnsClass = getGridColumnsClass(size);

    const isInitialLoading = dataLoading && data.length === 0 && !dataLoadingError;
    const isEmpty = !dataLoading && data.length === 0 && !dataLoadingError;

    return (
        <div
            ref={containerRef}
            className="w-full p-4"
        >
            {dataLoadingError && data.length === 0 ? (
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
                <div className="max-w-7xl mx-auto">
                    <div className={cls("grid gap-4", gridColumnsClass)}>
                        {data.map((item, index) => {
                            const id = getItemId(item);
                            const selected = selectedIds?.has(id) ?? false;
                            const highlighted = highlightedIds?.has(id) ?? false;

                            const handleClick = (e: React.MouseEvent) => {
                                if ((e.metaKey || e.ctrlKey) && selectionEnabled) {
                                    e.preventDefault();
                                    onSelectionChange?.(item, !selected);
                                    return;
                                }
                                onItemClick?.(item);
                            };

                            const handleSelectionChange = (val: boolean) => {
                                onSelectionChange?.(item, val);
                            };

                            return (
                                <React.Fragment key={id || index}>
                                    {renderCard(item, {
                                        selected,
                                        highlighted,
                                        onSelectionChange: handleSelectionChange,
                                        onClick: handleClick
                                    })}
                                </React.Fragment>
                            );
                        })}
                    </div>

                    <div className="flex items-center justify-center py-8">
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
            )}
        </div>
    );
}
