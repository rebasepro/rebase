import React from "react";
import { getIcon, useTranslation } from "@rebasepro/app";
import { cls, defaultBorderMixin, Tooltip, Typography } from "@rebasepro/ui";
import type { DataRow, InsightDefinition, InsightPeriod } from "../types";
import type { SourceResult } from "../engine/InsightsEngine";
import { changeTone, formatChange, formatValue, type ChangeTone } from "../format";

const toneClasses: Record<ChangeTone, string> = {
    // The kit's error tier, and its success hue a step darker in light mode:
    // emerald-600 on the card is 3.8:1, under what 12px text needs.
    positive: "text-emerald-700 dark:text-emerald-400",
    negative: "text-red-600 dark:text-red-500",
    neutral: "text-text-secondary dark:text-text-secondary-dark"
};

/** A pulsing bar standing in for a figure that has not arrived, sized by its line box. */
function Placeholder({ className }: { className: string }) {
    return <span className={cls("inline-block align-middle rounded-sm bg-surface-200 dark:bg-surface-700 animate-pulse", className)}/>;
}

function displayValue(row: DataRow | undefined, definition: InsightDefinition, locale: string): string {
    const value = row?.[definition.value.field];
    if (typeof value === "number") return formatValue(value, definition.value.format, locale);
    if (typeof value === "string" && value !== "") return value;
    return "—";
}

/**
 * The change against the previous period: an arrow and its size, coloured by
 * whether it is good news. The arrow is what carries the direction, so it
 * reads without the colour.
 */
function InsightChange({
    definition,
    row,
    period,
    locale,
    tooltip
}: {
    definition: InsightDefinition;
    row: DataRow;
    period: InsightPeriod;
    locale: string;
    tooltip: boolean;
}) {
    const { t } = useTranslation();
    const comparison = definition.comparison;
    if (!comparison) return null;

    const current = row[definition.value.field];
    const previous = row[comparison.previous];
    if (typeof current !== "number" || typeof previous !== "number") return null;

    const change = formatChange(current, previous, comparison, definition.value.format, locale);
    const arrow = change.direction === "up" ? "↑" : change.direction === "down" ? "↓" : null;
    const spoken = change.direction === "up"
        ? t("insights_change_up", { change: change.magnitude })
        : change.direction === "down"
            ? t("insights_change_down", { change: change.magnitude })
            : t("insights_change_none");
    const previousLabel = t("insights_previous_period_value", {
        count: period.days,
        value: formatValue(previous, definition.value.format, locale)
    });

    const label = (
        <span className={cls("typography-mono text-xs font-medium whitespace-nowrap", toneClasses[changeTone(change.direction, comparison.intent)])}>
            <span aria-hidden="true">{arrow ? `${arrow} ${change.magnitude}` : change.magnitude}</span>
            <span className="sr-only">{`${spoken}. ${previousLabel}`}</span>
        </span>
    );

    return tooltip ? <Tooltip title={previousLabel}>{label}</Tooltip> : label;
}

/**
 * One insight: its label, its value and its change on the previous period.
 *
 * The label and icon are known before the figures are, so they render while
 * the source loads and only the figures pulse. Loading, loaded and failed
 * share one shell, so nothing moves when the data arrives.
 *
 * `compact` is the inline readout on a home-page card; the default is a tile.
 */
export function InsightsScorecardView({
    definition,
    result,
    loading = false,
    error = null,
    compact = false
}: {
    definition: InsightDefinition;
    /** The source's record and the period it was fetched for. */
    result: SourceResult | null;
    loading?: boolean;
    error?: Error | null;
    compact?: boolean;
}) {
    const { i18n } = useTranslation();
    const locale = i18n.language;
    const row = result?.row;
    const value = displayValue(row, definition, locale);

    if (compact) {
        return (
            <div className="flex items-baseline gap-1.5 min-w-0" title={error?.message}>
                <Typography variant="micro" color="secondary" className="truncate">
                    {definition.title}
                </Typography>
                {loading
                    ? <Placeholder className="h-3 w-8"/>
                    : (
                        <span className="text-sm font-semibold tabular-nums text-text-primary dark:text-text-primary-dark">
                            {value}
                        </span>
                    )}
                {!loading && row && result && (
                    <InsightChange definition={definition} row={row} period={result.period} locale={locale} tooltip={false}/>
                )}
            </div>
        );
    }

    const icon = definition.icon
        ? getIcon(definition.icon, "text-text-secondary dark:text-text-secondary-dark", undefined, 14)
        : null;

    return (
        // A card on the sheet: one step up and a hairline, like every other card.
        <div className={cls("@container rounded-xl bg-surface-card border min-w-0", defaultBorderMixin)}>
            <div className="flex flex-col min-w-0 h-full px-5 py-4 @max-[200px]:px-3.5 @max-[200px]:py-3">
                {/* The card header grammar the reference page documents: a small
                    icon in the secondary tier, then the label in the micro tier. */}
                <div className="flex items-center gap-1.5 min-w-0 mb-2.5 @max-[200px]:mb-1">
                    {icon && (
                        <span className="shrink-0 flex items-center text-text-secondary dark:text-text-secondary-dark [&>svg]:size-3.5">{icon}</span>
                    )}
                    <Typography variant="micro" color="secondary" className="truncate">
                        {definition.title}
                    </Typography>
                </div>

                <div className="typography-stat leading-tight break-all text-text-primary dark:text-text-primary-dark @max-[200px]:text-xl">
                    {loading ? <Placeholder className="h-[0.8em] w-24"/> : value}
                </div>

                {error
                    ? (
                        <Typography variant="caption" color="error" className="block mt-1 truncate" title={error.message}>
                            {error.message}
                        </Typography>
                    )
                    : definition.comparison && (
                        <div className="mt-1 leading-4">
                            {loading || !row || !result
                                ? <Placeholder className="h-3 w-12"/>
                                : <InsightChange definition={definition} row={row} period={result.period} locale={locale} tooltip={true}/>}
                        </div>
                    )}
            </div>
        </div>
    );
}

InsightsScorecardView.displayName = "InsightsScorecardView";
