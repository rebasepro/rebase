import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import {
    Alert,
    Button,
    cls,
    defaultBorderMixin,
    GaugeIcon,
    IconButton,
    iconSize,
    RefreshCwIcon,
    Select,
    SelectItem,
    Table,
    TableBody,
    TableCell,
    TableHeader,
    TableRow,
    TerminalIcon,
    Tooltip,
    Typography
} from "@rebasepro/ui";
import { useSnackbarController, useTranslation } from "@rebasepro/app";
import { asBoolean, asNumber, asString, isRecord, useAdminFetch } from "../../utils/adminFetch";
import { useSourcePath } from "./source";
import { sqlDraftLink } from "./links";
import { formatCount, formatDuration } from "./format";
import { EmptyState, LoadingRow, SectionHeader, statementsOf, useConfirmSql } from "./shared";

export type QueryStatsStatus = "ok" | "not_installed" | "not_preloaded" | "unavailable";
type QuerySort = "total" | "mean" | "calls";

interface QueryStat {
    queryId: string;
    query: string;
    calls: number;
    totalMs: number;
    meanMs: number;
    maxMs: number;
    rows: number;
}

function parseStatus(value: unknown): QueryStatsStatus {
    return value === "ok" || value === "not_installed" || value === "not_preloaded" ? value : "unavailable";
}

