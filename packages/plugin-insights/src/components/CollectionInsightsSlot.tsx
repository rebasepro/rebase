import React from "react";
import type { InsightDefinition } from "../types";
import { InsightWidget } from "./InsightWidget";

/**
 * Renders a grid of insight widgets above a collection table.
 * Injected via the `collection.insights` slot.
 *
 * Receives the collection slug from slot props and looks up
 * matching insight definitions from the plugin configuration.
 */
export function CollectionInsightsSlot({
    path,
    insights,
    isDarkMode = false,
}: {
    path: string;
    collection: unknown;
    parentCollectionIds: string[];
    insights: InsightDefinition[];
    isDarkMode?: boolean;
}) {
    if (!insights || insights.length === 0) return null;

    // Extract the collection slug from the path (last segment)
    const collectionSlug = path.split("/").filter(Boolean).pop() ?? path;

    return (
        <div style={{
            display: "grid",
            gridTemplateColumns: `repeat(auto-fill, minmax(${insights.some(i => i.type === "chart") ? "280px" : "200px"}, 1fr))`,
            gap: 12,
            padding: "12px 0",
        }}>
            {insights.map((def) => (
                <InsightWidget
                    key={def.id}
                    definition={def}
                    collectionSlug={collectionSlug}
                    isDarkMode={isDarkMode}
                />
            ))}
        </div>
    );
}

CollectionInsightsSlot.displayName = "CollectionInsightsSlot";
