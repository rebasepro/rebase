
import React, { useState, useEffect, useRef } from "react";
import {
    AlertCircleIcon,
    Button,
    CalendarIcon,
    Card,
    CheckCircleIcon,
    Chip,
    CircularProgress,
    cls,
    defaultBorderMixin,
    HistoryIcon,
    IconButton,
    iconSize,
    Paper,
    PauseIcon,
    PlayIcon,
    RefreshCwIcon,
    Typography
} from "@rebasepro/ui";
import { useRebaseClient, useSnackbarController, useTranslation } from "@rebasepro/app";
import type { CronJobStatus, CronJobLogEntry } from "@rebasepro/types";
import type { RebaseClient } from "@rebasepro/types";

import { classifyLoadFailure, type LoadFailure } from "../load-failure";
import { LoadFailureView } from "../load-failure-view";

function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
}

function formatRelative(iso: string | undefined): string {
    if (!iso) return "—";
    const d = new Date(iso);
    const now = Date.now();
    const diff = d.getTime() - now;
    const abs = Math.abs(diff);
    if (abs < 60000) return diff > 0 ? "in <1m" : "<1m ago";
    if (abs < 3600000) { const m = Math.round(abs / 60000); return diff > 0 ? `in ${m}m` : `${m}m ago`; }
    if (abs < 86400000) { const h = Math.round(abs / 3600000); return diff > 0 ? `in ${h}h` : `${h}h ago`; }
    return d.toLocaleString();
}

const stateColors: Record<string, string> = {
    idle: "bg-emerald-500",
running: "bg-blue-500",
success: "bg-emerald-500",
    error: "bg-red-500",
disabled: "bg-surface-400"
};