export function QueriesSection() {
    const { t, i18n } = useTranslation();
    const navigate = useNavigate();
    const snackbar = useSnackbarController();
    const { requestJson } = useAdminFetch();
    const sourcePath = useSourcePath();
    const [sort, setSort] = useState<QuerySort>("total");
    const [status, setStatus] = useState<QueryStatsStatus | null>(null);
    const [available, setAvailable] = useState(false);
    const [queries, setQueries] = useState<QueryStat[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [installing, setInstalling] = useState(false);
    const [confirmDialog, confirm] = useConfirmSql();

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const raw = await requestJson(sourcePath(`/admin/db/insights/queries?sort=${sort}`));
            if (!isRecord(raw)) throw new Error(t("studio_database_load_failed"));
            setStatus(parseStatus(raw.status));
            setAvailable(asBoolean(raw.available));
            setQueries(Array.isArray(raw.queries) ? raw.queries.filter(isRecord).map(row => ({
                queryId: asString(row.queryId),
                query: asString(row.query),
                calls: asNumber(row.calls),
                totalMs: asNumber(row.totalMs),
                meanMs: asNumber(row.meanMs),
                maxMs: asNumber(row.maxMs),
                rows: asNumber(row.rows)
            })) : []);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : t("studio_database_load_failed"));
        } finally {
            setLoading(false);
        }
    }, [requestJson, sourcePath, sort, t]);

    useEffect(() => { void load(); }, [load]);

    const install = async () => {
        setInstalling(true);
        try {
            await requestJson(sourcePath("/admin/db/catalog/extensions/pg_stat_statements"), { method: "POST", body: {} });
            await load();
        } catch (err: unknown) {
            snackbar.open({ type: "error", message: err instanceof Error ? err.message : t("studio_database_action_failed") });
        } finally {
            setInstalling(false);
        }
    };

    const askReset = () => confirm({
        title: t("studio_database_queries_reset_title"),
        body: t("studio_database_queries_reset_body"),
        confirmLabel: t("studio_database_queries_reset"),
        preview: async () => statementsOf(await requestJson(sourcePath("/admin/db/insights/queries/reset"), { method: "POST", body: { dryRun: true } })),
        run: async () => {
            await requestJson(sourcePath("/admin/db/insights/queries/reset"), { method: "POST", body: {} });
            snackbar.open({ type: "success", message: t("studio_database_queries_reset_done") });
            await load();
        }
    });

    const locale = i18n.language;
    return (
        <div className="flex flex-col gap-4">
            <SectionHeader
                title={t("studio_database_section_queries")}
                description={t("studio_database_queries_description")}
                actions={<>
                    <Select
                        size="small"
                        value={sort}
                        onValueChange={(value) => setSort(value === "mean" || value === "calls" ? value : "total")}
                        label={t("studio_database_queries_sort")}
                        labelPlacement="above"
                    >
                        <SelectItem value="total">{t("studio_database_queries_sort_total")}</SelectItem>
                        <SelectItem value="mean">{t("studio_database_queries_sort_mean")}</SelectItem>
                        <SelectItem value="calls">{t("studio_database_queries_sort_calls")}</SelectItem>
                    </Select>
                    {status === "ok" && (
                        <Button size="small" onClick={askReset}>{t("studio_database_queries_reset")}</Button>
                    )}
                    <Tooltip title={t("refresh")}>
                        <IconButton size="small" aria-label={t("studio_database_refresh_aria")} onClick={() => void load()}>
                            <RefreshCwIcon size={iconSize.small}/>
                        </IconButton>
                    </Tooltip>
                </>}
            />

            {error && <Alert color="error">{error}</Alert>}
            {status === "unavailable" && <Alert color="info">{t("studio_database_queries_unavailable")}</Alert>}
            {status === "not_preloaded" && <Alert color="warning">{t("studio_database_queries_not_preloaded")}</Alert>}
            {status === "not_installed" && (
                <Alert color="info">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                        <Typography variant="body2">
                            {available ? t("studio_database_queries_not_installed") : t("studio_database_queries_not_available")}
                        </Typography>
                        {available && (
                            <Button size="small" disabled={installing} onClick={() => void install()}>
                                {t("studio_database_queries_install")}
                            </Button>
                        )}
                    </div>
                </Alert>
            )}

            {loading && status === null ? <LoadingRow/> : status === "ok" && (queries.length === 0 ? (
                <EmptyState icon={<GaugeIcon size={iconSize.large}/>} message={t("studio_database_queries_empty")}/>
            ) : (
                <div className={cls("overflow-x-auto rounded-lg border", defaultBorderMixin)}>
                    <Table className="w-full">
                        <TableHeader>
                            <TableCell header>{t("studio_database_queries_query")}</TableCell>
                            <TableCell header className="text-right">{t("studio_database_queries_calls")}</TableCell>
                            <TableCell header className="text-right">{t("studio_database_queries_total")}</TableCell>
                            <TableCell header className="text-right">{t("studio_database_queries_mean")}</TableCell>
                            <TableCell header className="text-right">{t("studio_database_queries_max")}</TableCell>
                            <TableCell header className="text-right">{t("studio_database_queries_rows")}</TableCell>
                            <TableCell header className="text-right">{t("actions")}</TableCell>
                        </TableHeader>
                        <TableBody>
                            {queries.map(query => (
                                <TableRow key={query.queryId || query.query}>
                                    <TableCell className="max-w-xl">
                                        <Typography variant="mono" className="text-xs line-clamp-2 break-all">{query.query}</Typography>
                                    </TableCell>
                                    <TableCell className="text-right tabular-nums whitespace-nowrap">{formatCount(query.calls, locale)}</TableCell>
                                    <TableCell className="text-right tabular-nums whitespace-nowrap">{formatDuration(query.totalMs, locale)}</TableCell>
                                    <TableCell className="text-right tabular-nums whitespace-nowrap">{formatDuration(query.meanMs, locale)}</TableCell>
                                    <TableCell className="text-right tabular-nums whitespace-nowrap">{formatDuration(query.maxMs, locale)}</TableCell>
                                    <TableCell className="text-right tabular-nums whitespace-nowrap">{formatCount(query.rows, locale)}</TableCell>
                                    <TableCell className="text-right">
                                        <Tooltip title={t("studio_database_open_in_sql")}>
                                            <IconButton
                                                size="small"
                                                aria-label={t("studio_database_open_in_sql")}
                                                onClick={() => navigate(sqlDraftLink(query.query))}
                                            >
                                                <TerminalIcon size={iconSize.small}/>
                                            </IconButton>
                                        </Tooltip>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            ))}
            {confirmDialog}
        </div>
    );
}
