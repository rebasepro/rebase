import React from "react";
import type { InsightDefinition } from "../types";
import { InsightWidget } from "./InsightWidget";

/**
 * Renders compact insight widgets inline within a home page collection card.
 * Injected via the `home.card.widget` slot.
 *
 * Uses a horizontal flex layout so multiple cards sit side by side.
 */
export function HomeCardInsightSlot({
    slug,
    insights
}: {
    slug: string;
    collection: unknown;
    context: unknown;
    insights: InsightDefinition[];
}) {
    if (!insights || insights.length === 0) return null;

    // Text readouts, not tiles: they wrap at their own height. The old
    // estimated minHeight (42px a row) is what kept every card on the home
    // page tall and empty.
    return (
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 mt-1.5">
            {insights.map((def) => (
                <InsightWidget
                    key={def.id}
                    definition={def}
                    collectionSlug={slug}
                    compact={true}
                />
            ))}
        </div>
    );
}

HomeCardInsightSlot.displayName = "HomeCardInsightSlot";
