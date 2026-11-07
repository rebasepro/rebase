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

/**
 * One headline figure as a card: its label, its value and its change on the
 * previous window.
 *
 * The label renders before the figure arrives and only the figure shimmers,
 * so nothing moves when the data lands. Below 200px of its own width the
 * tile tightens its padding and its figure.
 */
export function KpiTile({ label, icon, className, ...figure }: KpiProps & {
    /** A Lucide icon name (`"DollarSign"`) or an icon element, drawn before the label. */
    icon?: string | React.ReactNode;
    className?: string;
}) {
    const { locale } = useUiLabels();
    const { value, format, previous, loading, error } = figure;
    const compares = previous !== undefined;

    return (
        <Card className={cls("@container min-w-0", className)}>
            <div className="flex flex-col min-w-0 h-full px-5 py-4 @max-[200px]:px-3.5 @max-[200px]:py-3">
                <div className="flex items-center gap-1.5 min-w-0 mb-2.5 @max-[200px]:mb-1">
                    <HeaderIcon icon={icon}/>
                    <Typography variant="micro" color="secondary" className="truncate">{label}</Typography>
                </div>
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
