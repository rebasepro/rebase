import React from "react";

/**
 * Skeleton loader for insight widgets — displays animated shimmer lines
 * to provide visual feedback while data is loading.
 */
export function InsightWidgetSkeleton({
    type = "scorecard",
    compact = false,
    embedded = false,
}: {
    type?: "chart" | "scorecard";
    compact?: boolean;
    /** When true, skip own border since the parent card provides it. */
    embedded?: boolean;
}) {
    if (type === "chart") {
        return (
            <div
                className={embedded
                    ? "overflow-hidden animate-pulse h-full"
                    : `rounded-lg overflow-hidden animate-pulse bg-transparent border border-surface-200 dark:border-surface-800`
                }
                style={embedded ? undefined : { height: compact ? 120 : 200 }}
            >
                <div style={{
                    display: "flex",
                    alignItems: "flex-end",
                    justifyContent: "space-around",
                    height: "100%",
                    padding: "24px 16px 16px",
                    gap: 8,
                }}>
                    {[0.6, 0.85, 0.45, 0.72, 0.9, 0.55, 0.78].map((h, i) => (
                        <div
                            key={i}
                            className="bg-surface-200 dark:bg-surface-700"
                            style={{
                                flex: 1,
                                height: `${h * 100}%`,
                                borderRadius: 4,
                            }}
                        />
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div
            className={embedded
                ? `animate-pulse h-full ${compact ? "px-3.5 py-3" : "px-5 py-4"}`
                : `rounded-lg animate-pulse bg-transparent border border-surface-200 dark:border-surface-800 ${compact ? "px-3.5 py-3" : "px-5 py-4"}`
            }
        >
            {/* Title line */}
            <div className={`bg-surface-200 dark:bg-surface-700 ${compact ? "mb-2" : "mb-3"}`}
                style={{ height: 12, width: "60%", borderRadius: 6 }}
            />
            {/* Value line */}
            <div className={`bg-surface-200 dark:bg-surface-700 ${compact ? "mb-1" : "mb-2"}`}
                style={{ height: compact ? 24 : 32, width: "40%", borderRadius: 6 }}
            />
            {/* Comparison line */}
            <div className="bg-surface-200/80 dark:bg-surface-700/80"
                style={{ height: 10, width: "25%", borderRadius: 6 }}
            />
        </div>
    );
}

InsightWidgetSkeleton.displayName = "InsightWidgetSkeleton";
