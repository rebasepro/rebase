import React from "react";
import type { InsightDefinition } from "../types";
import { InsightWidget } from "./InsightWidget";

/**
 * Renders compact insight readouts inside a home page collection card.
 * Injected via the `home.card.widget` slot.
 */
export function HomeCardInsightSlot({
    insights
}: {
    insights: InsightDefinition[];
}) {
    if (!insights || insights.length === 0) return null;

    // Text readouts, not tiles: they wrap at their own height.
    return (
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 mt-1.5">
            {insights.map((definition) => (
                <InsightWidget
                    key={definition.id}
                    definition={definition}
                    compact={true}
                />
            ))}
        </div>
    );
}

HomeCardInsightSlot.displayName = "HomeCardInsightSlot";
