import React, { useCallback, useEffect, useRef, useState } from "react";
import {
    ActivityIcon,
    cls,
    defaultBorderMixin,
    IconButton,
    iconSize,
    PauseIcon,
    PlayIcon,
    PowerIcon,
    RefreshCwIcon,
    StatusDot,
    Table,
    TableBody,
    TableCell,
    TableHeader,
    TableRow,
    Tooltip,
    Typography,
    XCircleIcon
} from "@rebasepro/ui";
import { useSnackbarController, useTranslation } from "@rebasepro/app";
import { asNullableString, asNumber, asString, isRecord, useAdminFetch } from "../../utils/adminFetch";
import { useSourcePath } from "./source";
import { formatDuration } from "./format";
import { EmptyState, LoadingRow, SectionHeader, SectionLoadFailure, statementsOf, useConfirmSql } from "./shared";
import { classifyLoadFailure, type LoadFailure } from "../load-failure";

/** How often the session list is re-read while it is on screen. */
export const ACTIVITY_REFRESH_MS = 5_000;

interface Session {
    pid: number;
    username: string | null;
    applicationName: string;
    state: string | null;
    waitEventType: string | null;
    waitEvent: string | null;
    query: string;
    durationMs: number;
    blockedBy: number[];
}

function parseSession(raw: unknown): Session | null {
    if (!isRecord(raw) || typeof raw.pid !== "number") return null;
    return {
        pid: raw.pid,
        username: asNullableString(raw.username),
        applicationName: asString(raw.applicationName),
        state: asNullableString(raw.state),
        waitEventType: asNullableString(raw.waitEventType),
        waitEvent: asNullableString(raw.waitEvent),
        query: asString(raw.query),
        durationMs: asNumber(raw.durationMs),
        blockedBy: Array.isArray(raw.blockedBy) ? raw.blockedBy.filter((pid): pid is number => typeof pid === "number") : []
    };
}

/**
 * The database's sessions that are doing something, re-read every five
 * seconds while this section is mounted and the page is visible — telemetry,
 * which has no realtime feed to subscribe to — unless the reader pauses it.
 */
