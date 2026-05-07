import React, { useMemo } from "react";
import type { DashboardDefinition, InsightDefinition } from "../../types";
import { InsightWidget } from "../InsightWidget";
import { Typography, cls } from "@rebasepro/ui";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, LayoutDashboard } from "lucide-react";

/**
 * Default grid column spans per widget type when no explicit layout is given.
 */
const DEFAULT_SPANS: Record<string, number> = {
    scorecard: 3,
    chart: 6,
};

/**
 * Row height multiplier in px for each row unit.
 * Scorecards are compact (single row), charts need more vertical space.
 */
const ROW_HEIGHT = 140;

/**
 * Compute the minimum height for a widget based on its type and layout.
 */
function getWidgetMinHeight(widget: InsightDefinition, h?: number): number {
    if (widget.type === "scorecard") return ROW_HEIGHT;
    // Charts need at least 2 row heights worth of space
    return Math.max((h ?? 2) * ROW_HEIGHT, ROW_HEIGHT * 2);
}

/**
 * Renders a code-defined dashboard as a responsive CSS Grid of InsightWidgets.
 *
 * No Firestore, no complex state — just the `DashboardDefinition` rendered
 * directly from the config passed to `useInsightsPlugin`.
 */
export function CodeDashboardView({
    dashboard,
}: {
    dashboard: DashboardDefinition;
}) {
    const cols = dashboard.cols ?? 12;
    const navigate = useNavigate();

    // Separate scorecards from charts/other widgets for better grouping
    const { scorecards, charts } = useMemo(() => {
        const sc: Array<{ widget: InsightDefinition; layoutHint?: { x?: number; y?: number; w?: number; h?: number } }> = [];
        const ch: Array<{ widget: InsightDefinition; layoutHint?: { x?: number; y?: number; w?: number; h?: number } }> = [];

        for (const widget of dashboard.widgets) {
            const layoutHint = dashboard.layout?.[widget.id];
            if (widget.type === "scorecard") {
                sc.push({ widget, layoutHint });
            } else {
                ch.push({ widget, layoutHint });
            }
        }
        return { scorecards: sc, charts: ch };
    }, [dashboard]);

    return (
        <div className="min-h-full bg-surface-950">
            {/* ── Header ──────────────────────────────────────────── */}
            <div className="border-b border-surface-800 bg-surface-900/50 backdrop-blur-sm sticky top-0 z-10">
                <div className="max-w-[1600px] mx-auto px-6 py-4 flex items-center gap-4">
                    <button
                        onClick={() => navigate("/dashboards")}
                        className="shrink-0 w-8 h-8 rounded-lg bg-surface-800 hover:bg-surface-700 flex items-center justify-center text-surface-400 hover:text-surface-200 transition-colors cursor-pointer"
                    >
                        <ArrowLeft size={16} />
                    </button>
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className="shrink-0 w-9 h-9 rounded-lg bg-primary-500/10 flex items-center justify-center">
                            <LayoutDashboard size={18} className="text-primary-400" />
                        </div>
                        <div className="min-w-0">
                            <Typography variant="h6" className="font-semibold truncate !text-surface-100">
                                {dashboard.title}
                            </Typography>
                            {dashboard.description && (
                                <Typography
                                    variant="caption"
                                    className="text-surface-400 truncate block"
                                >
                                    {dashboard.description}
                                </Typography>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Dashboard body ─────────────────────────────────── */}
            <div className="max-w-[1600px] mx-auto px-6 py-6">
                {/* ── Scorecard row ────────────────────────────────── */}
                {scorecards.length > 0 && (
                    <div
                        className="grid gap-4 mb-6"
                        style={{
                            gridTemplateColumns: `repeat(${Math.min(scorecards.length, cols)}, 1fr)`,
                        }}
                    >
                        {scorecards.map(({ widget }) => (
                            <div
                                key={widget.id}
                                className="rounded-xl bg-surface-900 border border-surface-800 overflow-hidden"
                            >
                                <InsightWidget definition={widget} dashboard />
                            </div>
                        ))}
                    </div>
                )}

                {/* ── Chart widgets grid ────────────────────────────── */}
                {charts.length > 0 && (
                    <div
                        className="grid gap-4"
                        style={{
                            gridTemplateColumns: `repeat(${cols}, 1fr)`,
                        }}
                    >
                        {charts.map(({ widget, layoutHint }) => {
                            const span = layoutHint?.w ?? DEFAULT_SPANS[widget.type] ?? 6;
                            const minH = getWidgetMinHeight(widget, layoutHint?.h);

                            const style: React.CSSProperties = {
                                gridColumn: layoutHint?.x != null
                                    ? `${layoutHint.x + 1} / span ${span}`
                                    : `span ${Math.min(span, cols)}`,
                                height: minH,
                            };

                            return (
                                <div
                                    key={widget.id}
                                    className="rounded-xl bg-surface-900 border border-surface-800 overflow-hidden flex flex-col"
                                    style={style}
                                >
                                    <InsightWidget definition={widget} dashboard />
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}

CodeDashboardView.displayName = "CodeDashboardView";
