"use client";
import React from "react";
import { cls } from "../../util";
import { describeChange, formatNumber, type ChangeTone } from "../../util/numbers";
import { useUiLabels } from "../../hooks/UiLabelsContext";
import { Card } from "../Card";
import { Skeleton } from "../Skeleton";
import { Tooltip } from "../Tooltip";
import { Typography } from "../Typography";
import { HeaderIcon } from "./chart_parts";

/** The comparison window a tile names when no `periodDays` is given. */
const DEFAULT_PERIOD_DAYS = 30;

const toneClasses: Record<ChangeTone, string> = {
    // The kit's error tier, and its success hue a step darker in light mode:
    // emerald-600 on the card is 3.8:1, under what 12px text needs.
    positive: "text-emerald-700 dark:text-emerald-400",
    negative: "text-red-600 dark:text-red-500",
    neutral: "text-text-secondary dark:text-text-secondary-dark"
};

/** A shimmering bar standing in for a figure that has not arrived, sized by its line box. */
export function Placeholder({ className }: { className: string }) {
    return <Skeleton className={cls("inline-block align-middle", className)}/>;
}

export interface KpiProps {
    label: string;
    /** The figure. A string is shown as it is; `null` or `undefined` as a dash. */
    value: number | string | null | undefined;
    format?: Intl.NumberFormatOptions;
    /** The same figure over the previous window; shows the change against it. */
    previous?: number | null;
    /** Which direction of change is good news. Defaults to `"up"`. */
    goodWhen?: "up" | "down";
    /** The change as a percentage (the default) or as the difference. */
    show?: "percent" | "absolute";
    /** The length of the window the change is measured over, named in its tooltip. Defaults to 30. */
    periodDays?: number;
    /** Optional series of numeric values rendered as a right-hand trend sparkline. */
    sparkline?: number[];
    loading?: boolean;
    error?: Error;
}

function displayValue(value: KpiProps["value"], format: Intl.NumberFormatOptions | undefined, locale: string | undefined): string {
    if (typeof value === "number") return formatNumber(value, format, locale);
    if (typeof value === "string" && value !== "") return value;
    return "—";
}

/**
 * The change against the previous window: an arrow and its size, coloured by
 * whether it is good news. The arrow carries the direction, so it reads
 * without the colour.
 *
 * Its words come from the nearest `UiLabelsProvider` (`changeUp`, `changeDown`,
 * `noChange`, `previousPeriodValue`), and its numbers are written in that
 * provider's `locale`.
 */
export function KpiChange({ value, previous, format, goodWhen, show, periodDays = DEFAULT_PERIOD_DAYS, tooltip = true }: Pick<KpiProps, "value" | "previous" | "format" | "goodWhen" | "show" | "periodDays"> & {
    tooltip?: boolean;
}) {
    const labels = useUiLabels();
    if (typeof value !== "number" || typeof previous !== "number") return null;

    const locale = labels.locale;
    const change = describeChange({ current: value, previous, goodWhen, show, format, locale });
    const arrow = change.direction === "up" ? "↑ " : change.direction === "down" ? "↓ " : "";
    const spoken = change.direction === "up"
        ? labels.changeUp(change.magnitude)
        : change.direction === "down"
            ? labels.changeDown(change.magnitude)
            : labels.noChange;
    const previousLabel = labels.previousPeriodValue(periodDays, formatNumber(previous, format, locale));

    const label = (
        <Typography variant="mono" component="span" color="inherit" className={cls("text-xs font-medium whitespace-nowrap", toneClasses[change.tone])}>
            <span aria-hidden="true">{arrow + change.magnitude}</span>
            <span className="sr-only">{`${spoken}. ${previousLabel}`}</span>
        </Typography>
    );
    return tooltip ? <Tooltip title={previousLabel}>{label}</Tooltip> : label;
}

const SPARK_WIDTH = 80;
const SPARK_HEIGHT = 34;

/** By the change's tone, so the line and the figure beside it never disagree. */
const sparkStroke: Record<ChangeTone, string> = {
    positive: "#10b981",
    negative: "#f43f5e",
    neutral: "#64748b"
};

/**
 * The tone of the trend: the change against the previous window when there is
 * one, which is what the tile's arrow shows; otherwise the series' own first
 * and last points, read through `goodWhen`.
 */
function sparkTone(points: number[], { value, previous, goodWhen = "up" }: Pick<KpiProps, "value" | "previous" | "goodWhen">): ChangeTone {
    if (typeof value === "number" && typeof previous === "number") {
        return describeChange({ current: value, previous, goodWhen }).tone;
    }
    const first = points[0];
    const last = points[points.length - 1];
    const direction = last > first ? "up" : last < first ? "down" : "flat";
    return direction === "flat" ? "neutral" : direction === goodWhen ? "positive" : "negative";
}

/** The points a tile draws: its own series, or the previous window and this one. */
function sparkPoints(sparkline: number[] | undefined, value: KpiProps["value"], previous: KpiProps["previous"]): number[] | null {
    const series = (sparkline ?? []).filter((n) => Number.isFinite(n));
    if (series.length >= 2) return series;
    if (typeof value === "number" && typeof previous === "number" && Number.isFinite(value) && Number.isFinite(previous)) return [previous, value];
    return null;
}

/** A smooth path through the points: each segment a cubic whose handles sit level with its ends, halfway across. */
function smoothPath(points: [number, number][]): string {
    return points.reduce((d, [x, y], i) => {
        if (i === 0) return `M${x},${y}`;
        const [px, py] = points[i - 1];
        const mid = (px + x) / 2;
        return `${d} C${mid},${py} ${mid},${y} ${x},${y}`;
    }, "");
}

