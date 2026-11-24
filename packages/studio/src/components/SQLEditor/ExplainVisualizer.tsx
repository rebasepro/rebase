import React, { useMemo, useState } from "react";
import { ChevronDownIcon, Chip, cls, Collapse, defaultBorderMixin, iconSize, Typography } from "@rebasepro/ui";
import { useTranslation } from "@rebasepro/app";
import { exclusiveTime, nodeBuffers, slowestNodes, type ExplainPlanNode, type ExplainResult } from "../../utils/explain_plan";

export type { ExplainPlanNode };

export interface ExplainVisualizerProps {
    result: ExplainResult;
}

/** Milliseconds as the plan view prints them: three significant places below ten. */
function formatMs(ms: number): string {
    return `${ms < 10 ? ms.toFixed(3) : ms.toFixed(1)} ms`;
}

/**
 * A plan, node by node. For a plan that ran (`ANALYZE`) each node says its
 * actual time, rows and loops and the buffers it touched, and the nodes that
 * took the most time of their own are marked, slowest first.
 */
export const ExplainVisualizer: React.FC<ExplainVisualizerProps> = ({ result }) => {
    const { t } = useTranslation();
    const slowest = useMemo(() => new Map(slowestNodes(result.plan).map((node, index) => [node, index + 1])), [result.plan]);
    const timed = result.executionTime ?? result.plan["Actual Total Time"];

    return (
        <div className="flex flex-col gap-3 p-4">
            {result.analyzed && (
                <div className="flex flex-wrap items-center gap-4">
                    {result.planningTime !== undefined && (
                        <Metric label={t("studio_sql_explain_planning_time")} value={formatMs(result.planningTime)}/>
                    )}
                    {result.executionTime !== undefined && (
                        <Metric label={t("studio_sql_explain_execution_time")} value={formatMs(result.executionTime)}/>
                    )}
                    {slowest.size > 0 && (
                        <Typography variant="caption" color="secondary">{t("studio_sql_explain_slowest_hint")}</Typography>
                    )}
                </div>
            )}
            <PlanNode node={result.plan} isRoot slowest={slowest} totalTime={timed}/>
        </div>
    );
};

function Metric({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
    return (
        <div className="flex flex-col text-right">
            <Typography variant="caption" color="disabled" className="leading-tight">{label}</Typography>
            <Typography variant="mono" className={cls("text-[13px] leading-tight", emphasis && "font-medium")}>{value}</Typography>
        </div>
    );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex items-center gap-2">
            <Typography variant="caption" color="disabled">{label}</Typography>
            <Typography variant="mono" className="text-[12px]">{children}</Typography>
        </div>
    );
}

function Condition({ label, text }: { label: string; text: string }) {
    return (
        <div className="flex flex-col gap-1">
            <Typography variant="caption" color="disabled">{label}</Typography>
            <Typography variant="mono" className="block w-full p-2 bg-surface-field rounded-md text-[12px] truncate" title={text}>{text}</Typography>
        </div>
    );
}

interface PlanNodeProps {
    node: ExplainPlanNode;
    isRoot?: boolean;
    /** The slowest nodes by their own time, and each one's rank. */
    slowest: Map<ExplainPlanNode, number>;
    /** The statement's whole time, which a node's share is of. */
    totalTime?: number;
}