export function CronJobsView() {
    const client = useRebaseClient<RebaseClient>();
    const snackbar = useSnackbarController();
    const { t } = useTranslation();
    const [jobs, setJobs] = useState<CronJobStatus[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [logs, setLogs] = useState<CronJobLogEntry[]>([]);
    const [logsLoading, setLogsLoading] = useState(false);
    const [triggering, setTriggering] = useState<string | null>(null);
    /** Why the job listing failed, classified — see `load-failure.ts`. */
    const [failure, setFailure] = useState<LoadFailure | null>(null);

    // Refs so effects never re-fire due to identity changes
    const clientRef = useRef(client);
    clientRef.current = client;
    const snackbarRef = useRef(snackbar);
    snackbarRef.current = snackbar;

    // ── Fetch jobs on mount + poll every 15s ──
    useEffect(() => {
        let cancelled = false;

        async function load() {
            const c = clientRef.current;
            if (!c?.cron) {
                setLoading(false);
                return;
            }
            try {
                const res = await c.cron.listJobs();
                if (!cancelled) {
                    setJobs(res.jobs);
                    setFailure(null);
                }
            } catch (e: unknown) {
                // A snackbar over an empty list said "No Cron Jobs Registered"
                // about a project whose crons the caller may not read. This
                // view polls every 15s, so the toast is also gone long before
                // anyone looks.
                if (!cancelled) setFailure(classifyLoadFailure(e));
            } finally {
                if (!cancelled) setLoading(false);
            }
        }

        load();

        let timeoutId: ReturnType<typeof setTimeout> | null = null;

        const scheduleNext = () => {
            if (cancelled) return;
            timeoutId = setTimeout(async () => {
                if (document.visibilityState === "visible") {
                    await load();
                }
                scheduleNext();
            }, 15_000);
        };

        scheduleNext();

        const handleVisibility = () => {
            if (document.visibilityState === "visible") {
                load();
            }
        };
        document.addEventListener("visibilitychange", handleVisibility);

        return () => {
            cancelled = true;
            if (timeoutId) clearTimeout(timeoutId);
            document.removeEventListener("visibilitychange", handleVisibility);
        };
    }, []); // runs once

    // ── Fetch logs when selection changes ──
    useEffect(() => {
        if (!selectedId) {
            setLogs([]);
            return;
        }
        let cancelled = false;
        const c = clientRef.current;
        if (!c?.cron) return;

        setLogsLoading(true);
        c.cron.getJobLogs(selectedId, { limit: 25 })
            .then(res => { if (!cancelled) setLogs(res.logs); })
            .catch((e: unknown) => {
                if (cancelled) return;
                // Same reasoning as `refreshLogs`: an empty log list is a claim.
                setLogs([]);
                snackbarRef.current.open({
                    type: "error",
                    message: e instanceof Error ? e.message : String(e)
                });
            })
            .finally(() => { if (!cancelled) setLogsLoading(false); });

        return () => { cancelled = true; };
    }, [selectedId]);

    // ── Imperative helpers (not in any dep array) ──
    async function refreshJobs() {
        const c = clientRef.current;
        if (!c?.cron) return;
        try {
            const res = await c.cron.listJobs();
            setJobs(res.jobs);
            setFailure(null);
        } catch (e: unknown) {
            // Swallowed before, which left the list showing whatever it last
            // held — or nothing — after a failed refresh. "No cron jobs" and
            // "could not read the cron jobs" are not the same statement, so the
            // reason stays on screen rather than passing through a snackbar.
            setFailure(classifyLoadFailure(e));
        }
    }

    async function refreshLogs(id: string) {
        const c = clientRef.current;
        if (!c?.cron) return;
        setLogsLoading(true);
        try {
            const res = await c.cron.getJobLogs(id, { limit: 25 });
            setLogs(res.logs);
        } catch (e: unknown) {
            // Clearing the list silently reads as "this job has never run".
            setLogs([]);
            snackbarRef.current.open({
                type: "error",
                message: e instanceof Error ? e.message : String(e)
            });
        }
        finally { setLogsLoading(false); }
    }

    const handleTrigger = async (id: string) => {
        const c = clientRef.current;
        if (!c?.cron) return;
        setTriggering(id);
        try {
            await c.cron.triggerJob(id);
            snackbarRef.current.open({ type: "success",
message: "Job triggered" });
            await refreshJobs();
            if (selectedId === id) refreshLogs(id);
        } catch (e: unknown) {
            snackbarRef.current.open({ type: "error",
message: e instanceof Error ? e.message : String(e) });
        } finally { setTriggering(null); }
    };

    const handleToggle = async (id: string, enabled: boolean) => {
        const c = clientRef.current;
        if (!c?.cron) return;
        try {
            await c.cron.toggleJob(id, enabled);
            snackbarRef.current.open({ type: "success",
message: enabled ? "Job enabled" : "Job paused" });
            await refreshJobs();
        } catch (e: unknown) {
            snackbarRef.current.open({ type: "error",
message: e instanceof Error ? e.message : String(e) });
        }
    };

    const selectedJob = jobs.find(j => j.id === selectedId);

    if (loading) return <div className="flex items-center justify-center h-full"><CircularProgress/></div>;

    if (failure) return (
        <LoadFailureView
            failure={failure}
            title={t("studio_cron_read_failed")}
            deniedTitle={t("studio_cron_denied_title")}
            deniedHint={t("studio_cron_denied_hint")}
            onRetry={refreshJobs}
        />
    );

    if (jobs.length === 0) return (
        <div className="flex flex-col items-center justify-center h-full gap-4 text-center p-8">
            <CalendarIcon size={iconSize.medium} className="text-surface-300 dark:text-surface-600"/>
            <Typography variant="h6" color="secondary">{t("studio_cron_empty_title")}</Typography>
            <Typography variant="body2" color="disabled" className="max-w-md">
                {t("studio_cron_empty_body")}
            </Typography>
            <a
                href="https://rebase.pro/docs/backend/cron-jobs"
                target="_blank"
                rel="noreferrer"
                className="text-primary text-sm underline"
            >
                {t("studio_read_the_docs")}
            </a>
        </div>
    );

    return (
        <div className="flex h-full w-full overflow-hidden bg-white dark:bg-surface-950">
            {/* ── Job List ── */}
            <div className={cls("flex flex-col w-[340px] min-w-[280px] border-r h-full", defaultBorderMixin)}>
                <div className={cls("flex items-center justify-between px-4 py-2.5 border-b bg-surface-50 dark:bg-surface-900 min-h-[48px]", defaultBorderMixin)}>
                    <div className="flex items-center gap-2">
                        <CalendarIcon size={iconSize.smallest} className="text-primary"/>
                        <Typography variant="subtitle2" className="font-semibold">{t("studio_tool_cron")}</Typography>
                        <Chip size="smallest" className="bg-surface-200 dark:bg-surface-700 text-surface-600 dark:text-surface-300">{jobs.length}</Chip>
                    </div>
                    <IconButton size="small" onClick={refreshJobs} title="Refresh"><RefreshCwIcon size={iconSize.smallest}/></IconButton>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-1">
                    {jobs.map(job => (
                        <div
                            key={job.id}
                            onClick={() => setSelectedId(job.id)}
                            className={cls(
                                "flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-all",
                                selectedId === job.id
                                    ? "bg-primary/10 dark:bg-primary/15 ring-1 ring-primary/30"
                                    : "hover:bg-surface-100 dark:hover:bg-surface-950"
                            )}
                        >
                            <div className={cls("w-2 h-2 rounded-full shrink-0", stateColors[job.state] || "bg-surface-400")}/>
                            <div className="flex-1 min-w-0">
                                <Typography variant="body2" className="truncate font-medium text-[13px]">{job.name}</Typography>
                                <Typography variant="caption" color="secondary" className="truncate text-[11px] font-mono">{job.schedule}</Typography>
                            </div>
                            {job.state === "running" && <CircularProgress size="smallest"/>}
                        </div>
                    ))}
                </div>
            </div>

            {/* ── Detail Panel ── */}
            <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
                {!selectedJob ? (
                    <div className="flex items-center justify-center h-full">
                        <Typography variant="body2" color="disabled">Select a cron job to view details</Typography>
                    </div>
                ) : (
                    <>
                        {/* Header */}
                        <div className={cls("flex items-center justify-between px-5 py-3 border-b bg-white dark:bg-surface-950 min-h-[56px]", defaultBorderMixin)}>
                            <div className="flex items-center gap-3 min-w-0">
                                <div className={cls("w-2.5 h-2.5 rounded-full", stateColors[selectedJob.state])}/>
                                <div className="min-w-0">
                                    <Typography variant="subtitle1" className="font-semibold truncate">{selectedJob.name}</Typography>
                                    {selectedJob.description && <Typography variant="caption" color="secondary" className="truncate">{selectedJob.description}</Typography>}
                                </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                                <IconButton title={selectedJob.enabled ? "Pause job" : "Enable job"} size="small" onClick={() => handleToggle(selectedJob.id, !selectedJob.enabled)}>
                                    {selectedJob.enabled ? <PauseIcon size={iconSize.small}/> : <PlayIcon size={iconSize.smallest}/>}
                                </IconButton>
                                <Button
                                    size="small"
                                    color="primary"
                                    onClick={() => handleTrigger(selectedJob.id)}
                                    disabled={triggering === selectedJob.id}
                                    startIcon={triggering === selectedJob.id ? <CircularProgress size="smallest"/> : <PlayIcon size={iconSize.smallest}/>}
                                >
                                    Run Now
                                </Button>
                            </div>
                        </div>

                        {/* Stats Cards */}
                        <div className="px-5 py-4 bg-surface-50 dark:bg-surface-900/50">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                <StatCard label="Schedule" value={selectedJob.schedule} mono/>
                                <StatCard label="Last Run" value={formatRelative(selectedJob.lastRunAt)}/>
                                <StatCard label="Next Run" value={selectedJob.enabled ? formatRelative(selectedJob.nextRunAt) : "Paused"}/>
                                <StatCard label="Duration" value={selectedJob.lastDurationMs !== undefined ? formatDuration(selectedJob.lastDurationMs) : "—"}/>
                            </div>
                            <div className="grid grid-cols-3 gap-3 mt-3">
                                <StatCard label="Status" value={selectedJob.state.toUpperCase()} chipColor={selectedJob.state === "error" ? "red" : selectedJob.state === "disabled" ? "gray" : "green"}/>
                                <StatCard label="Total Runs" value={String(selectedJob.totalRuns)}/>
                                <StatCard label="Failures" value={String(selectedJob.totalFailures)} highlight={selectedJob.totalFailures > 0}/>
                            </div>
                            {selectedJob.lastError && (
                                <div className="mt-3 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50">
                                    <div className="flex items-center gap-2 mb-1">
                                        <AlertCircleIcon size={iconSize.smallest} className="text-red-500"/>
                                        <Typography variant="caption" className="font-semibold text-red-700 dark:text-red-400">Last Error</Typography>
                                    </div>
                                    <Typography variant="caption" className="font-mono text-red-600 dark:text-red-300 text-[11px] break-all">{selectedJob.lastError}</Typography>
                                </div>
                            )}
                        </div>

                        {/* Logs Section */}
                        <div className={cls("flex items-center justify-between px-5 py-2 border-y bg-white dark:bg-surface-950", defaultBorderMixin)}>
                            <div className="flex items-center gap-2">
                                <HistoryIcon size={iconSize.smallest} className="text-surface-400"/>
                                <Typography variant="subtitle2" className="font-semibold text-[13px]">Execution History</Typography>
                            </div>
                            <IconButton size="small" onClick={() => refreshLogs(selectedJob.id)} title="Refresh logs"><RefreshCwIcon size={iconSize.smallest}/></IconButton>
                        </div>
                        <div className="flex-1 overflow-y-auto">
                            {logsLoading ? (
                                <div className="flex justify-center p-8"><CircularProgress size="small"/></div>
                            ) : logs.length === 0 ? (
                                <div className="flex items-center justify-center h-32">
                                    <Typography variant="body2" color="disabled">No executions yet</Typography>
                                </div>
                            ) : (
                                <div className="divide-y divide-surface-100 dark:divide-surface-950">
                                    {logs.map((log, idx) => (
                                        <LogRow key={idx} log={log}/>
                                    ))}
                                </div>
                            )}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

function StatCard({ label, value, mono, chipColor, highlight }: {
    label: string; value: string; mono?: boolean; chipColor?: string; highlight?: boolean;
}) {
    return (
        <div className={cls("px-3 py-2 rounded-lg border bg-white dark:bg-surface-900", defaultBorderMixin)}>
            <Typography variant="caption" color="secondary" className="text-[10px] uppercase tracking-wider font-medium">{label}</Typography>
            <Typography variant="body2" className={cls(
                "mt-0.5 font-semibold text-[13px]",
                mono && "font-mono",
                highlight && "text-red-500 dark:text-red-400",
                chipColor === "red" && "text-red-500",
                chipColor === "green" && "text-emerald-500",
                chipColor === "gray" && "text-surface-400"
            )}>{value}</Typography>
        </div>
    );
}

function LogRow({ log }: { log: CronJobLogEntry }) {
    const [expanded, setExpanded] = useState(false);
    return (
        <div className="px-5 py-2.5 hover:bg-surface-50 dark:hover:bg-surface-950/50 transition-colors">
            <div className="flex items-center gap-3 cursor-pointer" onClick={() => setExpanded(!expanded)}>
                {log.success
                    ? <CheckCircleIcon size={iconSize.smallest} className="text-emerald-500 shrink-0"/>
                    : <AlertCircleIcon size={iconSize.smallest} className="text-red-500 shrink-0"/>}
                <div className="flex-1 min-w-0">
                    <Typography variant="caption" className="font-mono text-[11px] text-surface-500">{new Date(log.startedAt).toLocaleString()}</Typography>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    {log.manual && <Chip size="smallest" className="bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">manual</Chip>}
                    <Typography variant="caption" className="font-mono text-[11px]">{formatDuration(log.durationMs)}</Typography>
                    <svg className={cls("w-3 h-3 transition-transform text-surface-400", expanded && "rotate-180")} fill="currentColor" viewBox="0 0 20 20"><path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"/></svg>
                </div>
            </div>
            {expanded && (
                <div className="mt-2 ml-6 space-y-2">
                    {log.error && (
                        <div className="p-2 rounded bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50">
                            <Typography variant="caption" className="font-mono text-[11px] text-red-600 dark:text-red-300 break-all">{log.error}</Typography>
                        </div>
                    )}
                    {log.logs.length > 0 && (
                        <div className="p-2 rounded bg-surface-50 dark:bg-surface-900 border border-surface-200 dark:border-surface-700 max-h-40 overflow-auto">
                            {log.logs.map((line, i) => (
                                <div key={i} className="font-mono text-[11px] text-surface-600 dark:text-surface-400 leading-relaxed">{line}</div>
                            ))}
                        </div>
                    )}
                    {log.result !== undefined && (
                        <div className="p-2 rounded bg-surface-50 dark:bg-surface-900 border border-surface-200 dark:border-surface-700">
                            <Typography variant="caption" className="text-[10px] uppercase tracking-wider text-surface-400 mb-1 block">Result</Typography>
                            <pre className="font-mono text-[11px] text-surface-600 dark:text-surface-400 whitespace-pre-wrap break-all">{JSON.stringify(log.result, null, 2)}</pre>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
