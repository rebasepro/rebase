import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import {
    Alert,
    Button,
    Chip,
    CheckCircle2Icon,
    cls,
    defaultBorderMixin,
    ExternalLinkIcon,
    IconButton,
    iconSize,
    RefreshCwIcon,
    TableIcon,
    Tabs,
    Tab,
    TerminalIcon,
    Tooltip,
    Typography
} from "@rebasepro/ui";
import { useTranslation } from "@rebasepro/app";
import { asString, asStringArray, isRecord, useAdminFetch } from "../../utils/adminFetch";
import { useSourcePath } from "./source";
import { sqlDraftLink, tableLink } from "./links";
import { EmptyState, LoadingRow, SectionHeader, SectionLoadFailure, SqlBlock } from "./shared";
import { classifyLoadFailure, type LoadFailure } from "../load-failure";

export type AdvisorSeverity = "critical" | "high" | "medium" | "low" | "info";

export interface AdvisorFinding {
    id: string;
    check: string;
    category: "security" | "performance";
    severity: AdvisorSeverity;
    title: string;
    detail: string;
    table?: string;
    remediationSql?: string;
    docs?: string;
}

const SEVERITIES: readonly AdvisorSeverity[] = ["critical", "high", "medium", "low", "info"];
const isSeverity = (value: unknown): value is AdvisorSeverity =>
    typeof value === "string" && SEVERITIES.some(severity => severity === value);

/** The tint a severity reads in: information, not decoration. */
const SEVERITY_CHIP: Record<AdvisorSeverity, "redLight" | "orangeLight" | "yellowLight" | "blueLight" | "grayLight"> = {
    critical: "redLight",
    high: "orangeLight",
    medium: "yellowLight",
    low: "blueLight",
    info: "grayLight"
};

export function parseFinding(raw: unknown): AdvisorFinding | null {
    if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.title !== "string") return null;
    const category = raw.category === "security" ? "security" : raw.category === "performance" ? "performance" : null;
    if (!category || !isSeverity(raw.severity)) return null;
    return {
        id: raw.id,
        check: asString(raw.check),
        category,
        severity: raw.severity,
        title: raw.title,
        detail: asString(raw.detail),
        ...(typeof raw.table === "string" ? { table: raw.table } : {}),
        ...(typeof raw.remediationSql === "string" ? { remediationSql: raw.remediationSql } : {}),
        ...(typeof raw.docs === "string" ? { docs: raw.docs } : {})
    };
}

type CategoryFilter = "all" | "security" | "performance";

