import React from "react";
import type { InsightDefinition, DataRow } from "../types";
import { useInsightsData } from "../engine/useInsightsData";
import { InsightsScorecardView } from "./InsightsScorecardView";
import { InsightWidgetSkeleton } from "./InsightWidgetSkeleton";

/**
 * Single insight widget orchestrator.
 *
 * Fetches data via the engine, renders the scorecard visualization,
 * and manages loading/error states.
 *
 * All theme-awareness is handled via Tailwind `dark:` classes.
 */
export function InsightWidget({
    definition,
    collectionSlug,
    path,
    parentCollectionSlugs, parentEntityIds,
    compact = false,
    embedded = false,
}: {
    definition: InsightDefinition;
    collectionSlug?: string;
    path?: string;
    parentCollectionSlugs?: string[], parentEntityIds?: string[];
    compact?: boolean;
    /** When true, inner views skip their own borders since the parent card provides them. */
    embedded?: boolean;
}) {
    const { data, loading, error } = useInsightsData(definition, { path, collectionSlug, parentCollectionSlugs });

    if (loading) {
        return <InsightWidgetSkeleton config={definition.scorecard} compact={compact} embedded={embedded} />;
    }

    if (error) {
        return (
            <div
                className={`text-red-500/70 dark:text-red-400/70 text-[0.8125rem] ${embedded ? "px-5 py-4 h-full" : `rounded-lg bg-red-500/5 dark:bg-red-400/5 border border-red-500/10 dark:border-red-400/10 ${compact ? "px-3.5 py-3" : "px-5 py-4"}`}`}
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
        />
    );
}

InsightWidget.displayName = "InsightWidget";
