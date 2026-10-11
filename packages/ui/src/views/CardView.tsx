import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
    Card,
    CircularProgress,
    Skeleton,
    Typography
} from "../components";
import { cls } from "../util";
import { useUiLabels } from "../hooks/UiLabelsContext";

import { CollectionSize } from "./ListView";
import { getScrollParent, useScrollParentRestoration, type ViewScrollEvent } from "./useScrollParentRestoration";

export type CardViewProps<T> = {
    /**
     * The items, in order. A position holding `undefined` is an item that
     * exists but has not been read yet: a placeholder card is drawn in its
     * place, and `renderCard` is not called for it.
     */
    data: (T | undefined)[];
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

    onScroll?: (props: ViewScrollEvent) => void;
    initialScroll?: number;

    /**
     * Called with the positions in `data` of the cards on screen — the rows
     * of cards on screen, not the ones drawn ahead of them — end exclusive,
     * each time they change. While the grid is still scrolling to
     * `initialScroll`, the cards there.
     */
    onRowsRendered?: (range: { start: number; end: number }) => void;

    size?: CollectionSize;
    renderCard: (
        item: T,
        extra: {
            selected: boolean;
            highlighted: boolean;
            onSelectionChange: (selected: boolean) => void;
            /**
             * Absent on a keyboard activation — a card is a `role="button"` and
             * Enter/Space reach this with no event. Only the modifier branch
             * needs one; the click itself does not.
             */
            onClick: (e?: React.MouseEvent) => void;
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

/**
 * The column count `getGridColumnsClass` gives at this viewport width — the
 * Tailwind breakpoints are viewport widths. Only a fallback: the count is read
 * off the grid as laid out whenever there is a layout to read it from.
 */
function columnsAtWidth(size: CollectionSize, width: number): number {
    const steps: Record<CollectionSize, [number, number, number, number, number]> = {
        xs: [4, 5, 6, 8, 10],
        s: [3, 4, 5, 6, 8],
        m: [2, 3, 4, 5, 6],
        l: [2, 2, 3, 4, 4],
        xl: [1, 2, 2, 3, 3]
    };
    const [base, sm, md, lg, xl] = steps[size] ?? steps.m;
    if (width >= 1280) return xl;
    if (width >= 1024) return lg;
    if (width >= 768) return md;
    if (width >= 640) return sm;
    return base;
}

/** The tracks of a laid-out grid, or `undefined` where nothing is laid out. */
function columnsOf(grid: HTMLElement | null): number | undefined {
    if (!grid) return undefined;
    const tracks = window.getComputedStyle(grid).gridTemplateColumns;
    if (!tracks || tracks === "none") return undefined;
    const count = tracks.trim().split(/\s+/).filter(track => !track.startsWith("[")).length;
    return count > 0 ? count : undefined;
}

/** A first guess at a row of cards' height, gap included, before one is measured. */
function defaultRowHeight(size: CollectionSize): number {
    switch (size) {
        case "xs": return 170;
        case "s": return 220;
        case "l": return 370;
        case "xl": return 440;
        default: return 290;
    }
}

/**
 * The average row height measured last, per size and column count, so a grid
 * that mounts again (coming back from a record) places its rows — and the
 * scroll position it restores — with the heights the cards actually had.
 */
const lastRowHeights = new Map<string, number>();

/** Rows of cards drawn above and below the screen. */
const OVERSCAN_ROWS = 2;
/** The grid's `gap-4`, which a row carries below it as padding. */
const ROW_GAP = 16;

/**
 * A card grid that draws the rows of cards on screen and a couple either side.
 *
 * Every loaded card used to stay mounted — about 22 DOM nodes each, 44,000 at
 * 2,000 cards. The grid looks as it did: each row is a grid with the same
 * column classes and gap, and a row is as tall as its tallest card, measured
 * as it is drawn rather than assumed. Rows not drawn yet count at the average
 * height measured so far.
 */
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
    onRowsRendered,
    size = "m",
    renderCard,
    emptyComponent
}: CardViewProps<T>) {
    const labels = useUiLabels();
    const containerRef = useRef<HTMLDivElement>(null);
    // The rows' own box: the window of drawn rows is measured against it.
    const rowsRef = useRef<HTMLDivElement>(null);
    // An empty grid with the cards' column classes, to read the column count
    // the breakpoints give right now.
    const probeRef = useRef<HTMLDivElement>(null);
    const isLoadingMore = useRef(false);

    const gridColumnsClass = getGridColumnsClass(size);
    const [columns, setColumns] = useState(() =>
        columnsAtWidth(size, typeof window === "undefined" ? 1024 : window.innerWidth));
    const [scrollTop, setScrollTop] = useState(0);
    const [viewportHeight, setViewportHeight] = useState(800);
    // Where the cards on screen start, for `onRowsRendered`: the scroll
    // position the grid is being restored to, until it gets there.
    const [reported, setReported] = useState({ top: 0, height: 800 });

    // Sync mutable ref with pagination settings to avoid resetting listeners
    const paginationStateRef = useRef({ paginationEnabled, noMoreToLoad, itemCount, pageSize });
    useEffect(() => {
        paginationStateRef.current = { paginationEnabled, noMoreToLoad, itemCount, pageSize };
    }, [paginationEnabled, noMoreToLoad, itemCount, pageSize]);

    useEffect(() => {
        if (!dataLoading) isLoadingMore.current = false;
    }, [dataLoading]);

    const { pendingScroll } = useScrollParentRestoration({ containerRef, initialScroll, onScroll, dataLength: data.length });

    const readColumns = useCallback(() => {
        const next = columnsOf(probeRef.current) ?? columnsAtWidth(size, window.innerWidth);
        setColumns(current => current === next ? current : next);
    }, [size]);

    // Infinite scroll, the window of drawn rows, and resizes
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const scrollEl = getScrollParent(el);
        if (!scrollEl) return;

        let rafId: number | null = null;

        const update = () => {
            rafId = null;
            const scrollRect = scrollEl.getBoundingClientRect();
            const rowsRect = (rowsRef.current ?? el).getBoundingClientRect();
            const rowsTopRelative = rowsRect.top - scrollRect.top;
            setScrollTop(Math.max(0, -rowsTopRelative));
            setViewportHeight(scrollRect.height);
            const restoring = pendingScroll.current;
            const top = restoring
                ? restoring - (scrollEl.scrollTop + rowsTopRelative)
                : -rowsTopRelative;
            // Only the part of the screen the rows are in: not what is above them.
            const height = Math.max(0, scrollRect.height + Math.min(0, top));
            setReported(current => current.top === Math.max(0, top) && current.height === height
                ? current
                : { top: Math.max(0, top), height });

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
        const ro = new ResizeObserver(() => {
            readColumns();
            update();
        });
        ro.observe(scrollEl);
        ro.observe(el);
        readColumns();
        update();

        return () => {
            scrollEl.removeEventListener("scroll", onScrollEvent);
            ro.disconnect();
            if (rafId !== null) cancelAnimationFrame(rafId);
        };
    }, [setItemCount, readColumns, pendingScroll]);

    // The size changes the column classes: read the count again.
    useLayoutEffect(() => readColumns(), [readColumns, gridColumnsClass]);

    // Row heights as measured, by row. A different column count regroups the
    // cards into different rows, so the heights start over.
    const heightsRef = useRef<{ columns: number; heights: Map<number, number> }>({ columns, heights: new Map() });
    if (heightsRef.current.columns !== columns) heightsRef.current = { columns, heights: new Map() };
    const [measured, setMeasured] = useState(0);
    const memoryKey = `${size}:${columns}`;

    const observerRef = useRef<ResizeObserver | null>(null);
    useEffect(() => {
        const observer = new ResizeObserver((entries) => {
            let changed = false;
            const { heights } = heightsRef.current;
            for (const entry of entries) {
                const target = entry.target as HTMLElement;
                const row = Number(target.dataset.row);
                if (!Number.isFinite(row) || Number(target.dataset.columns) !== heightsRef.current.columns) continue;
                const height = target.getBoundingClientRect().height;
                if (height > 0 && heights.get(row) !== height) {
                    heights.set(row, height);
                    changed = true;
                }
            }
            if (changed) setMeasured(n => n + 1);
        });
        observerRef.current = observer;
        return () => {
            observer.disconnect();
            observerRef.current = null;
        };
    }, []);

    const observeRow = useCallback((element: HTMLDivElement | null) => {
        const observer = observerRef.current;
        if (!element || !observer) return;
        observer.observe(element);
        return () => observer.unobserve(element);
    }, []);

    const rowCount = Math.ceil(data.length / columns);

    // Each row's top, and the height of all of them: measured rows as they
    // are, the others at the average of the measured ones.
    const layout = useMemo(() => {
        const { heights } = heightsRef.current;
        let total = 0;
        heights.forEach((height) => {
            total += height;
        });
        const estimate = heights.size > 0
            ? total / heights.size
            : lastRowHeights.get(memoryKey) ?? defaultRowHeight(size);
        const tops = new Float64Array(rowCount + 1);
        for (let r = 0; r < rowCount; r++) {
            tops[r + 1] = tops[r] + (heights.get(r) ?? estimate);
        }
        return { tops, estimate };
    // `measured` is how a new measurement reaches this memo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rowCount, columns, measured, memoryKey, size]);

    useEffect(() => {
        if (heightsRef.current.heights.size > 0) lastRowHeights.set(memoryKey, layout.estimate);
    }, [layout, memoryKey]);

    /** The row at this offset from the top of the rows. */
    const rowAt = useCallback((offset: number) => {
        const { tops } = layout;
        let low = 0;
        let high = rowCount;
        while (low < high) {
            const mid = (low + high) >> 1;
            if (tops[mid + 1] <= offset) low = mid + 1;
            else high = mid;
        }
        return Math.min(low, Math.max(0, rowCount - 1));
    }, [layout, rowCount]);

    const firstRow = rowCount === 0 ? 0 : Math.max(0, rowAt(scrollTop) - OVERSCAN_ROWS);
    const lastRow = rowCount === 0 ? -1 : Math.min(rowCount - 1, rowAt(scrollTop + viewportHeight) + OVERSCAN_ROWS);

    // The cards of the rows on screen, by position in `data`.
    const visibleStart = rowCount === 0 ? 0 : Math.min(data.length, rowAt(reported.top) * columns);
    const visibleEnd = rowCount === 0 || reported.height === 0
        ? visibleStart
        : Math.min(data.length, (rowAt(reported.top + reported.height - 1) + 1) * columns);
    useEffect(() => {
        if (onRowsRendered && data.length > 0) onRowsRendered({ start: visibleStart, end: visibleEnd });
        // Not on `data`: a page appended below the screen moves nothing on it.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visibleStart, visibleEnd, onRowsRendered]);

    // A drawn row the observer has not measured — one whose cards changed
    // with the column count, keeping its size — is measured here, before
    // paint. The observer reports every change after that.
    useLayoutEffect(() => {
        const { heights } = heightsRef.current;
        let changed = false;
        rowsRef.current?.querySelectorAll<HTMLElement>("[data-row]").forEach((element) => {
            const row = Number(element.dataset.row);
            if (heights.has(row)) return;
            const height = element.getBoundingClientRect().height;
            if (height > 0) {
                heights.set(row, height);
                changed = true;
            }
        });
        if (changed) setMeasured(n => n + 1);
    }, [firstRow, lastRow, columns, data]);

    const getItemId = useCallback((item: T | undefined): string | number => {
        if (item && typeof item === "object" && "id" in item) {
            const id = (item as Record<"id", unknown>).id;
            return typeof id === "number" ? id : String(id);
        }
        return String(item);
    }, []);

    const isInitialLoading = dataLoading && data.length === 0 && !dataLoadingError;
    const isEmpty = !dataLoading && data.length === 0 && !dataLoadingError;

    const drawnRows: React.ReactNode[] = [];
    for (let r = firstRow; r <= lastRow; r++) {
        const cards: React.ReactNode[] = [];
        for (let index = r * columns; index < Math.min(data.length, (r + 1) * columns); index++) {
            const item = data[index];
            if (item === undefined) {
                cards.push(<UnreadCard key={`__unread_${index}`} height={Math.max(0, layout.estimate - ROW_GAP)}/>);
                continue;
            }
            const id = getItemId(item);
            const selected = selectedIds?.has(id) ?? false;
            const highlighted = highlightedIds?.has(id) ?? false;

            const handleClick = (e?: React.MouseEvent) => {
                if (e && (e.metaKey || e.ctrlKey) && selectionEnabled) {
                    e.preventDefault();
                    onSelectionChange?.(item, !selected);
                    return;
                }
                onItemClick?.(item);
            };

            const handleSelectionChange = (val: boolean) => {
                onSelectionChange?.(item, val);
            };

            cards.push(
                <React.Fragment key={id || index}>
                    {renderCard(item, {
                        selected,
                        highlighted,
                        onSelectionChange: handleSelectionChange,
                        onClick: handleClick
                    })}
                </React.Fragment>
            );
        }
        drawnRows.push(
            <div key={r}
                ref={observeRow}
                data-row={r}
                data-columns={columns}
                className={cls("grid gap-4", gridColumnsClass)}
                // The gap between rows, carried by the row above it.
                style={r < rowCount - 1 ? { paddingBottom: ROW_GAP } : undefined}>
                {cards}
            </div>
        );
    }

    return (
        <div
            ref={containerRef}
            className="w-full p-4"
        >
            {dataLoadingError && data.length === 0 ? (
                <div className="h-full flex items-center justify-center p-8">
                    <Typography className="text-red-500">
                        {labels.errorLoadingData(dataLoadingError.message)}
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
                            {labels.noEntriesFound}
                        </Typography>
                    )}
                </div>
            ) : (
                <div className="max-w-7xl mx-auto">
                    <div ref={probeRef} aria-hidden={true} className={cls("grid gap-4 h-0 overflow-hidden", gridColumnsClass)}/>
                    <div ref={rowsRef} style={{ position: "relative", height: layout.tops[rowCount] }}>
                        <div style={{ position: "absolute", top: layout.tops[firstRow] ?? 0, left: 0, right: 0 }}>
                            {drawnRows}
                        </div>
                    </div>

                    <div className="flex items-center justify-center py-8">
                        {dataLoading && (
                            <CircularProgress size="small"/>
                        )}
                        {!dataLoading && noMoreToLoad && data.length > 0 && (
                            <Typography variant="caption" color="secondary">
                                {labels.allEntriesLoaded(data.length)}
                            </Typography>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

/** A card that exists but has not been read yet. */
function UnreadCard({ height }: { height: number }) {
    return (
        <Card className="p-3 flex flex-col gap-2" style={{ height }} aria-busy={true}>
            <Skeleton className="grow"/>
            <Skeleton width={120} height={12}/>
            <Skeleton width={80} height={10}/>
        </Card>
    );
}
