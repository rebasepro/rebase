import React from "react";
import type { CollectionCustomViewParams } from "@rebasepro/cms-types";
import type { Entity, Property } from "@rebasepro/types";
import { CHIP_HUES, cls, getColorSchemeForKey, Typography } from "@rebasepro/ui";

/**
 * A custom collection view mode, registered through `admin.customViews`.
 *
 * The point of this file in a demo is that it is *not* another arrangement of
 * cards. A list, a table, a card grid and a board all answer "which records are
 * there"; this answers "how is the catalogue positioned" — every product placed
 * by price against rating, sized by stock and coloured by status — which is a
 * question the built-in views cannot be configured into answering.
 *
 * What it does share with them is the query. Rows come from `tableController`,
 * so the search box, the filter presets and the record count in the toolbar
 * above drive this canvas exactly as they drive the table: pick "Low stock
 * (< 10)" and the cloud thins out. Clicking a point opens the record in the
 * side panel through `onEntityClick`, so the panel's own routing, permissions
 * and forms come for free.
 *
 * The status colours are read from the collection's `status` property rather
 * than hard-coded, which is why a dot, a chip in the table and a column header
 * on the board are the same green.
 */

/** How many rows the canvas will pull in before it stops asking for more. */
const MAX_POINTS = 1000;

const MARGIN = { top: 16,
right: 20,
bottom: 40,
left: 52 };

type Point = {
    entity: Entity<Record<string, unknown>>;
    name: string;
    price: number;
    rating: number;
    stock: number;
    status: string;
};