const PlanNode: React.FC<PlanNodeProps> = ({ node, isRoot = false, slowest, totalTime }) => {
    const { t } = useTranslation();
    const [expanded, setExpanded] = useState(true);
    const hasChildren = (node.Plans?.length ?? 0) > 0;
    const analyzed = typeof node["Actual Total Time"] === "number";
    const rank = slowest.get(node);
    const own = analyzed ? exclusiveTime(node) : undefined;
    const share = own !== undefined && totalTime ? Math.min(100, (own / totalTime) * 100) : undefined;
    const buffers = nodeBuffers(node);
    const loops = node["Actual Loops"] ?? 1;
    // Rows per loop, as Postgres reports them, against the planner's estimate.
    const actualRows = node["Actual Rows"];
    const misestimate = actualRows !== undefined && node["Plan Rows"] > 0
        ? Math.max(actualRows, 1) / Math.max(node["Plan Rows"], 1)
        : undefined;
    const badEstimate = misestimate !== undefined && (misestimate > 10 || misestimate < 0.1);

    return (
        <div className={cls("flex flex-col", !isRoot && "pl-6 mt-2 relative")}>
            {!isRoot && <div className="absolute left-2.5 top-0 bottom-0 w-px bg-hairline"/>}
            {!isRoot && <div className="absolute left-2.5 top-5 w-3 h-px bg-hairline"/>}

            <div className={cls(
                "border rounded-xl bg-surface-card relative w-[480px] max-w-full",
                defaultBorderMixin,
                rank !== undefined && "ring-1 ring-orange-500/60"
            )}>
                <button
                    type="button"
                    className="w-full px-4 py-3 flex justify-between items-center gap-3 text-left select-none"
                    aria-expanded={expanded}
                    onClick={() => setExpanded(!expanded)}
                >
                    <div className="flex items-center gap-2 min-w-0">
                        {hasChildren
                            ? <ChevronDownIcon size={iconSize.smallest} className={cls("text-text-secondary transition-transform shrink-0", !expanded && "-rotate-90")}/>
                            : <span className="w-4 shrink-0"/>}
                        <Typography variant="body2" className="font-medium shrink-0">{node["Node Type"]}</Typography>
                        {node["Relation Name"] && (
                            <Typography variant="caption" color="secondary" className="font-mono truncate">
                                {t("studio_sql_explain_on_relation", {
                                    relation: node.Alias && node.Alias !== node["Relation Name"]
                                        ? `${node["Relation Name"]} (${node.Alias})`
                                        : node["Relation Name"]
                                })}
                            </Typography>
                        )}
                        {rank !== undefined && (
                            <Chip size="smallest" colorScheme="orangeLighter" className="shrink-0">
                                {t("studio_sql_explain_slowest_rank", { rank })}
                            </Chip>
                        )}
                    </div>
                    <div className="flex gap-5 items-center shrink-0">
                        {analyzed && own !== undefined
                            ? <Metric label={t("studio_sql_explain_own_time")} value={`${formatMs(own)}${share !== undefined ? ` · ${share.toFixed(0)}%` : ""}`} emphasis={rank !== undefined}/>
                            : <Metric label={t("studio_sql_explain_cost")} value={node["Total Cost"].toFixed(2)}/>}
                        <Metric
                            label={t("studio_sql_explain_rows")}
                            value={actualRows !== undefined ? `${actualRows} / ${node["Plan Rows"]}` : String(node["Plan Rows"])}
                        />
                    </div>
                </button>

                <Collapse in={expanded}>
                    <div className="px-4 py-3 border-t border-hairline flex flex-col gap-2">
                        <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
                            <Detail label={t("studio_sql_explain_cost")}>{`${node["Startup Cost"].toFixed(2)}..${node["Total Cost"].toFixed(2)}`}</Detail>
                            <Detail label={t("studio_sql_explain_width")}>{`${node["Plan Width"]} B`}</Detail>
                            {analyzed && (
                                <>
                                    <Detail label={t("studio_sql_explain_actual_time")}>{`${node["Actual Startup Time"]?.toFixed(3) ?? "0"}..${node["Actual Total Time"]?.toFixed(3)} ms`}</Detail>
                                    <Detail label={t("studio_sql_explain_loops")}>{loops}</Detail>
                                </>
                            )}
                            {node["Rows Removed by Filter"] !== undefined && (
                                <Detail label={t("studio_sql_explain_rows_removed")}>{node["Rows Removed by Filter"]}</Detail>
                            )}
                        </div>
                        {badEstimate && actualRows !== undefined && (
                            <Typography variant="caption" color="secondary">
                                {t("studio_sql_explain_misestimate", { planned: node["Plan Rows"], actual: actualRows })}
                            </Typography>
                        )}
                        {buffers && (
                            <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
                                <Detail label={t("studio_sql_explain_buffers_hit")}>{buffers.hit}</Detail>
                                <Detail label={t("studio_sql_explain_buffers_read")}>{buffers.read}</Detail>
                                {buffers.dirtied > 0 && <Detail label={t("studio_sql_explain_buffers_dirtied")}>{buffers.dirtied}</Detail>}
                                {buffers.written > 0 && <Detail label={t("studio_sql_explain_buffers_written")}>{buffers.written}</Detail>}
                                {buffers.temp > 0 && <Detail label={t("studio_sql_explain_buffers_temp")}>{buffers.temp}</Detail>}
                            </div>
                        )}
                        {node.Filter && <Condition label={t("studio_sql_explain_filter")} text={node.Filter}/>}
                        {node["Index Cond"] && <Condition label={t("studio_sql_explain_index_cond")} text={node["Index Cond"]}/>}
                        {node["Hash Cond"] && <Condition label={t("studio_sql_explain_hash_cond")} text={node["Hash Cond"]}/>}
                    </div>
                </Collapse>
            </div>

            {expanded && hasChildren && (
                <div className="flex flex-col">
                    {node.Plans!.map((child, index) => (
                        <PlanNode key={index} node={child} slowest={slowest} totalTime={totalTime}/>
                    ))}
                </div>
            )}
        </div>
    );
};
