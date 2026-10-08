import React from "react";
import type { InsightDefinition } from "../types";
import { InsightsRow } from "./InsightsRow";

/**
 * Renders scorecard insight widgets inline within a collection's list view,
 * positioned below the title and above the main data list.
 *
 * Injected via the `collection.widgets` slot.
 */
export function CollectionInsightsInline({
    insights
}: {
    insights: InsightDefinition[];
}) {
    if (!insights || insights.length === 0) return null;

    return <InsightsRow insights={insights} className="pb-4"/>;
}

CollectionInsightsInline.displayName = "CollectionInsightsInline";