export function AdvisorsSection({ onCount }: { onCount?: (count: number) => void }) {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { requestJson } = useAdminFetch();
    const sourcePath = useSourcePath();
    const [findings, setFindings] = useState<AdvisorFinding[] | null>(null);
    const [errors, setErrors] = useState<{ category: string; message: string }[]>([]);
    const [degraded, setDegraded] = useState<string[]>([]);
    /** Why the advisors could not be read, classified — see `load-failure.ts`. */
    const [failure, setFailure] = useState<LoadFailure | null>(null);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<CategoryFilter>("all");
    const [open, setOpen] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setFailure(null);
        try {
            const raw = await requestJson(sourcePath("/admin/db/insights/advisors"));
            const list = isRecord(raw) && Array.isArray(raw.findings) ? raw.findings : [];
            const parsed = list.map(parseFinding).filter((finding): finding is AdvisorFinding => finding !== null);
            setFindings(parsed);
            onCount?.(parsed.filter(finding => finding.severity !== "info").length);
            setErrors(isRecord(raw) && Array.isArray(raw.errors)
                ? raw.errors.filter(isRecord).map(entry => ({ category: asString(entry.category), message: asString(entry.message) }))
                : []);
            setDegraded(isRecord(raw) ? asStringArray(raw.degraded) : []);
        } catch (err: unknown) {
            setFailure(classifyLoadFailure(err));
        } finally {
            setLoading(false);
        }
    }, [requestJson, sourcePath, onCount]);

    useEffect(() => { void load(); }, [load]);

    const counts = useMemo(() => ({
        all: findings?.length ?? 0,
        security: findings?.filter(finding => finding.category === "security").length ?? 0,
        performance: findings?.filter(finding => finding.category === "performance").length ?? 0
    }), [findings]);
    const shown = (findings ?? []).filter(finding => filter === "all" || finding.category === filter);
    /** Nothing was ever read: no tabs counting zero, and no "nothing needs attention" over a failure. */
    const unread = failure !== null && findings === null;

    return (
        <div className="flex flex-col gap-4">
            <SectionHeader
                title={t("studio_database_section_advisors")}
                description={t("studio_database_advisors_description")}
                actions={
                    <Tooltip title={t("refresh")}>
                        <IconButton size="small" aria-label={t("studio_database_refresh_aria")} onClick={() => void load()}>
                            <RefreshCwIcon size={iconSize.small}/>
                        </IconButton>
                    </Tooltip>
                }
            />
            {!unread && <Tabs value={filter} onValueChange={(value) => setFilter(value === "security" || value === "performance" ? value : "all")} variant="pill">
                <Tab value="all">{t("studio_database_advisors_all", { count: counts.all })}</Tab>
                <Tab value="security">{t("studio_database_advisors_security", { count: counts.security })}</Tab>
                <Tab value="performance">{t("studio_database_advisors_performance", { count: counts.performance })}</Tab>
            </Tabs>}

            {failure && <SectionLoadFailure failure={failure} stale={findings !== null} onRetry={() => void load()}/>}
            {errors.map(entry => (
                <Alert key={entry.category} color="warning">
                    {t(entry.category === "security" ? "studio_database_advisors_security_failed" : "studio_database_advisors_performance_failed", { message: entry.message })}
                </Alert>
            ))}
            {degraded.length > 0 && (
                <Alert color="info">{t("studio_database_advisors_degraded", { what: degraded.join(", ") })}</Alert>
            )}

            {unread ? null : loading && findings === null ? <LoadingRow/> : shown.length === 0 ? (
                <EmptyState
                    icon={<CheckCircle2Icon size={iconSize.large}/>}
                    message={t("studio_database_advisors_empty")}
                />
            ) : (
                <div className={cls("rounded-lg border divide-y divide-hairline overflow-hidden", defaultBorderMixin)}>
                    {shown.map(finding => {
                        const expanded = open === finding.id;
                        return (
                            <div key={finding.id} className="flex flex-col gap-2 px-4 py-3">
                                <div className="flex items-start gap-3">
                                    <Chip size="smallest" colorScheme={SEVERITY_CHIP[finding.severity]}>
                                        {t(`studio_database_severity_${finding.severity}`)}
                                    </Chip>
                                    <div className="min-w-0 flex-1 flex flex-col gap-1">
                                        <Typography variant="body2" className="font-medium">{finding.title}</Typography>
                                        <Typography variant="caption" color="secondary">
                                            {t(finding.category === "security" ? "studio_database_category_security" : "studio_database_category_performance")}
                                            {" · "}
                                            <span className="font-mono">{finding.check}</span>
                                        </Typography>
                                    </div>
                                    <Button size="small" variant="text" onClick={() => setOpen(expanded ? null : finding.id)}>
                                        {expanded ? t("studio_database_hide_details") : t("studio_database_show_details")}
                                    </Button>
                                </div>
                                {expanded && (
                                    <div className="flex flex-col gap-3 pl-1">
                                        <Typography variant="body2" color="secondary">{finding.detail}</Typography>
                                        {finding.remediationSql && <SqlBlock sql={finding.remediationSql}/>}
                                        <div className="flex items-center gap-2 flex-wrap">
                                            {finding.remediationSql && (
                                                <Button size="small" onClick={() => navigate(sqlDraftLink(finding.remediationSql ?? ""))}>
                                                    <TerminalIcon size={iconSize.smallest}/>
                                                    {t("studio_database_open_in_sql")}
                                                </Button>
                                            )}
                                            {finding.table && (
                                                <Button size="small" variant="text" onClick={() => navigate(tableLink(finding.table ?? ""))}>
                                                    <TableIcon size={iconSize.smallest}/>
                                                    {t("studio_database_open_table", { table: finding.table })}
                                                </Button>
                                            )}
                                            {finding.docs && (
                                                <Button size="small" variant="text" component="a" href={finding.docs} target="_blank" rel="noreferrer">
                                                    <ExternalLinkIcon size={iconSize.smallest}/>
                                                    {t("studio_database_docs")}
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
