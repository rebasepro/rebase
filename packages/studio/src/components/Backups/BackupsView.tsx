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
    Typography
} from "@rebasepro/ui";
import { useRebaseClient, useSnackbarController, useTranslation } from "@rebasepro/app";
import type { BackupInfo, RebaseClient } from "@rebasepro/types";

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

export function BackupsView() {
    const client = useRebaseClient<RebaseClient>();
    const snackbar = useSnackbarController();
    const { t } = useTranslation();

    const [backups, setBackups] = useState<BackupInfo[]>([]);
    const [destinationKind, setDestinationKind] = useState<string>("local");
    const [configured, setConfigured] = useState(true);
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

    const handleDownload = async (backup: BackupInfo) => {
        const c = clientRef.current;
        if (!c?.backups) return;
        setDownloading(backup.key);
        try {
            const blob = await c.backups.download(backup.key);
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = backup.name;
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
                <Typography variant="h6" color="secondary">Backups Not Available</Typography>
                <Typography variant="body2" color="disabled" className="max-w-md">
                    The backups API is not exposed by this backend.
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
        <div className="flex flex-col h-full w-full overflow-hidden bg-white dark:bg-surface-950">
            {/* Header */}
            <div className={cls("flex items-center justify-between px-5 py-2.5 border-b bg-surface-50 dark:bg-surface-900 min-h-[48px]", defaultBorderMixin)}>
                <div className="flex items-center gap-2">
                    <DatabaseIcon size={iconSize.small} className="text-primary"/>
                    <Typography variant="subtitle2" className="font-semibold">{t("studio_tool_backups")}</Typography>
                    <Chip size="smallest" className="bg-surface-200 dark:bg-surface-700 text-surface-600 dark:text-surface-300">{backups.length}</Chip>
                    <Chip size="smallest" className="bg-surface-100 dark:bg-surface-800 text-surface-500 dark:text-surface-400 uppercase font-mono text-[10px]">{destinationKind}</Chip>
                </div>
                <IconButton size="small" onClick={load} title="Refresh">
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
                ) : !configured ? (
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
                    <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
                        <DatabaseIcon size={iconSize.large} className="text-surface-200 dark:text-surface-700"/>
                        <Typography variant="body2" color="disabled">
                            No backups found yet. Run <code className="font-mono text-[12px]">rebase db backup</code> or wait for the next scheduled run.
                        </Typography>
                    </div>
                ) : (
                    <div className="space-y-2 max-w-3xl">
                        {backups.map(backup => (
                            <div
                                key={backup.key}
                                className={cls("flex items-center gap-3 px-4 py-3 rounded-lg border bg-white dark:bg-surface-900", defaultBorderMixin)}
                            >
                                <DatabaseIcon size={iconSize.small} className="text-surface-400 shrink-0"/>
                                <div className="flex-1 min-w-0">
                                    <Typography variant="body2" className="truncate font-medium font-mono text-[12px]">{backup.name}</Typography>
                                    <Typography variant="caption" color="secondary" className="text-[11px]">
                                        {formatDate(backup.createdAt)} · {formatSize(backup.sizeBytes)}
                                    </Typography>
                                </div>
                                <Button
                                    size="small"
                                    variant="outlined"
                                    onClick={() => handleDownload(backup)}
                                    disabled={downloading === backup.key}
                                    startIcon={downloading === backup.key
                                        ? <CircularProgress size="smallest"/>
                                        : <DownloadIcon size={iconSize.smallest}/>}
                                >
                                    {downloading === backup.key ? t("studio_backups_downloading") : t("download")}
                                </Button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
