import React, { useState, useEffect, useRef, useCallback } from "react";
import {
    Alert,
    Button,
    Chip,
    CircularProgress,
    cls,
    DatabaseIcon,
    defaultBorderMixin,
    DownloadIcon,
    iconSize,
    IconButton,
    RefreshCwIcon,
    Tooltip,
    Typography
} from "@rebasepro/ui";
import { useRebaseClient, useSnackbarController, useTranslation } from "@rebasepro/app";
import type { BackupInfo, BackupScheduleStatus, RebaseClient } from "@rebasepro/types";

import { classifyLoadFailure, type LoadFailure } from "../load-failure";
import { LoadFailureView } from "../load-failure-view";

function formatSize(bytes: number | undefined): string {
    if (bytes === undefined || bytes === null) return "—";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(iso: string | undefined): string {
    if (!iso) return "—";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleString();
}

/**
 * The name the roles sidecar is saved under: the dump's, with the suffix
 * `rebase db restore` looks for beside it.
 */
function rolesFileName(dumpName: string): string {
    return dumpName.replace(/\.dump$/, "") + ".globals.sql";
}

/**
 * How the scheduled backup is doing, above the list — and, apart from it, a run
 * someone started by hand since, which is not the schedule's.
 */
function BackupScheduleSummary({ schedule }: { schedule: BackupScheduleStatus }) {
    const { t } = useTranslation();
    const manual = schedule.lastManualRun;
    return (
        <div className="flex flex-col gap-2">
            <ScheduledBackupStatus schedule={schedule}/>
            {manual && (manual.success ? (
                <Typography variant="caption" color="secondary" className="text-[12px]">
                    {t("studio_backups_manual_run_ok", { when: formatDate(manual.startedAt) })}
                </Typography>
            ) : (
                <Alert color="warning">
                    <Typography variant="body2" className="text-[13px] font-semibold">
                        {t("studio_backups_manual_run_failed", { when: formatDate(manual.startedAt) })}
                    </Typography>
                    {manual.error && (
                        <Typography variant="caption" className="font-mono text-[12px] whitespace-pre-wrap break-words">
                            {manual.error}
                        </Typography>
                    )}
                </Alert>
            ))}
        </div>
    );
}

/**
 * The scheduled backup's own state.
 *
 * A failed last run is an error, not a footnote: a backup that fails every
 * night used to leave this panel empty under "wait for the next scheduled run",
 * with the reason only in the cron history.
 */
function ScheduledBackupStatus({ schedule }: { schedule: BackupScheduleStatus }) {
    const { t } = useTranslation();
    const last = schedule.lastRun;

    // Refused at boot: it never runs, and resuming it in Cron Jobs is not
    // possible — it is not a job there. Only its cron file can fix it.
    if (schedule.refused) {
        return (
            <Alert color="error">
                <Typography variant="body2" className="text-[13px] font-semibold">
                    {t("studio_backups_job_refused", { job: schedule.jobId })}
                </Typography>
                <Typography variant="caption" className="font-mono text-[12px] whitespace-pre-wrap break-words">
                    {schedule.schedule} — {schedule.refused}
                </Typography>
            </Alert>
        );
    }

    if (last && !last.success) {
        return (
            <Alert color="error">
                <Typography variant="body2" className="text-[13px] font-semibold">
                    {t("studio_backups_last_run_failed", { when: formatDate(last.startedAt) })}
                </Typography>
                {last.error && (
                    <Typography variant="caption" className="font-mono text-[12px] whitespace-pre-wrap break-words">
                        {last.error}
                    </Typography>
                )}
            </Alert>
        );
    }

    if (!schedule.enabled) {
        // Declared off is not paused: "resume it in Cron Jobs" would turn on
        // the placeholder the documented cron file exports while
        // BACKUP_SCHEDULE is unset.
        return (
            <Alert color="warning">
                <Typography variant="body2" className="text-[13px]">
                    {schedule.disabledInCode
                        ? t("studio_backups_schedule_off_in_code", { job: schedule.jobId })
                        : t("studio_backups_schedule_paused", { job: schedule.jobId })}
                </Typography>
            </Alert>
        );
    }

    // Unknown is not "has not run yet": that line would be read off an empty
    // history the server could not fetch.
    if (schedule.historyError) {
        return (
            <Alert color="warning">
                <Typography variant="body2" className="text-[13px]">
                    {t("studio_backups_history_unreadable")}
                </Typography>
            </Alert>
        );
    }

    const parts = [
        last ? t("studio_backups_last_run_ok", { when: formatDate(last.startedAt) }) : t("studio_backups_never_ran"),
        schedule.nextRunAt ? t("studio_backups_next_run", { when: formatDate(schedule.nextRunAt) }) : null
    ].filter((part): part is string => Boolean(part));

    return (
        <Typography variant="caption" color="secondary" className="text-[12px]">
            {parts.join(" · ")}
        </Typography>
    );
}

export function BackupsView() {
    const client = useRebaseClient<RebaseClient>();
    const snackbar = useSnackbarController();
    const { t } = useTranslation();

    const [backups, setBackups] = useState<BackupInfo[]>([]);
    const [destinationKind, setDestinationKind] = useState<string>("local");
    const [configured, setConfigured] = useState(true);
    const [schedule, setSchedule] = useState<BackupScheduleStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [downloading, setDownloading] = useState<string | null>(null);
    /** Why the listing failed, classified — see `load-failure.ts`. */
    const [failure, setFailure] = useState<LoadFailure | null>(null);

    const clientRef = useRef(client);
    clientRef.current = client;
    const snackbarRef = useRef(snackbar);
    snackbarRef.current = snackbar;

    const load = useCallback(async () => {
        const c = clientRef.current;
        if (!c?.backups) {
            setLoading(false);
            setConfigured(false);
            return;
        }
        setFailure(null);
        try {
            const res = await c.backups.list();
            setBackups(res.backups);
            setDestinationKind(res.destinationKind);
            setConfigured(res.configured);
            // Absent from a server that predates the field.
            setSchedule(res.schedule ?? null);
        } catch (e: unknown) {
            // The snackbar is gone in seconds, and the list underneath it is
            // empty — which is how a refused listing came to read "No backups
            // found yet" about a database that has backups. Keep the reason on
            // screen instead.
            setFailure(classifyLoadFailure(e));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    const handleDownload = async (key: string, fileName: string) => {
        const c = clientRef.current;
        if (!c?.backups) return;
        setDownloading(key);
        try {
            const blob = await c.backups.download(key);
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        } catch (e: unknown) {
            snackbarRef.current.open({
                type: "error",
                message: e instanceof Error ? e.message : String(e)
            });
        } finally {
            setDownloading(null);
        }
    };

    // Backups API not available on this client (e.g. non-Postgres backend).
    if (!client?.backups) {
        return (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-center p-8">
                <DatabaseIcon size={iconSize.large} className="text-surface-300 dark:text-surface-600"/>
                <Typography variant="h6" color="secondary">{t("studio_backups_unavailable_title")}</Typography>
                <Typography variant="body2" color="disabled" className="max-w-md">
                    {t("studio_backups_unavailable_body")}
                </Typography>
            </div>
        );
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full">
                <CircularProgress/>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full w-full overflow-hidden bg-surface-card">
            {/* Header */}
            <div className={cls("flex items-center justify-between px-5 py-2.5 border-b bg-surface-sheet min-h-[48px]", defaultBorderMixin)}>
                <div className="flex items-center gap-2">
                    <DatabaseIcon size={iconSize.small} className="text-primary"/>
                    <Typography variant="subtitle2" className="font-semibold">{t("studio_tool_backups")}</Typography>
                    <Chip size="smallest" className="bg-surface-raised text-surface-600 dark:text-surface-300">{backups.length}</Chip>
                    <Chip size="smallest" className="bg-surface-raised text-surface-500 dark:text-surface-400 uppercase font-mono text-[10px]">{destinationKind}</Chip>
                </div>
                <IconButton size="small" onClick={load} title={t("refresh_data")}>
                    <RefreshCwIcon size={iconSize.smallest}/>
                </IconButton>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
                {failure ? (
                    <LoadFailureView
                        failure={failure}
                        title={t("studio_backups_read_failed")}
                        deniedTitle={t("studio_backups_denied_title")}
                        deniedHint={t("studio_backups_denied_hint")}
                        onRetry={load}
                    />
                ) : (
                    <div className="flex flex-col gap-4 min-h-full">
                        {schedule && (
                            <div className="max-w-3xl">
                                <BackupScheduleSummary schedule={schedule}/>
                            </div>
                        )}
                        {!configured ? (
                            <Alert color="info">
                                <Typography variant="body2" className="text-[13px]">
                                    <strong>{t("studio_backups_not_configured_title")}</strong>{" "}
                                    {t("studio_backups_not_configured_body")}{" "}
                                    <a
                                        href="https://rebase.pro/docs/backend/jobs"
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-primary underline"
                                    >
                                        {t("studio_read_the_docs")}
                                    </a>
                                </Typography>
                            </Alert>
                        ) : backups.length === 0 ? (
                            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
                                <DatabaseIcon size={iconSize.large} className="text-surface-200 dark:text-surface-700"/>
                                <Typography variant="body2" color="disabled">
                                    {t("studio_backups_empty")}
                                </Typography>
                                {/* With a schedule, the summary above already says when the next one runs, or why the last one did not. */}
                                {!schedule && (
                                    <Typography variant="caption" color="disabled" className="max-w-md">
                                        {t("studio_backups_empty_hint")}
                                    </Typography>
                                )}
                            </div>
                        ) : (
                            <div className="space-y-2 max-w-3xl">
                                {backups.map(backup => {
                                    // The roles sidecar travels with the dump: a restore
                                    // into a new Postgres needs both files.
                                    const globalsKey = backup.globalsKey;
                                    return (
                                        <div
                                            key={backup.key}
                                            className={cls("flex items-center gap-3 px-4 py-3 rounded-lg border bg-surface-card", defaultBorderMixin)}
                                        >
                                            <DatabaseIcon size={iconSize.small} className="text-surface-400 shrink-0"/>
                                            <div className="flex-1 min-w-0">
                                                <Typography variant="body2" className="truncate font-medium font-mono text-[12px]">{backup.name}</Typography>
                                                <Typography variant="caption" color="secondary" className="text-[11px]">
                                                    {formatDate(backup.createdAt)} · {formatSize(backup.sizeBytes)}
                                                </Typography>
                                            </div>
                                            {globalsKey ? (
                                                <Tooltip title={t("studio_backups_roles_file_hint")}>
                                                    <Button
                                                        size="small"
                                                        variant="text"
                                                        onClick={() => handleDownload(globalsKey, rolesFileName(backup.name))}
                                                        disabled={downloading === globalsKey}
                                                        startIcon={downloading === globalsKey
                                                            ? <CircularProgress size="smallest"/>
                                                            : <DownloadIcon size={iconSize.smallest}/>}
                                                    >
                                                        {downloading === globalsKey ? t("studio_backups_downloading") : t("studio_backups_roles_file")}
                                                    </Button>
                                                </Tooltip>
                                            ) : (
                                                <Tooltip title={t("studio_backups_no_roles_file_hint")}>
                                                    <Chip size="smallest" colorScheme="orangeDarker">{t("studio_backups_no_roles_file")}</Chip>
                                                </Tooltip>
                                            )}
                                            <Button
                                                size="small"
                                                variant="outlined"
                                                onClick={() => handleDownload(backup.key, backup.name)}
                                                disabled={downloading === backup.key}
                                                startIcon={downloading === backup.key
                                                    ? <CircularProgress size="smallest"/>
                                                    : <DownloadIcon size={iconSize.smallest}/>}
                                            >
                                                {downloading === backup.key ? t("studio_backups_downloading") : t("download")}
                                            </Button>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
