import { Sheet, IconButton, Tooltip } from "@rebasepro/ui";
import { PieChart, X } from "lucide-react";
import React, { useState } from "react";
import type { InsightDefinition } from "../types";
import { InsightWidget } from "./InsightWidget";

/**
 * Renders a toolbar button that toggles a drawer containing insight widgets.
 * Injected via the `collection.toolbar` slot.
 */
export function CollectionInsightsToolbarButton({
    path,
    insights,
}: {
    path: string;
    collection: unknown;
    parentCollectionIds: string[];
    insights: InsightDefinition[];
}) {
    const [open, setOpen] = useState(false);

    if (!insights || insights.length === 0) return null;

    const collectionSlug = path.split("/").filter(Boolean).pop() ?? path;

    return (
        <>
            <Tooltip title="View Insights">
                <IconButton onClick={() => setOpen(true)} size="medium">
                    <PieChart className="w-5 h-5" />
                </IconButton>
            </Tooltip>
            
            <Sheet
                open={open}
                onOpenChange={setOpen}
                side="right"
                title="Collection Insights"
                className="w-full sm:w-[400px] md:w-[500px] p-6 overflow-y-auto bg-surface-50 dark:bg-surface-950"
            >
                <div className="flex flex-col h-full">
                    <div className="flex justify-between items-center mb-6 border-b border-surface-200 dark:border-surface-800 pb-4">
                        <div className="flex items-center gap-2">
                            <PieChart className="w-5 h-5 text-primary-500" />
                            <h2 className="text-xl font-semibold text-surface-900 dark:text-white">Insights</h2>
                        </div>
                        <IconButton onClick={() => setOpen(false)} size="small">
                            <X className="w-4 h-4" />
                        </IconButton>
                    </div>
                    <div className="flex flex-col gap-6">
                        {insights.map((def) => (
                            <InsightWidget
                                key={def.id}
                                definition={def}
                                collectionSlug={collectionSlug}
                            />
                        ))}
                    </div>
                </div>
            </Sheet>
        </>
    );
}

CollectionInsightsToolbarButton.displayName = "CollectionInsightsToolbarButton";
