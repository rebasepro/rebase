import React from "react";

/**
 * Skeleton loader for insight widgets — displays animated shimmer lines
 * to provide visual feedback while data is loading.
 */
export function InsightWidgetSkeleton({
    type = "scorecard",
    compact = false,
}: {
    type?: "chart" | "scorecard";
    compact?: boolean;
}) {
    if (type === "chart") {
        return (
            <div
                className="rounded-lg overflow-hidden animate-pulse"
                style={{
                    height: compact ? 120 : 200,
                    background: "var(--skeleton-bg, rgba(128,128,128,0.08))",
                }}
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
                            style={{
                                flex: 1,
                                height: `${h * 100}%`,
                                borderRadius: 4,
                                background: "rgba(128,128,128,0.12)",
                            }}
                        />
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div
            className="rounded-lg animate-pulse"
            style={{
                padding: compact ? "12px 14px" : "16px 20px",
                background: "var(--skeleton-bg, rgba(128,128,128,0.08))",
            }}
        >
            {/* Title line */}
            <div style={{
                height: 12,
                width: "60%",
                borderRadius: 6,
                background: "rgba(128,128,128,0.12)",
                marginBottom: compact ? 8 : 12,
            }} />
            {/* Value line */}
            <div style={{
                height: compact ? 24 : 32,
                width: "40%",
                borderRadius: 6,
                background: "rgba(128,128,128,0.12)",
                marginBottom: compact ? 4 : 8,
            }} />
            {/* Comparison line */}
            <div style={{
                height: 10,
                width: "25%",
                borderRadius: 6,
                background: "rgba(128,128,128,0.10)",
            }} />
        </div>
    );
}

InsightWidgetSkeleton.displayName = "InsightWidgetSkeleton";
