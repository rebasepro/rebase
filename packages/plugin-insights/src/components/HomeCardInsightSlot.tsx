import React from "react";
import type { InsightDefinition } from "../types";
import { InsightWidget } from "./InsightWidget";

/**
 * Renders compact insight widgets inline within a home page collection card.
 * Injected via the `home.card.insight` slot.
 *
 * Uses a horizontal flex layout so multiple cards sit side by side.
 */
export function HomeCardInsightSlot({
    slug,
    insights,
}: {
    slug: string;
    collection: unknown;
    context: unknown;
    insights: InsightDefinition[];
}) {
    if (!insights || insights.length === 0) return null;

    return (
        <div className="flex flex-wrap items-center gap-1.5 mt-2" style={{ minHeight: 46 }}>
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
