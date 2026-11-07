import React from "react";
import { getIcon, useTranslation } from "@rebasepro/app";
import { cls, defaultBorderMixin, Tooltip, Typography } from "@rebasepro/ui";
import { describeChange, formatNumber, type ChangeTone } from "./numbers";

/** The comparison window a tile names when no `periodDays` is given. */
const DEFAULT_PERIOD_DAYS = 30;

const toneClasses: Record<ChangeTone, string> = {
    // The kit's error tier, and its success hue a step darker in light mode:
    // emerald-600 on the card is 3.8:1, under what 12px text needs.
    positive: "text-emerald-700 dark:text-emerald-400",
    negative: "text-red-600 dark:text-red-500",
    neutral: "text-text-secondary dark:text-text-secondary-dark"
};

/** A pulsing bar standing in for a figure that has not arrived, sized by its line box. */
export function Placeholder({ className }: { className: string }) {
    return <span className={cls("inline-block align-middle rounded-sm bg-surface-200 dark:bg-surface-700 animate-pulse", className)}/>;
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

function displayValue(value: KpiProps["value"], format: Intl.NumberFormatOptions | undefined, locale: string): string {
    if (typeof value === "number") return formatNumber(value, format, locale);
    if (typeof value === "string" && value !== "") return value;
    return "—";
}

/**
 * The change against the previous window: an arrow and its size, coloured by
 * whether it is good news. The arrow carries the direction, so it reads
 * without the colour.
 */
export function KpiChange({ value, previous, format, goodWhen, show, periodDays = DEFAULT_PERIOD_DAYS, tooltip = true }: Pick<KpiProps, "value" | "previous" | "format" | "goodWhen" | "show" | "periodDays"> & {
    tooltip?: boolean;
}) {
    const { t, i18n } = useTranslation();
    if (typeof value !== "number" || typeof previous !== "number") return null;

    const locale = i18n.language;
    const change = describeChange({ current: value, previous, goodWhen, show, format, locale });
    const arrow = change.direction === "up" ? "↑ " : change.direction === "down" ? "↓ " : "";
    const spoken = change.direction === "up"
        ? t("insights_change_up", { change: change.magnitude })
        : change.direction === "down"
            ? t("insights_change_down", { change: change.magnitude })
            : t("insights_change_none");
    const previousLabel = t("insights_previous_period_value", { count: periodDays, value: formatNumber(previous, format, locale) });

    const label = (
        <span className={cls("typography-mono text-xs font-medium whitespace-nowrap", toneClasses[change.tone])}>
            <span aria-hidden="true">{arrow + change.magnitude}</span>
            <span className="sr-only">{`${spoken}. ${previousLabel}`}</span>
        </span>
    );
    return tooltip ? <Tooltip title={previousLabel}>{label}</Tooltip> : label;
}

/**
 * One headline figure as a card: its label, its value and its change on the
 * previous window.
 *
 * The label renders before the figure arrives and only the figure pulses, so
 * nothing moves when the data lands.
 */
export function KpiTile({ label, icon, className, ...figure }: KpiProps & {
    /** An icon key, as `getIcon` takes it (`"DollarSign"`). */
    icon?: string;
    className?: string;
}) {
    const { i18n } = useTranslation();
    const { value, format, previous, loading, error } = figure;
    const iconNode = icon ? getIcon(icon, "text-text-secondary dark:text-text-secondary-dark", undefined, 14) : null;
    const compares = previous !== undefined;

    return (
        <div className={cls("@container rounded-xl bg-surface-card border min-w-0", defaultBorderMixin, className)}>
            <div className="flex flex-col min-w-0 h-full px-5 py-4 @max-[200px]:px-3.5 @max-[200px]:py-3">
                <div className="flex items-center gap-1.5 min-w-0 mb-2.5 @max-[200px]:mb-1">
                    {iconNode && <span className="shrink-0 flex items-center [&>svg]:size-3.5">{iconNode}</span>}
                    <Typography variant="micro" color="secondary" className="truncate">{label}</Typography>
                </div>
                <div className="typography-stat leading-tight break-all text-text-primary dark:text-text-primary-dark @max-[200px]:text-xl">
                    {loading ? <Placeholder className="h-[0.8em] w-24"/> : displayValue(value, format, i18n.language)}
                </div>
                {error
                    ? <Typography variant="caption" color="error" className="block mt-1 truncate" title={error.message}>{error.message}</Typography>
                    : compares && (
                        <div className="mt-1 leading-4">
                            {loading ? <Placeholder className="h-3 w-12"/> : <KpiChange {...figure}/>}
                        </div>
                    )}
            </div>
        </div>
    );
}

/** One figure as a line of text — label, value, change — for tight places like a home-page card. */
export function KpiReadout({ label, ...figure }: KpiProps) {
    const { i18n } = useTranslation();
    const { value, format, loading, error } = figure;

    return (
        <div className="flex items-baseline gap-1.5 min-w-0" title={error?.message}>
            <Typography variant="micro" color="secondary" className="truncate">{label}</Typography>
            {loading
                ? <Placeholder className="h-3 w-8"/>
                : (
                    <span className="text-sm font-semibold tabular-nums text-text-primary dark:text-text-primary-dark">
                        {displayValue(value, format, i18n.language)}
                    </span>
                )}
            {!loading && <KpiChange {...figure} tooltip={false}/>}
        </div>
    );
}

/**
 * A grid of KPI tiles. Given `periodDays`, it names the window once above
 * them ("Last 30 days") rather than on every tile.
 */
export function KpiGrid({ periodDays, className, children }: {
    periodDays?: number;
    className?: string;
    children: React.ReactNode;
}) {
    const { t } = useTranslation();
    return (
        <section className={cls("w-full", className)}>
            {periodDays !== undefined && (
                <Typography variant="micro" color="secondary" component="h2" className="block py-1 mb-4">
                    {t("insights_period_last_days", { count: periodDays })}
                </Typography>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                {children}
            </div>
        </section>
    );
}
