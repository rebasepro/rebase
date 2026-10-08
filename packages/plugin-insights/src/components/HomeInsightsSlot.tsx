import React from "react";
import type { InsightDefinition } from "../types";
import { InsightsRow } from "./InsightsRow";

/**
 * Scorecard insights panel rendered at the top of the home page.
 * Injected via the `home.children.start` slot.
 */
export function HomeInsightsSlot({
    insights
}: {
    insights: InsightDefinition[];
}) {
    if (!insights || insights.length === 0) return null;

    return <InsightsRow insights={insights} className="mt-6 pb-2"/>;
}

HomeInsightsSlot.displayName = "HomeInsightsSlot";
