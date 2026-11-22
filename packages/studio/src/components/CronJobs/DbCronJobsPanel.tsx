import React, { useCallback, useEffect, useState } from "react";
import {
    Alert,
    BooleanSwitch,
    BooleanSwitchWithLabel,
    Button,
    Card,
    Chip,
    CircularProgress,
    cls,
    defaultBorderMixin,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    PencilIcon,
    IconButton,
    iconSize,
    PlusIcon,
    RefreshCwIcon,
    Select,
    SelectItem,
    Table,
    TableBody,
    TableCell,
    TableHeader,
    TableRow,
    TextField,
    Tooltip,
    Trash2Icon,
    Typography
} from "@rebasepro/ui";
import { useSnackbarController, useTranslation } from "@rebasepro/app";
import {
    asBoolean,
    asString,
    isRecord,
    useAdminFetch
} from "../../utils/adminFetch";

interface StoredCronJobRow {
    id: string;
    name: string;
    schedule: string;
    kind: "http" | "sql";
    config: Record<string, unknown>;
    enabled: boolean;
}

const SCHEDULE_PRESETS = [
    { label: "Every minute", value: "* * * * *" },
    { label: "Every 5 minutes", value: "*/5 * * * *" },
    { label: "Every hour", value: "0 * * * *" },
    { label: "Daily at midnight", value: "0 0 * * *" }
] as const;

function parseJob(raw: unknown): StoredCronJobRow | null {
    if (!isRecord(raw) || typeof raw.id !== "string") return null;
    const kind = raw.kind === "sql" ? "sql" : "http";
    return {
        id: raw.id,
        name: asString(raw.name),
        schedule: asString(raw.schedule),
        kind,
        config: isRecord(raw.config) ? raw.config : {},
        enabled: asBoolean(raw.enabled, true)
    };
}

