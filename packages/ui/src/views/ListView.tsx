import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    CircularProgress,
    Typography
} from "../components";
import { cls } from "../util";

export type CollectionSize = "xs" | "s" | "m" | "l" | "xl";

export type ListViewColumnDef<T> = {
    key: string;
    label: string;
    align?: "left" | "center" | "right";
    width?: string;
    renderCell: (item: T) => React.ReactNode;
    isTitle?: boolean;
};

export type ListViewProps<T> = {
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
    emptyComponent?: React.ReactNode;

    size?: CollectionSize;
    selectedEntityId?: string | number;

    /**
     * Rendered above the rows, inside the list's own frame, and only when there
     * are rows to head. A column header over an empty state or a spinner labels
     * nothing.
     */
    header?: React.ReactNode;

    renderRow: (params: {
        item: T;
        index: number;
        style: React.CSSProperties;
        className: string;
        selected: boolean;
        highlighted: boolean;
        isLast: boolean;
        onClick: (e: React.MouseEvent) => void;
        onSelectionChange: (selected: boolean) => void;
    }) => React.ReactNode;
};

function getEstimatedRowHeight(size: CollectionSize): number {
    switch (size) {
        case "xs": return 44;
        case "s": return 52;
        case "m": return 64;
        case "l": return 76;
        case "xl": return 88;
        default: return 64;
    }
}

const OVERSCAN_COUNT = 8;
const LOAD_MORE_THRESHOLD = 400;

function getScrollParent(element: HTMLElement | null): HTMLElement | null {
    let parent = element?.parentElement ?? null;
    while (parent) {
        const style = getComputedStyle(parent);
        if (
            style.overflowY === "auto" || style.overflowY === "scroll" ||
            style.overflow === "auto" || style.overflow === "scroll"
        ) {
            return parent;
        }
        parent = parent.parentElement;
    }
    return document.documentElement;
}

export function ListView<T>({
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
    emptyComponent,

    size = "m",
    selectedEntityId,
    header,
    renderRow
}: ListViewProps<T>) {
    const containerRef = useRef<HTMLDivElement>(null);
    // The rows' own box, which a header shifts down from the container's top.
    // Virtualization measures against it rather than against the container, so
    // the window of rendered rows stays the one the viewport is actually over.
    const rowsRef = useRef<HTMLDivElement>(null);
    const isLoadingMore = useRef(false);

    // Reset loading gate when loading stops
    useEffect(() => {
        if (!dataLoading) isLoadingMore.current = false;
    }, [dataLoading]);

    // Virtualization scroll states
    const estimatedRowHeight = getEstimatedRowHeight(size);
    const [effectiveScrollTop, setEffectiveScrollTop] = useState(0);
    const [viewportHeight, setViewportHeight] = useState(800);

    const paginationStateRef = useRef({ paginationEnabled, noMoreToLoad, itemCount, pageSize });
    useEffect(() => {
        paginationStateRef.current = { paginationEnabled, noMoreToLoad, itemCount, pageSize };
    }, [paginationEnabled, noMoreToLoad, itemCount, pageSize]);

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const scrollEl = getScrollParent(el);
        if (!scrollEl) return;

        let rafId: number | null = null;

        const update = () => {
            rafId = null;
            const scrollRect = scrollEl.getBoundingClientRect();
            const listRect = (rowsRef.current ?? el).getBoundingClientRect();

            const listTopRelative = listRect.top - scrollRect.top;
            setEffectiveScrollTop(Math.max(0, -listTopRelative));
            setViewportHeight(scrollRect.height);

            const { paginationEnabled: pe, noMoreToLoad: nm, itemCount: ic, pageSize: ps } = paginationStateRef.current;
            if (
                pe &&
                !nm &&
                !isLoadingMore.current &&
                scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < LOAD_MORE_THRESHOLD
            ) {
                isLoadingMore.current = true;
                setItemCount?.((ic ?? ps) + ps);
            }
        };

        const onScroll = () => {
            if (rafId === null) rafId = requestAnimationFrame(update);
        };

        scrollEl.addEventListener("scroll", onScroll, { passive: true });
        const ro = new ResizeObserver(() => update());
        ro.observe(scrollEl);
        update();

        return () => {
            scrollEl.removeEventListener("scroll", onScroll);
            ro.disconnect();
            if (rafId !== null) cancelAnimationFrame(rafId);
        };
    }, [setItemCount]);

    const totalHeight = data.length * estimatedRowHeight;
    const startIndex = Math.max(0, Math.floor(effectiveScrollTop / estimatedRowHeight) - OVERSCAN_COUNT);
    const endIndex = Math.min(
        data.length,
        Math.ceil((effectiveScrollTop + viewportHeight) / estimatedRowHeight) + OVERSCAN_COUNT
    );
    const visibleData = data.slice(startIndex, endIndex);
    const offsetY = startIndex * estimatedRowHeight;

    const footerHeight = dataLoading ? 48 : (!dataLoading && noMoreToLoad && data.length > 0) ? 32 : 0;

    const isInitialLoading = dataLoading && data.length === 0;
    const isEmpty = !dataLoading && data.length === 0 && !dataLoadingError;

    const getItemId = useCallback((item: T): string | number => {
        if (item && typeof item === "object" && "id" in item) {
            const id = (item as Record<"id", unknown>).id;
            return typeof id === "number" ? id : String(id);
        }
        return String(item);
    }, []);

    const borderMixinClass = "border-surface-200 dark:border-surface-800";

    return (
        <div
            ref={containerRef}
            className={cls(
                "w-full",
                selectedEntityId === undefined && `rounded-lg overflow-hidden border ${borderMixinClass}`
            )}
        >
            {dataLoadingError && data.length === 0 ? (
                <div className="flex items-center justify-center p-8">
                    <Typography className="text-red-500">
                        Error loading data: {dataLoadingError.message}
                    </Typography>
                </div>
            ) : isInitialLoading ? (
                <div className="flex items-center justify-center py-12 px-8">
                    <CircularProgress size="small" />
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
                    {header}
                    <div ref={rowsRef} style={{ height: totalHeight + footerHeight, position: "relative" }}>
                        <div style={{ position: "absolute", top: offsetY, left: 0, right: 0 }}>
                            {visibleData.map((item, i) => {
                                const actualIndex = startIndex + i;
                                const isLast = actualIndex === data.length - 1;
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
                                    <React.Fragment key={id || actualIndex}>
                                        {renderRow({
                                            item,
                                            index: actualIndex,
                                            style: { height: estimatedRowHeight, overflow: "hidden" },
                                            className: cls(
                                                !isLast && "border-b",
                                                !isLast && borderMixinClass
                                            ),
                                            selected,
                                            highlighted,
                                            isLast,
                                            onClick: handleClick,
                                            onSelectionChange: handleSelectionChange
                                        })}
                                    </React.Fragment>
                                );
                            })}
                        </div>

                        {dataLoading && (
                            <div
                                className="flex items-center justify-center py-3"
                                style={{ position: "absolute", top: totalHeight, left: 0, right: 0 }}
                            >
                                <CircularProgress size="small" />
                            </div>
                        )}
                        {!dataLoading && noMoreToLoad && data.length > 0 && (
                            <div
                                className="flex items-center justify-center py-2 dark:bg-surface-900"
                                style={{ position: "absolute", top: totalHeight, left: 0, right: 0 }}
                            >
                                <Typography variant="caption" color="secondary">
                                    All {data.length} entries loaded
                                </Typography>
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}
