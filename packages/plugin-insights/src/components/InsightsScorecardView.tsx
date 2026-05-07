import React, { useEffect, useRef, useState } from "react";
import type { DataRow, ScorecardConfig, ScorecardFormat } from "../types";

function formatNumber(value: number, format?: ScorecardFormat): string {
    if (value === null || value === undefined) return "N/A";

    const options: Intl.NumberFormatOptions = {
        style: format?.style ?? "decimal",
        notation: format?.notation ?? "standard",
        maximumFractionDigits: format?.decimals ?? 1,
        minimumFractionDigits: format?.decimals ?? 1,
    };

    if (format?.style === "currency") {
        options.currency = format.currency ?? "USD";
    }

    let formatted = new Intl.NumberFormat("en-US", options).format(value);

    if (format?.showSign && value > 0) {
        formatted = "+" + formatted;
    }

    return formatted;
}

/**
 * Scorecard widget adapted from Dataki for the Rebase design system.
 *
 * Renders a single KPI metric with optional comparison value and icon.
 * Automatically scales typography based on container size via ResizeObserver.
 */
export function InsightsScorecardView({
    config,
    data,
    title,
    isDarkMode = false,
    compact = false,
}: {
    config: ScorecardConfig;
    data: DataRow;
    title: string;
    isDarkMode?: boolean;
    compact?: boolean;
}) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [containerWidth, setContainerWidth] = useState(300);

    useEffect(() => {
        if (!containerRef.current) return;
        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                setContainerWidth(entry.contentRect.width);
            }
        });
        observer.observe(containerRef.current);
        return () => observer.disconnect();
    }, []);

    const mainValue = data[config.value.field];
    const formattedValue = typeof mainValue === "number"
        ? formatNumber(mainValue, config.value.format)
        : String(mainValue ?? "N/A");

    // Comparison rendering
    let comparisonElement: React.ReactNode = null;
    if (config.comparison) {
        const comparisonValue = data[config.comparison.field];
        if (typeof comparisonValue === "number") {
            const formattedComparison = formatNumber(comparisonValue, config.comparison.format);
            const isPositive = comparisonValue > 0;
            const isNegative = comparisonValue < 0;

            let color = isDarkMode
                ? "rgba(255,255,255,0.5)"
                : "rgba(0,0,0,0.5)";
            if (config.comparison.intent === "increase_is_good") {
                if (isPositive) color = "#10B981";
                if (isNegative) color = "#EF4444";
            } else if (config.comparison.intent === "decrease_is_good") {
                if (isPositive) color = "#EF4444";
                if (isNegative) color = "#10B981";
            }

            comparisonElement = (
                <span style={{
                    color,
                    fontWeight: 500,
                    fontSize: compact ? "0.75rem" : "0.875rem",
                }}>
                    {formattedComparison}
                </span>
            );
        }
    }

    // Responsive typography
    const isSmall = compact || containerWidth < 200;
    const valueFontSize = isSmall ? "1.5rem" : containerWidth < 300 ? "2rem" : "2.5rem";
    const titleFontSize = isSmall ? "0.75rem" : "0.8125rem";

    return (
        <div
            ref={containerRef}
            className="rounded-lg flex flex-col"
            style={{
                padding: isSmall ? "12px 14px" : "16px 20px",
                backgroundColor: isDarkMode
                    ? "rgba(255,255,255,0.03)"
                    : "rgba(0,0,0,0.02)",
                border: isDarkMode
                    ? "1px solid rgba(255,255,255,0.06)"
                    : "1px solid rgba(0,0,0,0.06)",
                minWidth: 0,
            }}
        >
            {/* Title row */}
            <div style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: isSmall ? 4 : 8,
            }}>
                <span style={{
                    fontSize: titleFontSize,
                    fontWeight: 500,
                    color: isDarkMode
                        ? "rgba(255,255,255,0.55)"
                        : "rgba(0,0,0,0.55)",
                    lineHeight: 1.3,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                }}>
                    {title}
                </span>

                {config.icon && (
                    <span
                        className="material-symbols-outlined"
                        style={{
                            fontSize: isSmall ? 18 : 22,
                            color: isDarkMode
                                ? "rgba(255,255,255,0.3)"
                                : "rgba(0,0,0,0.2)",
                            marginLeft: 8,
                            flexShrink: 0,
                        }}
                    >
                        {config.icon}
                    </span>
                )}
            </div>

            {/* Main value */}
            <div style={{
                fontSize: valueFontSize,
                fontWeight: 700,
                lineHeight: 1.15,
                color: isDarkMode
                    ? "rgba(255,255,255,0.92)"
                    : "rgba(0,0,0,0.87)",
                letterSpacing: "-0.02em",
                wordBreak: "break-all",
            }}>
                {formattedValue}
            </div>

            {/* Comparison */}
            {comparisonElement && (
                <div style={{ marginTop: isSmall ? 2 : 4 }}>
                    {comparisonElement}
                </div>
            )}
        </div>
    );
}

InsightsScorecardView.displayName = "InsightsScorecardView";
