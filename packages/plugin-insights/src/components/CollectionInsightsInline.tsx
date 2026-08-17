import React from "react";
import type { InsightDefinition } from "../types";
import { InsightWidget } from "./InsightWidget";

/**
 * Renders scorecard insight widgets inline within a collection's list view,
 * positioned below the title and above the main data list.
 *
 * Injected via the `collection.widgets` slot.
 */
export function CollectionInsightsInline({
    insights,
    path,
    parentCollectionSlugs,
    parentEntityIds
}: {
    path: string;
    collection: unknown;
    parentCollectionSlugs: string[], parentEntityIds: string[];
    insights: InsightDefinition[];
}) {
    if (!insights || insights.length === 0) return null;

    return (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 pb-4">
            {insights.map((def) => (
                <InsightWidget
                    key={def.id}
                    definition={def}
                    path={path}
                    parentCollectionSlugs={parentCollectionSlugs} parentEntityIds={parentEntityIds}
                />
            ))}
        </div>
    );
}

CollectionInsightsInline.displayName = "CollectionInsightsInline";