export function ActivitySection() {
    const { t, i18n } = useTranslation();
    const snackbar = useSnackbarController();
    const { requestJson } = useAdminFetch();
    const sourcePath = useSourcePath();
    const [sessions, setSessions] = useState<Session[] | null>(null);
    /** Why the sessions could not be read, classified — see `load-failure.ts`. */
    const [failure, setFailure] = useState<LoadFailure | null>(null);
    const [paused, setPaused] = useState(false);
    const [pageVisible, setPageVisible] = useState(() => typeof document === "undefined" || document.visibilityState !== "hidden");
    const [confirmDialog, confirm] = useConfirmSql();
    const inFlight = useRef(false);

    const load = useCallback(async () => {
        if (inFlight.current) return;
        inFlight.current = true;
        try {
            const raw = await requestJson(sourcePath("/admin/db/insights/activity"));
            const list = isRecord(raw) && Array.isArray(raw.sessions) ? raw.sessions : [];
            setSessions(list.map(parseSession).filter((session): session is Session => session !== null));
            setFailure(null);
        } catch (err: unknown) {
            setFailure(classifyLoadFailure(err, { toolLevel: true }));
        } finally {
            inFlight.current = false;
        }
    }, [requestJson, sourcePath]);

    // A server that does not serve the sessions route will not start to between
    // two refreshes: stop asking until the reader refreshes by hand.
    const notOffered = failure?.kind === "not_offered";

    useEffect(() => {
        const onVisibility = () => setPageVisible(document.visibilityState !== "hidden");
        document.addEventListener("visibilitychange", onVisibility);
        return () => document.removeEventListener("visibilitychange", onVisibility);
    }, []);

    useEffect(() => {
        if (notOffered) return undefined;
        void load();
        if (paused || !pageVisible) return undefined;
        const timer = setInterval(() => void load(), ACTIVITY_REFRESH_MS);
        return () => clearInterval(timer);
    }, [load, paused, pageVisible, notOffered]);

    const cancel = async (session: Session) => {
        try {
            const raw = await requestJson(sourcePath(`/admin/db/insights/activity/${session.pid}/cancel`), { method: "POST", body: {} });
            const signalled = isRecord(raw) && raw.signalled === true;
            snackbar.open({
                type: signalled ? "success" : "warning",
                message: t(signalled ? "studio_database_activity_cancelled" : "studio_database_activity_not_signalled", { pid: session.pid })
            });
            await load();
        } catch (err: unknown) {
            snackbar.open({ type: "error", message: err instanceof Error ? err.message : t("studio_database_action_failed") });
        }
    };

    const askTerminate = (session: Session) => confirm({
        title: t("studio_database_activity_terminate_title", { pid: session.pid }),
        body: t("studio_database_activity_terminate_body"),
        confirmLabel: t("studio_database_activity_terminate"),
        preview: async () => statementsOf(await requestJson(sourcePath(`/admin/db/insights/activity/${session.pid}/terminate`), { method: "POST", body: { dryRun: true } })),
        run: async () => {
            await requestJson(sourcePath(`/admin/db/insights/activity/${session.pid}/terminate`), { method: "POST", body: {} });
            snackbar.open({ type: "success", message: t("studio_database_activity_terminated", { pid: session.pid }) });
            await load();
        }
    });

    const stateTone = (session: Session) =>
        session.blockedBy.length > 0 ? "bad" : session.state === "active" ? "ok" : session.state?.startsWith("idle in transaction") ? "busy" : "idle";

    return (
        <div className="flex flex-col gap-4">
            <SectionHeader
                title={t("studio_database_section_activity")}
                description={paused ? t("studio_database_activity_paused") : t("studio_database_activity_description")}
                actions={<>
                    <Tooltip title={paused ? t("studio_database_activity_resume") : t("studio_database_activity_pause")}>
                        <IconButton
                            size="small"
                            aria-label={paused ? t("studio_database_activity_resume") : t("studio_database_activity_pause")}
                            aria-pressed={paused}
                            onClick={() => setPaused(value => !value)}
                        >
                            {paused ? <PlayIcon size={iconSize.small}/> : <PauseIcon size={iconSize.small}/>}
                        </IconButton>
                    </Tooltip>
                    <Tooltip title={t("refresh")}>
                        <IconButton size="small" aria-label={t("studio_database_refresh_aria")} onClick={() => void load()}>
                            <RefreshCwIcon size={iconSize.small}/>
                        </IconButton>
                    </Tooltip>
                </>}
            />
            {failure && <SectionLoadFailure failure={failure} stale={sessions !== null} onRetry={() => void load()}/>}
            {sessions === null ? (failure ? null : <LoadingRow/>) : sessions.length === 0 ? (
                <EmptyState icon={<ActivityIcon size={iconSize.large}/>} message={t("studio_database_activity_empty")}/>
            ) : (
                <div className={cls("overflow-x-auto rounded-lg border", defaultBorderMixin)}>
                    <Table className="w-full">
                        <TableHeader>
                            <TableCell header>{t("studio_database_activity_pid")}</TableCell>
                            <TableCell header>{t("studio_database_activity_state")}</TableCell>
                            <TableCell header className="text-right">{t("studio_database_activity_duration")}</TableCell>
                            <TableCell header>{t("studio_database_activity_wait")}</TableCell>
                            <TableCell header>{t("studio_database_queries_query")}</TableCell>
                            <TableCell header className="text-right">{t("actions")}</TableCell>
                        </TableHeader>
                        <TableBody>
                            {sessions.map(session => (
                                <TableRow key={session.pid}>
                                    <TableCell className="tabular-nums font-mono text-xs">
                                        {session.pid}
                                        <Typography variant="caption" color="secondary" className="block font-sans">
                                            {[session.username, session.applicationName].filter(Boolean).join(" · ")}
                                        </Typography>
                                    </TableCell>
                                    <TableCell>
                                        <StatusDot tone={stateTone(session)} size="small">{session.state ?? t("studio_database_activity_unknown_state")}</StatusDot>
                                        {session.blockedBy.length > 0 && (
                                            <Typography variant="caption" color="error" className="block">
                                                {t("studio_database_activity_blocked_by", { pids: session.blockedBy.join(", ") })}
                                            </Typography>
                                        )}
                                    </TableCell>
                                    <TableCell className="text-right tabular-nums whitespace-nowrap">{formatDuration(session.durationMs, i18n.language)}</TableCell>
                                    <TableCell>
                                        <Typography variant="caption" color="secondary">
                                            {session.waitEventType ? `${session.waitEventType}: ${session.waitEvent ?? ""}` : "—"}
                                        </Typography>
                                    </TableCell>
                                    <TableCell className="max-w-xl">
                                        <Typography variant="mono" className="text-xs line-clamp-2 break-all">{session.query}</Typography>
                                    </TableCell>
                                    <TableCell className="text-right whitespace-nowrap">
                                        <Tooltip title={t("studio_database_activity_cancel")}>
                                            <IconButton
                                                size="small"
                                                aria-label={t("studio_database_activity_cancel_aria", { pid: session.pid })}
                                                onClick={() => void cancel(session)}
                                            >
                                                <XCircleIcon size={iconSize.small}/>
                                            </IconButton>
                                        </Tooltip>
                                        <Tooltip title={t("studio_database_activity_terminate")}>
                                            <IconButton
                                                size="small"
                                                aria-label={t("studio_database_activity_terminate_aria", { pid: session.pid })}
                                                onClick={() => askTerminate(session)}
                                            >
                                                <PowerIcon size={iconSize.small} className="text-red-500"/>
                                            </IconButton>
                                        </Tooltip>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            )}
            {confirmDialog}
        </div>
    );
}