/** The trend beside a figure, decorative: the change under it is what a reader hears. Fills its box's width. */
function Sparkline({ points, tone }: { points: number[]; tone: ChangeTone }) {
    const id = React.useId();
    const min = Math.min(...points);
    const max = Math.max(...points);
    const span = max - min || 1;
    const pad = 2;
    const coords = points.map((n, i): [number, number] => [
        pad + (i / (points.length - 1)) * (SPARK_WIDTH - pad * 2),
        max === min ? SPARK_HEIGHT / 2 : pad + (1 - (n - min) / span) * (SPARK_HEIGHT - pad * 2)
    ]);
    const stroke = sparkStroke[tone];
    const line = smoothPath(coords);
    const area = `${line} L${coords[coords.length - 1][0]},${SPARK_HEIGHT} L${coords[0][0]},${SPARK_HEIGHT} Z`;

    return (
        <svg aria-hidden="true" viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`} preserveAspectRatio="none" className="block w-full h-[34px] overflow-visible">
            <defs>
                <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={stroke} stopOpacity={0.28}/>
                    <stop offset="100%" stopColor={stroke} stopOpacity={0}/>
                </linearGradient>
            </defs>
            <path d={area} fill={`url(#${id})`}/>
            <path d={line} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke"/>
        </svg>
    );
}

/**
 * One headline figure as a card: its label, its value and its change on the
 * previous window.
 *
 * The label renders before the figure arrives and only the figure shimmers,
 * so nothing moves when the data lands. Below 200px of its own width the
 * tile tightens its padding and its figure.
 *
 * Given a `sparkline` of at least two numbers, or a numeric `value` and
 * `previous`, it draws the trend at its bottom right.
 */
export function KpiTile({ label, icon, className, ...figure }: KpiProps & {
    /** A Lucide icon name (`"DollarSign"`) or an icon element, drawn before the label. */
    icon?: string | React.ReactNode;
    className?: string;
}) {
    const { locale } = useUiLabels();
    const { value, format, previous, sparkline, loading, error } = figure;
    const compares = previous !== undefined;
    const trend = loading || error ? null : sparkPoints(sparkline, value, previous);

    return (
        <Card className={cls("@container min-w-0", className)}>
            <div className="flex flex-col min-w-0 h-full px-5 py-4 @max-[200px]:px-3.5 @max-[200px]:py-3">
                <div className="flex items-center gap-1.5 min-w-0 mb-2.5 @max-[200px]:mb-1">
                    <HeaderIcon icon={icon}/>
                    <Typography variant="micro" color="secondary" className="truncate">{label}</Typography>
                </div>
                {/* The figure keeps its width and the trend takes what is left,
                    up to 80px; below 200px of tile there is no room for both,
                    so the trend goes and the figure may break again. */}
                <div className="flex items-end justify-between gap-3 min-w-0">
                    <div className="shrink-0 @max-[200px]:shrink @max-[200px]:min-w-0">
                        <Typography variant="stat" component="div" className="leading-tight break-all @max-[200px]:text-xl">
                            {loading ? <Placeholder className="h-[0.8em] w-24"/> : displayValue(value, format, locale)}
                        </Typography>
                        {error
                            ? <Typography variant="caption" color="error" className="block mt-1 truncate" title={error.message}>{error.message}</Typography>
                            : compares && (
                                <div className="mt-1 leading-4">
                                    {loading ? <Placeholder className="h-3 w-12"/> : <KpiChange {...figure}/>}
                                </div>
                            )}
                    </div>
                    {trend && (
                        <div className="min-w-0 flex-1 max-w-20 @max-[200px]:hidden">
                            <Sparkline points={trend} tone={sparkTone(trend, figure)}/>
                        </div>
                    )}
                </div>
            </div>
        </Card>
    );
}

/** One figure as a line of text — label, value, change — for tight places like a home-page card. */
export function KpiReadout({ label, ...figure }: KpiProps) {
    const { locale } = useUiLabels();
    const { value, format, loading, error } = figure;

    return (
        <div className="flex items-baseline gap-1.5 min-w-0" title={error?.message}>
            <Typography variant="micro" color="secondary" className="truncate">{label}</Typography>
            {loading
                ? <Placeholder className="h-3 w-8"/>
                : (
                    <Typography variant="body1" component="span" className="font-semibold tabular-nums">
                        {displayValue(value, format, locale)}
                    </Typography>
                )}
            {!loading && <KpiChange {...figure} tooltip={false}/>}
        </div>
    );
}

/**
 * A grid of KPI tiles, two to four across as its own width allows — inside a
 * split panel or a narrow frame it stays at two however wide the window is.
 * Given `periodDays`, it names the window once above them ("Last 30 days")
 * rather than on every tile.
 *
 * The grid is a container, so a child that spans columns sizes itself with
 * container variants too: `col-span-2 @4xl:col-span-3`.
 */
export function KpiGrid({ periodDays, className, children }: {
    periodDays?: number;
    className?: string;
    children: React.ReactNode;
}) {
    const labels = useUiLabels();
    return (
        <section className={cls("@container w-full", className)}>
            {periodDays !== undefined && (
                <Typography variant="micro" color="secondary" component="h2" className="block py-1 mb-4">
                    {labels.lastDays(periodDays)}
                </Typography>
            )}
            <div className="grid grid-cols-2 @xl:grid-cols-3 @4xl:grid-cols-4 gap-4">
                {children}
            </div>
        </section>
    );
}
