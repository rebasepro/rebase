import React from "react";
import type { InsightDefinition } from "../types";
import { InsightWidget } from "./InsightWidget";

/**
 * Renders compact insight widgets inline within a home page collection card.
 * Injected via the `home.card.insight` slot.
 *
 * Designed for single-value scorecards (e.g., "Recent orders: 42").
 * Charts are technically supported but will render in compact mode.
 */
export function HomeCardInsightSlot({
    slug,
    insights,
    isDarkMode = false,
}: {
    slug: string;
    collection: unknown;
    context: unknown;
    insights: InsightDefinition[];
    isDarkMode?: boolean;
}) {
    if (!insights || insights.length === 0) return null;

    return (
        <div style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            marginTop: 8,
        }}>
            {insights.map((def) => (
                <InsightWidget
                    key={def.id}
                    definition={def}
                    collectionSlug={slug}
                    isDarkMode={isDarkMode}
                    compact={true}
                />
            ))}
        </div>
    );
}

HomeCardInsightSlot.displayName = "HomeCardInsightSlot";
