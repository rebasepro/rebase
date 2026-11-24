import React from "react";
import { Button, Card, Typography } from "@rebasepro/ui";
import { useTranslation } from "@rebasepro/app";
import { useDdlConfirm } from "../DdlConfirm";
import { formatBytes, formatCount, type DbTableInfo, type TableDetails } from "../tableModel";

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
    return (
        <Card className="p-3 flex flex-col gap-1 min-w-0">
            <Typography variant="caption" color="secondary">{label}</Typography>
            <Typography variant="h6" className="tabular-nums truncate">{value}</Typography>
            {hint && <Typography variant="caption" color="secondary" className="truncate">{hint}</Typography>}
        </Card>
    );
}

/** Storage and access statistics, and the maintenance that keeps them honest. */
export function StatsTab({ table, details, onChanged }: { table: DbTableInfo; details: TableDetails | null; onChanged: () => void }) {
    const { t, i18n } = useTranslation();
    const { confirm, dialog } = useDdlConfirm();
    const stats = details?.stats ?? null;
    const locale = i18n?.language;
    const when = (value: string | null) => (value ? new Date(value).toLocaleString(locale) : t("studio_tables_stats_never"));
    const deadRatio = stats && stats.liveTuples !== null && stats.deadTuples !== null && stats.liveTuples + stats.deadTuples > 0
        ? stats.deadTuples / (stats.liveTuples + stats.deadTuples)
        : null;
    const base = `/admin/db/tables/${encodeURIComponent(table.name)}`;

    if (!details) return null;
    if (!stats) return <Typography variant="body2" color="secondary">{t("studio_tables_stats_unavailable")}</Typography>;

    return (
        <div className="flex flex-col gap-6 max-w-5xl">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Tile label={t("studio_tables_stats_rows")} value={formatCount(stats.rowEstimate, locale)} hint={t("studio_tables_stats_estimate")}/>
                <Tile label={t("studio_tables_stats_total_size")} value={formatBytes(stats.totalBytes)}/>
                <Tile label={t("studio_tables_stats_table_size")} value={formatBytes(stats.tableBytes)} hint={t("studio_tables_stats_toast", { size: formatBytes(stats.toastBytes) })}/>
                <Tile label={t("studio_tables_stats_index_size")} value={formatBytes(stats.indexBytes)}/>
                <Tile label={t("studio_tables_stats_seq_scans")} value={formatCount(stats.seqScans, locale)} hint={t("studio_tables_stats_rows_read", { count: formatCount(stats.seqTuplesRead, locale) })}/>
                <Tile label={t("studio_tables_stats_index_scans")} value={formatCount(stats.indexScans, locale)} hint={t("studio_tables_stats_rows_fetched", { count: formatCount(stats.indexTuplesFetched, locale) })}/>
                <Tile label={t("studio_tables_stats_dead_rows")} value={formatCount(stats.deadTuples, locale)}
                    hint={deadRatio !== null ? t("studio_tables_stats_dead_ratio", { percent: (deadRatio * 100).toFixed(1) }) : undefined}/>
                <Tile label={t("studio_tables_stats_writes")}
                    value={formatCount((stats.inserts ?? 0) + (stats.updates ?? 0) + (stats.deletes ?? 0), locale)}
                    hint={t("studio_tables_stats_writes_hint", {
                        inserts: formatCount(stats.inserts, locale),
                        updates: formatCount(stats.updates, locale),
                        deletes: formatCount(stats.deletes, locale)
                    })}/>
            </div>

            {table.kind === "table" && (
                <Card className="p-4 flex flex-col gap-3">
                    <Typography variant="subtitle2">{t("studio_tables_maintenance_heading")}</Typography>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <Typography variant="body2" color="secondary">{t("studio_tables_stats_last_vacuum", { manual: when(stats.lastVacuum), auto: when(stats.lastAutovacuum) })}</Typography>
                        <Typography variant="body2" color="secondary">{t("studio_tables_stats_last_analyze", { manual: when(stats.lastAnalyze), auto: when(stats.lastAutoanalyze) })}</Typography>
                    </div>
                    <div className="flex gap-2">
                        <Button size="small" variant="outlined" onClick={() => void confirm({
                            title: t("studio_tables_analyze"),
                            path: `${base}/maintenance`,
                            method: "POST",
                            body: { schema: table.schema, action: "analyze" },
                            done: t("studio_tables_analyze_done", { name: table.name }),
                            onDone: onChanged
                        })}>{t("studio_tables_analyze")}</Button>
                        <Button size="small" variant="outlined" onClick={() => void confirm({
                            title: t("studio_tables_vacuum"),
                            path: `${base}/maintenance`,
                            method: "POST",
                            body: { schema: table.schema, action: "vacuum" },
                            done: t("studio_tables_vacuum_done", { name: table.name }),
                            onDone: onChanged
                        })}>{t("studio_tables_vacuum")}</Button>
                    </div>
                </Card>
            )}

            {table.materialized && (
                <Card className="p-4 flex items-center justify-between gap-3">
                    <Typography variant="body2" color="secondary">{t("studio_tables_matview_refresh_hint")}</Typography>
                    <Button size="small" variant="outlined" onClick={() => void confirm({
                        title: t("studio_tables_matview_refresh"),
                        path: `${base}/refresh`,
                        method: "POST",
                        body: { schema: table.schema },
                        done: t("studio_tables_matview_refreshed", { name: table.name }),
                        onDone: onChanged
                    })}>{t("studio_tables_matview_refresh")}</Button>
                </Card>
            )}
            {dialog}
        </div>
    );
}
