import React from "react";
import { KpiReadout, KpiTile, type KpiProps } from "@rebasepro/ui";
import type { InsightDefinition } from "../types";
import type { SourceResult } from "../engine/InsightsEngine";
import { numberFormatOptions } from "../format";

/** The figure a definition reads from its source's record, in the kit's terms. */
function figureOf(
    definition: InsightDefinition,
    result: SourceResult | null,
    loading: boolean,
    error: Error | null
): KpiProps {
    const row = result?.row;
    const value = row?.[definition.value.field];
    const comparison = definition.comparison;
    const previous = comparison ? row?.[comparison.previous] : undefined;
    return {
        label: definition.title,
        value: typeof value === "number" || typeof value === "string" ? value : null,
        format: numberFormatOptions(definition.value.format),
        // `null` rather than `undefined` while there is nothing to compare, so
        // the tile keeps the change line's room and nothing moves when it lands.
        previous: comparison ? (typeof previous === "number" ? previous : null) : undefined,
        goodWhen: comparison?.intent === "decrease_is_good" ? "down" : "up",
        show: comparison?.show,
        periodDays: result?.period.days,
        loading,
        error: error ?? undefined
    };
}

/**
 * One insight: its label, its value and its change on the previous period.
 *
 * The label and icon are known before the figures are, so they render while
 * the source loads and only the figures pulse. Loading, loaded and failed
 * share one shell, so nothing moves when the data arrives.
 *
 * `compact` is the inline readout on a home-page card; the default is a tile.
 *
 * @deprecated Use `KpiTile` or `KpiReadout` from `@rebasepro/ui` instead.
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
    const figure = figureOf(definition, result, loading, error);
    return compact
        ? <KpiReadout {...figure}/>
        : <KpiTile icon={definition.icon} {...figure}/>;
}

InsightsScorecardView.displayName = "InsightsScorecardView";