export function DbCronJobsPanel() {
    const { requestJson } = useAdminFetch();
    const snackbar = useSnackbarController();
    const { t } = useTranslation();

    const [jobs, setJobs] = useState<StoredCronJobRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [dialogOpen, setDialogOpen] = useState(false);
    const [editing, setEditing] = useState<StoredCronJobRow | null>(null);
    const [name, setName] = useState("");
    const [schedule, setSchedule] = useState("*/5 * * * *");
    const [kind, setKind] = useState<"http" | "sql">("sql");
    const [sqlText, setSqlText] = useState("DELETE FROM sessions WHERE expires_at < NOW();");
    const [httpUrl, setHttpUrl] = useState("https://");
    const [enabled, setEnabled] = useState(true);
    const [saving, setSaving] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const raw = await requestJson("/admin/cron/jobs");
            const arr = isRecord(raw) && Array.isArray(raw.jobs) ? raw.jobs : [];
            setJobs(arr.map(parseJob).filter((j): j is StoredCronJobRow => j !== null));
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Failed to load scheduled jobs.");
        } finally {
            setLoading(false);
        }
    }, [requestJson]);

    useEffect(() => {
        void load();
    }, [load]);

    const openCreate = () => {
        setEditing(null);
        setName("");
        setSchedule("*/5 * * * *");
        setKind("sql");
        setSqlText("");
        setHttpUrl("https://");
        setEnabled(true);
        setDialogOpen(true);
    };

    const openEdit = (j: StoredCronJobRow) => {
        setEditing(j);
        setName(j.name);
        setSchedule(j.schedule);
        setKind(j.kind);
        setSqlText(asString(j.config.sql));
        setHttpUrl(asString(j.config.url, "https://"));
        setEnabled(j.enabled);
        setDialogOpen(true);
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            const config = kind === "sql"
                ? { sql: sqlText.trim() }
                : { url: httpUrl.trim() };
            const payload = { name: name.trim(), schedule: schedule.trim(), kind, config, enabled };
            if (editing) {
                await requestJson(`/admin/cron/jobs/${encodeURIComponent(editing.id)}`, {
                    method: "PATCH",
                    body: payload
                });
                snackbar.open({ type: "success", message: `Scheduled job "${payload.name}" updated.` });
            } else {
                await requestJson("/admin/cron/jobs", {
                    method: "POST",
                    body: payload
                });
                snackbar.open({ type: "success", message: `Scheduled job "${payload.name}" created.` });
            }
            setDialogOpen(false);
            await load();
        } catch (err: unknown) {
            snackbar.open({ type: "error", message: err instanceof Error ? err.message : "Failed to save scheduled job." });
        } finally {
            setSaving(false);
        }
    };

    const handleToggle = async (j: StoredCronJobRow, next: boolean) => {
        try {
            await requestJson(`/admin/cron/jobs/${encodeURIComponent(j.id)}`, {
                method: "PATCH",
                body: { enabled: next }
            });
            await load();
        } catch (err: unknown) {
            snackbar.open({ type: "error", message: err instanceof Error ? err.message : "Failed to toggle job." });
        }
    };

    const handleDelete = async (j: StoredCronJobRow) => {
        try {
            await requestJson(`/admin/cron/jobs/${encodeURIComponent(j.id)}`, { method: "DELETE" });
            snackbar.open({ type: "success", message: `Deleted scheduled job "${j.name}".` });
            await load();
        } catch (err: unknown) {
            snackbar.open({ type: "error", message: err instanceof Error ? err.message : "Failed to delete job." });
        }
    };

    return (
        <div className="flex flex-col gap-4 p-5 h-full overflow-auto">
            <div className="flex items-center justify-between gap-4">
                <div>
                    <Typography variant="subtitle1" className="font-semibold">
                        Zero-Code Scheduled Jobs
                    </Typography>
                    <Typography variant="caption" color="secondary">
                        Run recurring SQL statements or HTTP webhooks on a cron schedule without deploying custom code
                    </Typography>
                </div>
                <div className="flex items-center gap-2">
                    <Tooltip title="Refresh">
                        <IconButton size="small" aria-label="Refresh scheduled jobs" onClick={() => void load()}>
                            <RefreshCwIcon size={iconSize.small} />
                        </IconButton>
                    </Tooltip>
                    <Button size="small" variant="filled" onClick={openCreate}>
                        <PlusIcon size={iconSize.small} />
                        New Scheduled Job
                    </Button>
                </div>
            </div>

            {error && <Alert color="error">{error}</Alert>}

            {loading ? (
                <div className="flex justify-center py-12"><CircularProgress size="small" /></div>
            ) : jobs.length === 0 ? (
                <Card className="p-8 text-center flex flex-col items-center gap-3">
                    <Typography variant="body2" color="secondary">
                        No database-managed cron jobs yet.
                    </Typography>
                    <Button size="small" variant="filled" onClick={openCreate}>
                        <PlusIcon size={iconSize.small} />
                        Create Scheduled Job
                    </Button>
                </Card>
            ) : (
                <div className={cls("overflow-x-auto rounded-lg border", defaultBorderMixin)}>
                    <Table className="w-full">
                        <TableHeader>
                                <TableCell header>Name</TableCell>
                                <TableCell header>{t("studio_cron_schedule")}</TableCell>
                                <TableCell header>Kind</TableCell>
                                <TableCell header>Target</TableCell>
                                <TableCell header>Enabled</TableCell>
                                <TableCell header className="text-right">Actions</TableCell>
                            </TableHeader>
                        <TableBody>
                            {jobs.map((j) => (
                                <TableRow key={j.id}>
                                    <TableCell className="font-medium text-sm">{j.name}</TableCell>
                                    <TableCell className="font-mono text-xs">{j.schedule}</TableCell>
                                    <TableCell>
                                        <Chip size="small" colorScheme={j.kind === "sql" ? "blueLight" : "purpleLight"}>
                                            {j.kind.toUpperCase()}
                                        </Chip>
                                    </TableCell>
                                    <TableCell className="font-mono text-xs text-text-secondary max-w-md truncate">
                                        {j.kind === "sql" ? asString(j.config.sql) : `POST ${asString(j.config.url)}`}
                                    </TableCell>
                                    <TableCell>
                                        <BooleanSwitch size="small" value={j.enabled} onValueChange={(v) => void handleToggle(j, v)} />
                                    </TableCell>
                                    <TableCell className="text-right whitespace-nowrap">
                                        <IconButton size="small" aria-label={`Edit job ${j.name}`} onClick={() => openEdit(j)}>
                                            <PencilIcon size={iconSize.small} />
                                        </IconButton>
                                        <IconButton size="small" aria-label={`Delete job ${j.name}`} onClick={() => void handleDelete(j)}>
                                            <Trash2Icon size={iconSize.small} className={"text-red-500"} />
                                        </IconButton>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            )}

            <Dialog open={dialogOpen} onOpenChange={setDialogOpen} maxWidth="md" fullWidth>
                <DialogTitle>{editing ? `Edit Job "${editing.name}"` : "New Scheduled Job"}</DialogTitle>
                <DialogContent className="flex flex-col gap-3">
                    <TextField label="Job Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="cleanup_expired_tokens" />
                    <TextField label="Cron Schedule (5-field)" value={schedule} onChange={(e) => setSchedule(e.target.value)} placeholder="*/5 * * * *" />
                    <div className="flex items-center gap-1.5 flex-wrap">
                        {SCHEDULE_PRESETS.map((p) => (
                            <Chip key={p.value} size="small" colorScheme={schedule === p.value ? "blueLight" : "grayLight"} onClick={() => setSchedule(p.value)}>
                                {p.label}
                            </Chip>
                        ))}
                    </div>
                    <Select
                        label="Job Type"
                        value={kind}
                        onValueChange={(v) => { if (v === "sql" || v === "http") setKind(v); }}
                    >
                        <SelectItem value="sql">SQL Statement</SelectItem>
                        <SelectItem value="http">HTTP Request</SelectItem>
                    </Select>
                    {kind === "sql" ? (
                        <TextField
                            label="SQL Statement"
                            value={sqlText}
                            onChange={(e) => setSqlText(e.target.value)}
                            multiline
                            minRows={4}
                            placeholder="DELETE FROM audit_logs WHERE created_at < NOW() - INTERVAL '30 days';"
                        />
                    ) : (
                        <TextField label="HTTP POST Webhook URL" value={httpUrl} onChange={(e) => setHttpUrl(e.target.value)} placeholder="https://example.com/cron/sync" />
                    )}
                    <BooleanSwitchWithLabel label="Enabled" value={enabled} onValueChange={setEnabled} />
                </DialogContent>
                <DialogActions>
                    <Button variant="text" onClick={() => setDialogOpen(false)}>Cancel</Button>
                    <Button
                        variant="filled"
                        disabled={saving || !name.trim() || !schedule.trim() || (kind === "sql" ? !sqlText.trim() : !httpUrl.trim())}
                        onClick={() => void handleSave()}
                    >
                        {saving ? t("saving") : "Save Job"}
                    </Button>
                </DialogActions>
            </Dialog>
        </div>
    );
}