export function ProductPriceMapView({
    collection,
    tableController,
    onEntityClick,
    highlightedEntities,
    emptyComponent
}: CollectionCustomViewParams) {

    // Memoised because `?? []` would hand `points` a new array identity on
    // every render, which recomputes the whole projection for nothing.
    const rows = React.useMemo(() => tableController.data ?? [], [tableController.data]);

    const {
        dataLoading,
        noMoreToLoad,
        paginationEnabled,
        itemCount,
        setItemCount,
        pageSize = 50
    } = tableController;

    // A chart of the first page is a lie — it would leave out three quarters of
    // the catalogue while the count above says 200. So this view keeps asking
    // for the next page until the query is exhausted (or the cap is reached),
    // which is the one place a custom view legitimately wants different
    // pagination behaviour from the table it shares a query with.
    React.useEffect(() => {
        if (!paginationEnabled || dataLoading || noMoreToLoad) return;
        if (itemCount === undefined || rows.length >= MAX_POINTS) return;
        setItemCount?.(itemCount + pageSize);
    }, [paginationEnabled, dataLoading, noMoreToLoad, itemCount, pageSize, setItemCount, rows.length]);

    // Enum ids → the colour the rest of the panel paints them, read from the
    // collection rather than restated here, which is why a dot, a chip in the
    // table and a column header on the board are the same green.
    //
    // The `Dark` tone, not the bare hue: a chip key resolves to the pale stop
    // the chip paints *behind text*, and a 9px dot of it on a white page is
    // invisible. The `Dark` tone is the hue's solid stop and is the same value
    // on both themes, so the marks need no theme branch at all.
    const statusColors = React.useMemo(() => {
        const property = (collection.properties as Record<string, Property | undefined>).status;
        const values = property && "enum" in property ? property.enum : undefined;
        const entries = Array.isArray(values) ? values : [];
        const map: Record<string, { fill: string; label: string }> = {};
        for (const entry of entries) {
            if (!entry || typeof entry !== "object") continue;
            const { id, label, color } = entry as { id?: string; label?: string; color?: string };
            if (!id) continue;
            const hue = color ?? id;
            const key = (CHIP_HUES as readonly string[]).includes(hue) ? `${hue}Dark` : hue;
            map[id] = { fill: getColorSchemeForKey(key).color,
label: label ?? id };
        }
        return map;
    }, [collection.properties]);

    const points = React.useMemo((): Point[] => {
        const out: Point[] = [];
        for (const entity of rows) {
            const values = entity.values as Record<string, unknown>;
            const price = Number(values.price);
            const rating = Number(values.rating);
            // A product with no rating has no position on this chart, and
            // guessing one (0? 2.5?) would put a cluster of invented points
            // along an axis. They are counted under the title instead.
            if (!Number.isFinite(price) || !Number.isFinite(rating) || rating <= 0) continue;
            out.push({
                entity,
                name: String(values.name ?? entity.id),
                price,
                rating,
                stock: Number(values.stock_quantity) || 0,
                status: String(values.status ?? "")
            });
        }
        // Big bubbles first so the small ones stay clickable on top of them.
        return out.sort((a, b) => b.stock - a.stock);
    }, [rows]);

    // The plot is sized in pixels rather than a viewBox, so the axis labels
    // keep their type size at every width.
    //
    // A callback ref, not `useRef` + an effect on `[]`: the first render of
    // this view returns the empty state (no rows yet, nothing loading yet), so
    // an effect that runs once on mount measures a node that is not there and
    // never runs again — the canvas then stays 0×0 forever behind a header
    // that looks perfectly healthy. Measuring when the node *attaches* cannot
    // miss it.
    const [size, setSize] = React.useState({ width: 0,
height: 0 });
    const [plotNode, setPlotNode] = React.useState<HTMLDivElement | null>(null);
    React.useLayoutEffect(() => {
        if (!plotNode) return;
        const measure = () => {
            const rect = plotNode.getBoundingClientRect();
            setSize({ width: rect.width,
height: rect.height });
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(plotNode);
        return () => observer.disconnect();
    }, [plotNode]);

    const [hovered, setHovered] = React.useState<{ point: Point; x: number; y: number } | null>(null);

    const scales = React.useMemo(() => {
        // Price is logarithmic. A catalogue that runs from a $6 keychain to a
        // $1,600 outlier has no useful linear axis: nine tenths of it lands in
        // the first inch and the shape of the middle — which is the thing worth
        // looking at — disappears. Log spreads the mass and costs one word of
        // explanation on the axis.
        const prices = points.map(p => p.price).filter(v => v > 0);
        const minPrice = prices.length ? Math.min(...prices) : 1;
        const maxPrice = prices.length ? Math.max(...prices) : 10;
        const lo = Math.log10(Math.max(1, minPrice * 0.8));
        const hi = Math.log10(Math.max(minPrice * 1.6, maxPrice * 1.15));

        const maxStock = points.reduce((max, p) => Math.max(max, p.stock), 0);
        const minRating = points.reduce((min, p) => Math.min(min, p.rating), 5);
        const yMin = Math.min(4.5, Math.floor(minRating * 2) / 2);
        const innerW = Math.max(0, size.width - MARGIN.left - MARGIN.right);
        const innerH = Math.max(0, size.height - MARGIN.top - MARGIN.bottom);

        // 1-2-5 within every decade the data actually spans, which is the tick
        // set a log axis can be read off without counting.
        const ticks: number[] = [];
        for (let decade = Math.floor(lo); decade <= Math.ceil(hi); decade++) {
            for (const multiple of [1, 2, 5]) {
                const value = multiple * 10 ** decade;
                const at = Math.log10(value);
                if (at >= lo && at <= hi) ticks.push(value);
            }
        }

        return {
            yMin,
            innerW,
            innerH,
            xTicks: ticks,
            x: (price: number) =>
                MARGIN.left + ((Math.log10(Math.max(1, price)) - lo) / (hi - lo || 1)) * innerW,
            y: (rating: number) => MARGIN.top + (1 - (rating - yMin) / (5 - yMin)) * innerH,
            // Area, not radius, carries the stock — scaling the radius directly
            // would draw a product with twice the stock four times the size.
            r: (stock: number) => 3.5 + 9 * Math.sqrt(Math.min(stock, maxStock || 1) / (maxStock || 1))
        };
    }, [points, size]);

    if (!dataLoading && rows.length === 0) {
        return <>{emptyComponent}</>;
    }

    const unrated = rows.length - points.length;
    const yTicks: number[] = [];
    for (let value = Math.ceil(scales.yMin * 2) / 2; value <= 5.0001; value += 0.5) yTicks.push(Number(value.toFixed(1)));

    return (
        <div className="h-full flex flex-col">

            {/* The demo says out loud what this canvas is, because "it is your
                code, not ours" is the whole claim being made by it. */}
            <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3 border-b border-hairline">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/12 text-primary px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide">
                    <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
                        <path d="M6 0.5 7.3 4.2 11 5.5 7.3 6.8 6 10.5 4.7 6.8 1 5.5 4.7 4.2Z" fill="currentColor"/>
                    </svg>
                    Custom view
                </span>
                <Typography variant="body2" className="font-medium">Price map</Typography>
                <Typography variant="caption" color="secondary">
                    {points.length} plotted{unrated > 0 ? ` · ${unrated} unrated` : ""}{dataLoading ? " · loading…" : ""}
                </Typography>
                <Typography variant="caption" color="secondary" className="flex-1 min-w-[16rem]">
                    Not a built-in — one React file in this demo&rsquo;s own source, on the same query
                    as the table: the search box and the filter chips above drive it too.
                    Price against rating, area by stock, colour by status.
                </Typography>

                <div className="flex items-center gap-3">
                    {Object.entries(statusColors).map(([id, { fill, label }]) => (
                        <span key={id} className="inline-flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: fill }}/>
                            <Typography variant="caption" color="secondary">{label}</Typography>
                        </span>
                    ))}
                </div>
            </header>

            <div ref={setPlotNode} className="flex-1 min-h-0 relative">
                {size.width > 0 && (
                    <svg width={size.width} height={size.height} role="img"
                        aria-label={`${points.length} products plotted by price and rating`}>

                        {/* Gridlines and axes */}
                        {yTicks.map((value) => (
                            <g key={`y${value}`}>
                                <line x1={MARGIN.left} x2={size.width - MARGIN.right}
                                    y1={scales.y(value)} y2={scales.y(value)}
                                    className="stroke-hairline"/>
                                <text x={MARGIN.left - 10} y={scales.y(value)} dy="0.32em"
                                    textAnchor="end" className="fill-surface-500 text-[11px]">
                                    {value.toFixed(1)}
                                </text>
                            </g>
                        ))}
                        {scales.xTicks.map((value) => (
                            <g key={`x${value}`}>
                                <line x1={scales.x(value)} x2={scales.x(value)}
                                    y1={MARGIN.top} y2={size.height - MARGIN.bottom}
                                    className="stroke-hairline" strokeDasharray="2 4"/>
                                <text x={scales.x(value)} y={size.height - MARGIN.bottom + 18}
                                    textAnchor="middle" className="fill-surface-500 text-[11px]">
                                    {value >= 1000 ? `$${value / 1000}k` : `$${value}`}
                                </text>
                            </g>
                        ))}

                        {/* Axis titles. The x one says "log" because a reader
                            who does not notice will misjudge every distance. */}
                        <text x={size.width - MARGIN.right} y={size.height - 6} textAnchor="end"
                            className="fill-surface-500 text-[10px] uppercase tracking-wide">
                            price (log)
                        </text>
                        <text x={MARGIN.left - 10} y={MARGIN.top - 3} textAnchor="end"
                            className="fill-surface-500 text-[10px] uppercase tracking-wide">
                            rating
                        </text>

                        {points.map((point) => {
                            const highlighted = highlightedEntities?.some(e => e.id === point.entity.id);
                            const color = statusColors[point.status]?.fill ?? "currentColor";
                            const outOfStock = point.stock === 0;
                            return (
                                <circle
                                    key={String(point.entity.id)}
                                    cx={scales.x(point.price)}
                                    cy={scales.y(point.rating)}
                                    r={scales.r(point.stock)}
                                    // Out of stock reads as a hollow ring — the
                                    // one thing a shop wants to spot without
                                    // reading a single label.
                                    fill={outOfStock ? "transparent" : color}
                                    fillOpacity={hovered?.point === point ? 0.95 : 0.45}
                                    stroke={color}
                                    strokeWidth={highlighted ? 2.5 : 1.25}
                                    className="cursor-pointer transition-[fill-opacity]"
                                    onMouseEnter={() => setHovered({
                                        point,
                                        x: scales.x(point.price),
                                        y: scales.y(point.rating)
                                    })}
                                    onMouseLeave={() => setHovered(null)}
                                    onClick={() => onEntityClick?.(point.entity)}
                                />
                            );
                        })}
                    </svg>
                )}

                {hovered && (
                    <div
                        className={cls(
                            "absolute z-10 pointer-events-none rounded-lg border border-hairline",
                            "bg-surface-card shadow-lg px-3 py-2 max-w-[15rem]"
                        )}
                        style={{
                            left: Math.min(Math.max(hovered.x + 14, 8), Math.max(8, size.width - 220)),
                            top: Math.max(8, hovered.y - 56)
                        }}>
                        <Typography variant="body2" className="font-medium truncate">{hovered.point.name}</Typography>
                        <Typography variant="caption" color="secondary">
                            ${hovered.point.price.toFixed(2)} · ★ {hovered.point.rating.toFixed(1)} ·{" "}
                            {hovered.point.stock === 0 ? "out of stock" : `${hovered.point.stock} in stock`}
                        </Typography>
                    </div>
                )}

            </div>
        </div>
    );
}
