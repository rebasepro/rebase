import React from "react";
import type { InsightDefinition, DataRow, ScorecardConfig } from "../types";
import { useInsightsData } from "../engine/useInsightsData";
import { InsightsScorecardView } from "./InsightsScorecardView";
import { InsightWidgetSkeleton } from "./InsightWidgetSkeleton";

/**
 * Compute a deterministic fixed height for a standard scorecard based
 * on which optional elements the config declares.  This eliminates
 * layout shift between skeleton and loaded states.
 *
 * Breakdown (non-compact, non-small):
 *   py-4 padding:     16 + 16 = 32
 *   title row:        16.5  (text-xs leading-snug)
 *   mb-2 margin:      8
 *   value:            30    (text-2xl leading-tight)
 *   ---
 *   base:             86.5
 *   + dateRange:      +16   (14px text + 2px mt-0.5)
 *   + comparison:     +20   (16px text + 4px mt-1)
 */
function computeFixedHeight(config: ScorecardConfig): number {
    let h = 86.5; // base: padding + title + mb-2 + value
    if (config.dateRange) h += 16;
    if (config.comparison) h += 20;
    return Math.ceil(h);
}

/**
 * Single insight widget orchestrator.
 *
 * Wraps skeleton and loaded states in a fixed-height container
 * (computed from the scorecard config) to prevent layout shift.
 *
 * All theme-awareness is handled via Tailwind `dark:` classes.
 */
export function InsightWidget({
    definition,
    collectionSlug,
    path,
    parentCollectionSlugs, parentSnapshotIds,
    compact = false,
    embedded = false
}: {
    definition: InsightDefinition;
    collectionSlug?: string;
    path?: string;
    parentCollectionSlugs?: string[], parentSnapshotIds?: string[];
    compact?: boolean;
    /** When true, inner views skip their own borders since the parent card provides them. */
    embedded?: boolean;
}) {
    const { data, loading, error } = useInsightsData(definition, { path,
collectionSlug,
parentCollectionSlugs });

    // For non-compact, non-embedded standard scorecards, use a fixed height
    // derived from the config to prevent layout shift between skeleton → loaded.
    const fixedHeight = (!compact && !embedded) ? computeFixedHeight(definition.scorecard) : undefined;

    if (loading) {
        return <InsightWidgetSkeleton config={definition.scorecard} compact={compact} embedded={embedded} fixedHeight={fixedHeight} />;
    }

    if (error) {
        return (
            <div
                className={`text-red-500/70 dark:text-red-400/70 text-[0.8125rem] ${embedded ? "px-5 py-4 h-full" : `rounded-lg bg-red-500/5 dark:bg-red-400/5 border border-red-500/10 dark:border-red-400/10 ${compact ? "px-3.5 py-3" : "px-5 py-4"}`}`}
                style={fixedHeight ? { height: fixedHeight } : undefined}
            >
                <div className="font-semibold mb-1">{definition.title}</div>
                <div>{error.message}</div>
            </div>
        );
    }

    if (!data || data.rows.length === 0) {
        return (
            <div
                className={`text-surface-400 dark:text-surface-500 text-[0.8125rem] ${embedded ? "px-5 py-4 h-full" : `rounded-lg bg-surface-100 dark:bg-surface-800 border border-surface-200 dark:border-surface-700 ${compact ? "px-3.5 py-3" : "px-5 py-4"}`}`}
                style={fixedHeight ? { height: fixedHeight } : undefined}
            >
                {definition.title} — No data
            </div>
        );
    }

    return (
        <InsightsScorecardView
            config={definition.scorecard}
            data={data.rows[0] as DataRow}
            title={definition.title}
            compact={compact}
            embedded={embedded}
            fixedHeight={fixedHeight}
        />
    );
}

InsightWidget.displayName = "InsightWidget";
