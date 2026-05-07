import React, { useEffect, useRef, useState } from "react";
import type { HydratedChartConfig } from "../types";

const DEFAULT_FONT = "'Inter', 'Helvetica Neue', 'Helvetica', 'Arial', sans-serif";

const DEFAULT_CHART_PALETTE = [
    "#6366F1", "#EC4899", "#10B981", "#F59E0B", "#8B5CF6",
    "#0EA5E9", "#F97316", "#14B8A6", "#E11D48", "#06B6D4"
];

function isFullVegaSpec(config: HydratedChartConfig): boolean {
    if (config.$schema?.includes("/vega/")) return true;
    if (Array.isArray(config.marks) || Array.isArray(config.scales)) return true;
    return false;
}

function sanitizeVegaSpec(obj: unknown): unknown {
    if (Array.isArray(obj)) return obj.map(sanitizeVegaSpec);
    if (obj !== null && typeof obj === "object") {
        const record = obj as Record<string, unknown>;
        const out: Record<string, unknown> = {};
        for (const key of Object.keys(record)) {
            if (key === "value" && record[key] === null) {
                out[key] = "transparent";
            } else {
                out[key] = sanitizeVegaSpec(record[key]);
            }
        }
        return out;
    }
    return obj;
}

/**
 * Chart widget adapted from Dataki's ChartView for the Rebase design system.
 *
 * Uses dynamic `import("vega-embed")` for chunk-loading — the vega dependency
 * is only downloaded when a chart widget is actually rendered.
 *
 * Reads Rebase's dark/light mode to inject matching axis colors, text colors,
 * and transparent backgrounds that blend with the admin surface.
 */
export function InsightsChartView({
    config,
    isDarkMode = false,
}: {
    config: HydratedChartConfig;
    isDarkMode?: boolean;
}) {
    const containerRef = useRef<HTMLDivElement>(null);
    const embedResultRef = useRef<{ finalize: () => void } | null>(null);
    const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

    // ResizeObserver for responsive sizing
    useEffect(() => {
        if (!containerRef.current) return;
        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const { width, height } = entry.contentRect;
                setDimensions({ width, height });
            }
        });
        observer.observe(containerRef.current);
        return () => observer.disconnect();
    }, []);

    // Render chart via vega-embed (dynamic import for code-splitting)
    useEffect(() => {
        if (!containerRef.current || !config) return;
        if (dimensions.width === 0 || dimensions.height === 0) return;

        // Cleanup previous render
        if (embedResultRef.current) {
            embedResultRef.current.finalize();
            embedResultRef.current = null;
        }

        const textColor = isDarkMode
            ? "rgba(255,255,255,0.72)"
            : "rgba(0,0,0,0.72)";
        const gridColor = isDarkMode
            ? "rgba(255,255,255,0.08)"
            : "rgba(0,0,0,0.08)";
        const chartBg = "transparent";
        const palette = DEFAULT_CHART_PALETTE;

        const isVega = isFullVegaSpec(config);

        const effectiveWidth = dimensions.width - 10;
        const effectiveHeight = dimensions.height - 10;

        let themedConfig: Record<string, unknown>;

        if (isVega) {
            themedConfig = {
                ...config,
                width: effectiveWidth,
                height: effectiveHeight,
                autosize: "none",
                background: chartBg,
                config: {
                    background: chartBg,
                    range: { category: palette },
                    axis: {
                        labelColor: textColor,
                        titleColor: textColor,
                        gridColor,
                        domainColor: gridColor,
                        tickColor: gridColor,
                        labelFont: DEFAULT_FONT,
                        titleFont: DEFAULT_FONT,
                    },
                    text: { font: DEFAULT_FONT },
                    ...(config.config || {})
                }
            };
        } else {
            themedConfig = {
                ...config,
                autosize: {
                    type: "fit",
                    contains: "padding",
                    ...(typeof config.autosize === "object" ? config.autosize : {})
                },
                ...(effectiveWidth > 0 ? { width: effectiveWidth } : {}),
                ...(effectiveHeight > 0 ? { height: effectiveHeight } : {}),
                config: {
                    background: chartBg,
                    range: { category: palette },
                    view: { stroke: "transparent" },
                    axis: {
                        labelColor: textColor,
                        titleColor: textColor,
                        gridColor,
                        domainColor: gridColor,
                        tickColor: gridColor,
                        labelFont: DEFAULT_FONT,
                        titleFont: DEFAULT_FONT,
                    },
                    legend: {
                        labelColor: textColor,
                        titleColor: textColor,
                        labelFont: DEFAULT_FONT,
                        titleFont: DEFAULT_FONT,
                    },
                    title: {
                        color: textColor,
                        font: DEFAULT_FONT,
                    },
                    ...config.config
                }
            };
        }

        // Dynamic import for chunk-loading — vega-embed is only fetched when needed
        import("vega-embed")
            .then(({ default: embed }) => {
                if (!containerRef.current) return;
                return embed(
                    containerRef.current,
                    sanitizeVegaSpec(themedConfig) as Parameters<typeof embed>[1],
                    { actions: false, renderer: "svg" }
                );
            })
            .then((result) => {
                if (result) embedResultRef.current = result;
            })
            .catch((error: Error) => {
                console.error("[plugin-insights] Error rendering chart:", error);
            });

        return () => {
            if (embedResultRef.current) {
                embedResultRef.current.finalize();
                embedResultRef.current = null;
            }
        };
    }, [config, dimensions.width, dimensions.height, isDarkMode]);

    return (
        <div
            className="w-full relative overflow-hidden rounded-lg"
            style={{
                flex: "1 1 auto",
                minHeight: 0,
                backgroundColor: isDarkMode
                    ? "rgba(255,255,255,0.03)"
                    : "rgba(0,0,0,0.02)",
                border: isDarkMode
                    ? "1px solid rgba(255,255,255,0.06)"
                    : "1px solid rgba(0,0,0,0.06)",
            }}
        >
            <div
                ref={containerRef}
                style={{ width: "100%", height: "100%" }}
            />
        </div>
    );
}

InsightsChartView.displayName = "InsightsChartView";
