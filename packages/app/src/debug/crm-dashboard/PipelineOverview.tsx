import React from "react";
import {
    Typography,
    cls,
    Card,
    Button,
    Skeleton,
    Tooltip,
    Select,
    SelectItem,
    UsersIcon,
    ChevronRightIcon,
    SettingsIcon
} from "@rebasepro/ui";

/* ── Types ────────────────────────────────────────────── */

interface PipelineStage {
    stageKey: string;
    label: string;
    shortLabel: string;
    color: string;
    icon: string;
    sortOrder: number;
    isTerminal: boolean;
    isLostStage: boolean;
    count: number;
}

interface PipelineOption {
    id: string;
    name: string;
    isDefault: boolean;
    color: string;
}

export interface PipelineOverviewProps {
    loading: boolean;
    insights: {
        pipelines: PipelineOption[];
    } | null;
    selectedPipelineId: string | null;
    onPipelineChange: (newPipelineId: string) => void;
    onNavigate: (path: string) => void;
    sortedStages: PipelineStage[];
    activeStages: PipelineStage[];
    closedStages: PipelineStage[];
    totalInPipeline: number;
    resolveColor: (colorName: string) => string;
}

/* ── Component ────────────────────────────────────────── */

export function PipelineOverview({
    loading,
    insights,
    selectedPipelineId,
    onPipelineChange,
    onNavigate,
    sortedStages,
    activeStages,
    closedStages,
    totalInPipeline,
    resolveColor
}: PipelineOverviewProps) {
    const useShortLabels = sortedStages.length > 6;
    const needsScroll = sortedStages.length > 10;

    return (
        <Card className="p-4 mb-6">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                    <Typography variant="subtitle1">
                        Pipeline{!loading && totalInPipeline > 0 ? ` (${totalInPipeline} clients)` : ""}
                    </Typography>

                    {/* Pipeline selector — using @rebasepro/ui Select */}
                    {insights && insights.pipelines.length > 1 && (
                        <Select
                            value={selectedPipelineId ?? ""}
                            onValueChange={(v) => onPipelineChange(v as string)}
                            size="smallest"
                            renderValue={(v) => {
                                const selected = insights.pipelines.find(p => p.id === v);
                                return selected ? selected.name : "Pipeline";
                            }}
                            position="popper"
                        >
                            {insights.pipelines.map(p => (
                                <SelectItem key={p.id} value={p.id}>
                                    {p.name}
                                </SelectItem>
                            ))}
                        </Select>
                    )}
                </div>
                <Button
                    variant="text"
                    size="small"
                    onClick={() => { onNavigate('/c/engagements'); }}
                    endIcon={<ChevronRightIcon className="h-4 w-4" />}
                >
                    View All
                </Button>
            </div>

            {loading ? (
                <Skeleton className="h-20 w-full rounded-lg" />
            ) : insights && sortedStages.length === 0 ? (
                /* No stages configured */
                <div className="flex flex-col items-center justify-center py-8">
                    <div className="flex items-center justify-center w-5 h-5 text-surface-400 dark:text-surface-500 mb-3">
                        <SettingsIcon className="h-4 w-4" />
                    </div>
                    <Typography variant="body2" color="secondary" className="mb-1">
                        No pipeline stages configured
                    </Typography>
                    <Typography variant="caption" color="disabled" className="mb-4 text-center">
                        Set up your pipeline stages in Settings → Pipeline Stages
                    </Typography>
                    <Button
                        variant="outlined"
                        size="small"
                        onClick={() => onNavigate('/pipeline-builder')}
                    >
                        Configure Stages
                    </Button>
                </div>
            ) : insights && totalInPipeline === 0 ? (
                /* No clients in pipeline */
                <div className="flex flex-col items-center justify-center py-8">
                    <div className="flex items-center justify-center w-5 h-5 text-surface-400 dark:text-surface-500 mb-3">
                        <UsersIcon className="h-4 w-4" />
                    </div>
                    <Typography variant="body2" color="secondary" className="mb-1">
                        No clients in pipeline yet
                    </Typography>
                    <Typography variant="caption" color="disabled" className="mb-4">
                        Create your first client to get started.
                    </Typography>
                </div>
            ) : insights ? (
                /* Pipeline bar */
                <div className="relative">
                    {needsScroll && (
                        <>
                            <div className="absolute left-0 top-0 bottom-0 w-6 bg-gradient-to-r from-white dark:from-surface-900 to-transparent z-10 pointer-events-none rounded-l-lg" />
                            <div className="absolute right-0 top-0 bottom-0 w-6 bg-gradient-to-l from-white dark:from-surface-900 to-transparent z-10 pointer-events-none rounded-r-lg" />
                        </>
                    )}
                    <div className={cls(
                        "flex items-stretch gap-0",
                        needsScroll && "overflow-x-auto"
                    )}>
                        {/* Active stages */}
                        {activeStages.map((stage, idx) => {
                            const isEmpty = stage.count === 0;
                            const widthPercent = totalInPipeline > 0
                                ? Math.max(8, (stage.count / totalInPipeline) * 100)
                                : 100 / Math.max(activeStages.length, 1);
                            const stageColor = resolveColor(stage.color);
                            const displayLabel = useShortLabels ? stage.shortLabel : stage.label;

                            return (
                                <React.Fragment key={stage.stageKey}>
                                    {idx > 0 && (
                                        <div className="flex items-center shrink-0 text-surface-300 dark:text-surface-600 -mx-0.5">
                                            <ChevronRightIcon className="h-4 w-4" />
                                        </div>
                                    )}
                                    <Tooltip title={`${stage.label} — ${stage.count} client${stage.count !== 1 ? "s" : ""}`}>
                                        <div
                                            className={cls(
                                                "flex flex-col items-center justify-center rounded-lg px-3 py-3 min-w-[72px] transition-colors duration-150 cursor-pointer",
                                                "hover:bg-surface-accent-100 dark:hover:bg-surface-800",
                                                isEmpty
                                                    ? "bg-surface-50 dark:bg-surface-900/20"
                                                    : "bg-surface-100/50 dark:bg-surface-900/60"
                                            )}
                                            style={{ flex: `${widthPercent} 1 0%` }}
                                            onClick={() => onNavigate(`/c/engagements?stage=${stage.stageKey}`)}
                                        >
                                            <Typography
                                                variant="h6"
                                                className={cls(
                                                    "tabular-nums leading-none font-semibold",
                                                    isEmpty && "opacity-25"
                                                )}
                                            >
                                                {stage.count}
                                            </Typography>
                                            <div className="flex items-center gap-1.5 mt-1.5">
                                                <span
                                                    className="w-1.5 h-1.5 rounded-full shrink-0"
                                                    style={{
                                                        backgroundColor: stageColor,
                                                        opacity: isEmpty ? 0.25 : 1
                                                    }}
                                                />
                                                <Typography
                                                    variant="caption"
                                                    color="secondary"
                                                    className={cls(
                                                        "whitespace-nowrap text-[11px]",
                                                        isEmpty && "opacity-35"
                                                    )}
                                                >
                                                    {displayLabel}
                                                </Typography>
                                            </div>
                                        </div>
                                    </Tooltip>
                                </React.Fragment>
                            );
                        })}

                        {/* Separator between active and closed stages */}
                        {activeStages.length > 0 && closedStages.length > 0 && (
                            <div className="flex items-center shrink-0 mx-2">
                                <div className="w-px h-8 bg-surface-200 dark:bg-surface-700" />
                            </div>
                        )}

                        {/* Closed / terminal stages — muted styling */}
                        {closedStages.map((stage, idx) => {
                            const isEmpty = stage.count === 0;
                            const stageColor = resolveColor(stage.color);
                            const displayLabel = useShortLabels ? stage.shortLabel : stage.label;

                            return (
                                <React.Fragment key={stage.stageKey}>
                                    {idx > 0 && (
                                        <div className="flex items-center shrink-0 text-surface-300 dark:text-surface-600 -mx-0.5">
                                            <ChevronRightIcon className="h-4 w-4" />
                                        </div>
                                    )}
                                    <Tooltip title={`${stage.label} — ${stage.count} client${stage.count !== 1 ? "s" : ""}`}>
                                        <div
                                            className={cls(
                                                "flex flex-col items-center justify-center rounded-lg px-3 py-3 min-w-[72px] transition-colors duration-150 cursor-pointer",
                                                "hover:bg-surface-accent-100 dark:hover:bg-surface-800",
                                                "opacity-60",
                                                isEmpty
                                                    ? "bg-surface-50 dark:bg-surface-900/10"
                                                    : "bg-surface-100/30 dark:bg-surface-900/30"
                                            )}
                                            style={{ flex: "0 0 auto" }}
                                            onClick={() => onNavigate(`/c/engagements?stage=${stage.stageKey}`)}
                                        >
                                            <Typography
                                                variant="h6"
                                                className={cls(
                                                    "tabular-nums leading-none font-semibold",
                                                    isEmpty && "opacity-25"
                                                )}
                                            >
                                                {stage.count}
                                            </Typography>
                                            <div className="flex items-center gap-1.5 mt-1.5">
                                                <span
                                                    className="w-1.5 h-1.5 rounded-full shrink-0"
                                                    style={{
                                                        backgroundColor: stageColor,
                                                        opacity: isEmpty ? 0.25 : 1
                                                    }}
                                                />
                                                <Typography
                                                    variant="caption"
                                                    color="secondary"
                                                    className={cls(
                                                        "whitespace-nowrap text-[11px]",
                                                        isEmpty && "opacity-35"
                                                    )}
                                                >
                                                    {displayLabel}
                                                </Typography>
                                            </div>
                                        </div>
                                    </Tooltip>
                                </React.Fragment>
                            );
                        })}
                    </div>
                </div>
            ) : null}
        </Card>
    );
}
