import React, { forwardRef, useEffect, useRef, useState } from "react";
import embed, { VisualizationSpec } from "vega-embed";
import { HydratedChartConfig } from "../../types";
const useDashboardTheme = () => ({} as Record<string, unknown>);

const DEFAULT_FONT = "'Geist Sans', 'Rubik', 'Helvetica Neue', 'Helvetica', 'Arial', sans-serif";

/**
 * Default chart color palette — matches --dataki-chart-color-1 .. 10.
 */
const DEFAULT_CHART_PALETTE = [
    "#0070F4", "#FF5B79", "#10B981", "#F59E0B", "#8B5CF6",
    "#EC4899", "#06B6D4", "#F97316", "#14B8A6", "#6366F1"
];

/**
 * Detect whether a hydrated chart config is a full Vega v5 spec (vs Vega-Lite).
 */
function isFullVegaSpec(config: HydratedChartConfig): boolean {
    if (config.$schema?.includes("/vega/")) return true;
    if (Array.isArray(config.marks) || Array.isArray(config.scales)) return true;
    return false;
}

/**
 * Vega crashes with "Cannot read properties of null (reading 'marktype')"
 * when a color/fill/stroke encoding uses `"value": null` as a fallback.
 * Replace null shorthand values with "transparent" before passing to Vega.
 */
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

export const ChartView = forwardRef<HTMLDivElement, {
    config: HydratedChartConfig,
}>((
    {
        config,
    }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const embedResultRef = useRef<{ finalize: () => void } | null>(null);
    const [containerDimensions, setContainerDimensions] = useState({
        width: 0,
        height: 0
    });

    const theme = useDashboardTheme();

    useEffect(() => {
        if (!containerRef.current) return;

        const resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const {
                    width,
                    height
                } = entry.contentRect;
                setContainerDimensions({
                    width,
                    height
                });
            }
        });

        resizeObserver.observe(containerRef.current);

        return () => {
            resizeObserver.disconnect();
        };
    }, []);

    useEffect(() => {
        if (!containerRef.current || !config) return;
        if (containerDimensions.width === 0 || containerDimensions.height === 0) return;

        // Clean up previous chart
        if (embedResultRef.current) {
            embedResultRef.current = null;
        }

        // Resolve theme values — CSS vars can't be read by Vega directly,
        // so we read the resolved values from the theme context and fall back
        // to CSS-variable strings for the wrapper elements.
        const chartFont = theme.chartFontFamily || theme.fontFamily || DEFAULT_FONT;
        const textColor = theme.chartTextColor || "var(--dataki-chart-text-color)";
        const gridColor = theme.chartGridColor || "var(--dataki-chart-grid-color)";
        const chartBg = theme.chartBg || "transparent";
        const palette = theme.chartColorPalette ?? DEFAULT_CHART_PALETTE;

        const isVega = isFullVegaSpec(config);

        const hasExplicitWidth = config.width !== undefined;
        const hasExplicitHeight = config.height !== undefined;

        const effectiveWidth = isVega
            ? containerDimensions.width - 10
            : (hasExplicitWidth ? config.width! : containerDimensions.width);
        const effectiveHeight = isVega
            ? containerDimensions.height - 10
            : (hasExplicitHeight ? config.height! : containerDimensions.height);

        let themedConfig: VisualizationSpec;

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
                        labelFont: chartFont,
                        titleFont: chartFont,
                    },
                    text: {
                        font: chartFont,
                    },
                    ...(config.config || {})
                }
            } as VisualizationSpec;
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
                    view: {
                        stroke: "transparent"
                    },
                    axis: {
                        labelColor: config.config?.axis?.labelColor || textColor,
                        titleColor: config.config?.axis?.titleColor || textColor,
                        gridColor: config.config?.axis?.gridColor || gridColor,
                        domainColor: config.config?.axis?.domainColor || gridColor,
                        tickColor: config.config?.axis?.tickColor || gridColor,
                        labelFont: config.config?.axis?.labelFont || chartFont,
                        titleFont: config.config?.axis?.titleFont || chartFont,
                    },
                    legend: {
                        labelColor: config.config?.legend?.labelColor || textColor,
                        titleColor: config.config?.legend?.titleColor || textColor,
                        labelFont: config.config?.legend?.labelFont || chartFont,
                        titleFont: config.config?.legend?.titleFont || chartFont,
                    },
                    title: {
                        color: config.config?.title?.color || textColor,
                        font: config.config?.title?.font || chartFont,
                    },
                    ...config.config
                }
            } as VisualizationSpec;
        }

        embed(containerRef.current, sanitizeVegaSpec(themedConfig) as VisualizationSpec, {
            actions: false,
            renderer: "svg"
        })
            .then((result) => {
                embedResultRef.current = result;
            })
            .catch((error: Error) => {
                console.error("Error rendering chart:", error);
            });

        return () => {
            if (embedResultRef.current) {
                embedResultRef.current.finalize();
                embedResultRef.current = null;
            }
        };
    }, [config, containerDimensions.width, containerDimensions.height, theme]);

    return (
        <div
            ref={ref}
            className="rounded-xl w-full relative overflow-hidden"
            style={{
                flex: "1 1 auto",
                minHeight: 0,
                backgroundColor: "var(--dataki-widget-bg)",
                borderWidth: "var(--dataki-widget-border-width)",
                borderColor: "var(--dataki-widget-border-color)",
                borderStyle: "solid",
                borderRadius: "var(--dataki-widget-border-radius)",
                padding: "var(--dataki-widget-padding)",
                boxShadow: "var(--dataki-widget-shadow)",
            } as React.CSSProperties}
        >
            <div
                ref={containerRef}
                style={{
                    width: "100%",
                    height: "100%"
                }}
            />
        </div>
    );
});

ChartView.displayName = "ChartView";
