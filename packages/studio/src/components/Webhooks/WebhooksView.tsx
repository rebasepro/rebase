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
    PlayIcon,
    PlusIcon,
    RefreshCwIcon,
    Table,
    TableBody,
    TableCell,
    TableHeader,
    TableRow,
    TextField,
    Tooltip,
    Trash2Icon,
    Typography,
    SendIcon,
    WebhookIcon
} from "@rebasepro/ui";
import { useSnackbarController, useTableDescriptors, useTranslation } from "@rebasepro/app";
import {
    asBoolean,
    asNullableString,
    asNumber,
    asString,
    asStringArray,
    isRecord,
    useAdminFetch
} from "../../utils/adminFetch";

const WEBHOOK_EVENTS = ["INSERT", "UPDATE", "DELETE"] as const;

interface WebhookRow {
    id: string;
    name: string;
    url: string;
    events: string[];
    table: string;
    hasSecret: boolean;
    headers: Record<string, string>;
    enabled: boolean;
}

function parseHeaders(raw: unknown): Record<string, string> {
    if (!isRecord(raw)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
        if (typeof v === "string") out[k] = v;
    }
    return out;
}

function parseWebhook(raw: unknown): WebhookRow | null {
    if (!isRecord(raw) || typeof raw.id !== "string") return null;
    const legacyTables = asStringArray(raw.tables);
    const table = typeof raw.table === "string" && raw.table.trim() !== ""
        ? raw.table.trim()
        : (legacyTables[0] ?? "*");
    return {
        id: raw.id,
        name: asString(raw.name),
        url: asString(raw.url),
        events: asStringArray(raw.events),
        table,
        hasSecret: asBoolean(raw.hasSecret, typeof raw.secret === "string" && raw.secret.length > 0),
        headers: parseHeaders(raw.headers),
        enabled: asBoolean(raw.enabled, true)
    };
}

export function WebhooksView() {
    const { requestJson } = useAdminFetch();
    const { tables: descriptors } = useTableDescriptors();
    const snackbar = useSnackbarController();
    const { t } = useTranslation();

    const [webhooks, setWebhooks] = useState<WebhookRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [testingId, setTestingId] = useState<string | null>(null);

    const [dialogOpen, setDialogOpen] = useState(false);
    const [editing, setEditing] = useState<WebhookRow | null>(null);
    const [name, setName] = useState("");
    const [url, setUrl] = useState("");
    const [events, setEvents] = useState<string[]>(["INSERT", "UPDATE", "DELETE"]);
    const [selectedTable, setSelectedTable] = useState<string>("*");
    const [secret, setSecret] = useState("");
    const [headersText, setHeadersText] = useState("{}");
    const [enabled, setEnabled] = useState(true);
    const [saving, setSaving] = useState(false);

    const loadWebhooks = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const raw = await requestJson("/admin/webhooks");
            const arr = isRecord(raw) && Array.isArray(raw.webhooks) ? raw.webhooks : [];
            setWebhooks(arr.map(parseWebhook).filter((w): w is WebhookRow => w !== null));
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : t("studio_webhooks_load_failed"));
        } finally {
            setLoading(false);
        }
    }, [requestJson, t]);

    useEffect(() => {
        void loadWebhooks();
    }, [loadWebhooks]);

    const openCreate = () => {
        setEditing(null);
        setName("");
        setUrl("https://");
        setEvents(["INSERT", "UPDATE", "DELETE"]);
        setSelectedTable("*");
        setSecret("");
        setHeadersText("{}");
        setEnabled(true);
        setDialogOpen(true);
    };

    const openEdit = (w: WebhookRow) => {
        setEditing(w);
        setName(w.name);
        setUrl(w.url);
        setEvents([...w.events]);
        setSelectedTable(w.table || "*");
        setSecret("");
        setHeadersText(JSON.stringify(w.headers, null, 2));
        setEnabled(w.enabled);
        setDialogOpen(true);
    };

    const toggleEvent = (ev: string) => {
        setEvents((prev) => prev.includes(ev) ? prev.filter((e) => e !== ev) : [...prev, ev]);
    };

    const handleSave = async () => {
        let parsedHeaders: Record<string, string> = {};
        if (headersText.trim()) {
            try {
                const json: unknown = JSON.parse(headersText);
                if (!isRecord(json)) {
                    snackbar.open({ type: "error", message: t("studio_webhooks_headers_not_object") });
                    return;
                }
                parsedHeaders = parseHeaders(json);
            } catch {
                snackbar.open({ type: "error", message: t("studio_webhooks_headers_invalid_json") });
                return;
            }
        }

        setSaving(true);
        try {
            const payload: Record<string, unknown> = {
                name: name.trim(),
                url: url.trim(),
                events,
                table: selectedTable.trim() || "*",
                headers: parsedHeaders,
                enabled
            };
            if (secret.trim()) {
                payload.secret = secret.trim();
            }
            if (editing) {
                await requestJson(`/admin/webhooks/${encodeURIComponent(editing.id)}`, {
                    method: "PATCH",
                    body: payload
                });
                snackbar.open({ type: "success", message: t("studio_webhooks_updated", { name: name.trim() }) });
            } else {
                await requestJson("/admin/webhooks", {
                    method: "POST",
                    body: payload
                });
                snackbar.open({ type: "success", message: t("studio_webhooks_created", { name: name.trim() }) });
            }
            setDialogOpen(false);
            await loadWebhooks();
        } catch (err: unknown) {
            snackbar.open({ type: "error", message: err instanceof Error ? err.message : t("studio_webhooks_save_failed") });
        } finally {
            setSaving(false);
        }
    };

    const handleToggleEnabled = async (w: WebhookRow, nextEnabled: boolean) => {
        try {
            await requestJson(`/admin/webhooks/${encodeURIComponent(w.id)}`, {
                method: "PATCH",
                body: { enabled: nextEnabled }
            });
            await loadWebhooks();
        } catch (err: unknown) {
            snackbar.open({ type: "error", message: err instanceof Error ? err.message : t("studio_webhooks_toggle_failed") });
        }
    };

    const handleTest = async (w: WebhookRow) => {
        setTestingId(w.id);
        try {
            const raw = await requestJson(`/admin/webhooks/${encodeURIComponent(w.id)}/test`, { method: "POST" });
            const delivery = isRecord(raw) && isRecord(raw.delivery) ? raw.delivery : (isRecord(raw) ? raw : {});
            const status = asNumber(delivery.statusCode ?? delivery.status, 0);
            const ok = asBoolean(delivery.success ?? delivery.ok, status >= 200 && status < 300);
            const errText = asString(delivery.error);
            snackbar.open({
                type: ok ? "success" : "error",
                message: ok
                    ? t("studio_webhooks_test_succeeded", { status })
                    : t("studio_webhooks_test_failed_detail", { detail: status ? `HTTP ${status}` : (errText || t("studio_webhooks_network_error")) })
            });
        } catch (err: unknown) {
            snackbar.open({ type: "error", message: err instanceof Error ? err.message : t("studio_webhooks_test_failed") });
        } finally {
            setTestingId(null);
        }
    };

    const handleDelete = async (w: WebhookRow) => {
        try {
            await requestJson(`/admin/webhooks/${encodeURIComponent(w.id)}`, { method: "DELETE" });
            snackbar.open({ type: "success", message: t("studio_webhooks_deleted", { name: w.name }) });
            await loadWebhooks();
        } catch (err: unknown) {
            snackbar.open({ type: "error", message: err instanceof Error ? err.message : t("studio_webhooks_delete_failed") });
        }
    };

    return (
        <div className="flex flex-col h-full w-full bg-surface-sheet overflow-hidden">
            <div className={cls("px-5 py-3 border-b flex items-center justify-between gap-4", defaultBorderMixin)}>
                <div className="flex items-center gap-2.5">
                    <WebhookIcon size={iconSize.medium} className={"text-text-secondary"} />
                    <div>
                        <Typography variant="h6">{t("studio_tool_webhooks")}</Typography>
                        <Typography variant="caption" color="secondary">
                            {t("studio_webhooks_subtitle")}
                        </Typography>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Tooltip title={t("refresh")}>
                        <IconButton size="small" aria-label={t("studio_webhooks_refresh_aria")} onClick={() => void loadWebhooks()}>
                            <RefreshCwIcon size={iconSize.small} />
                        </IconButton>
                    </Tooltip>
                    <Button size="small" color="primary" variant="filled" onClick={openCreate}>
                        <PlusIcon size={iconSize.small} />
                        {t("studio_webhooks_new")}
                    </Button>
                </div>
            </div>

            <div className="flex-1 overflow-auto p-5 flex flex-col gap-4 bg-surface-card">
                {error && <Alert color="error">{error}</Alert>}

                {loading ? (
                    <div className="flex justify-center py-12"><CircularProgress size="small" /></div>
                ) : webhooks.length === 0 ? (
                    <Card className="p-8 text-center flex flex-col items-center gap-3">
                        <SendIcon className="w-8 h-8 text-text-disabled" />
                        <Typography variant="body2" color="secondary">
                            {t("studio_webhooks_empty")}
                        </Typography>
                        <Button size="small" variant="filled" onClick={openCreate}>
                            <PlusIcon size={iconSize.small} />
                            {t("studio_webhooks_create")}
                        </Button>
                    </Card>
                ) : (
                    <div className={cls("overflow-x-auto rounded-lg border", defaultBorderMixin)}>
                        <Table className="w-full">
                            <TableHeader>
                                    <TableCell header>{t("name")}</TableCell>
                                    <TableCell header>{t("studio_webhooks_endpoint_url")}</TableCell>
                                    <TableCell header>{t("studio_tool_tables")}</TableCell>
                                    <TableCell header>{t("studio_events")}</TableCell>
                                    <TableCell header>{t("studio_enabled")}</TableCell>
                                    <TableCell header className="text-right">{t("actions")}</TableCell>
                                </TableHeader>
                            <TableBody>
                                {webhooks.map((w) => (
                                    <TableRow key={w.id}>
                                        <TableCell className="font-medium text-sm">{w.name}</TableCell>
                                        <TableCell className="font-mono text-xs text-text-secondary max-w-xs truncate">{w.url}</TableCell>
                                        <TableCell>
                                            <div className="flex items-center gap-1 flex-wrap">
                                                {w.table === "*" ? (
                                                    <Chip size="small" colorScheme="grayLight">{t("studio_webhooks_all_tables")}</Chip>
                                                ) : (
                                                    <Chip size="small" colorScheme="blueLight">{w.table}</Chip>
                                                )}
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex items-center gap-1 flex-wrap">
                                                {w.events.map((ev) => (
                                                    <Chip key={ev} size="small" colorScheme="purpleLight">{ev}</Chip>
                                                ))}
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <BooleanSwitch
                                                size="small"
                                                value={w.enabled}
                                                onValueChange={(v) => void handleToggleEnabled(w, v)}
                                            />
                                        </TableCell>
                                        <TableCell className="text-right whitespace-nowrap">
                                            <Tooltip title={t("studio_webhooks_send_test")}>
                                                <IconButton
                                                    size="small"
                                                    aria-label={t("studio_webhooks_test_aria", { name: w.name })}
                                                    disabled={testingId === w.id}
                                                    onClick={() => void handleTest(w)}
                                                >
                                                    <PlayIcon size={iconSize.small} />
                                                </IconButton>
                                            </Tooltip>
                                            <IconButton size="small" aria-label={t("studio_webhooks_edit_aria", { name: w.name })} onClick={() => openEdit(w)}>
                                                <PencilIcon size={iconSize.small} />
                                            </IconButton>
                                            <IconButton size="small" aria-label={t("studio_webhooks_delete_aria", { name: w.name })} onClick={() => void handleDelete(w)}>
                                                <Trash2Icon size={iconSize.small} className={"text-red-500"} />
                                            </IconButton>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                )}
            </div>

            <Dialog open={dialogOpen} onOpenChange={setDialogOpen} maxWidth="lg" fullWidth>
                <DialogTitle>{editing ? t("studio_webhooks_edit_title", { name: editing.name }) : t("studio_webhooks_new_title")}</DialogTitle>
                <DialogContent className="flex flex-col gap-4">
                    <TextField
                        label={t("name")}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder={t("studio_webhooks_name_placeholder")}
                    />
                    <TextField
                        label={t("studio_webhooks_destination_url")}
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        placeholder="https://example.com/webhooks/rebase"
                    />
                    <div className="flex flex-col gap-1.5">
                        <Typography variant="subtitle2">{t("studio_events")}</Typography>
                        <div className="flex items-center gap-2">
                            {WEBHOOK_EVENTS.map((ev) => (
                                <Chip
                                    key={ev}
                                    size="small"
                                    colorScheme={events.includes(ev) ? "purpleLight" : "grayLight"}
                                    onClick={() => toggleEvent(ev)}
                                >
                                    {ev}
                                </Chip>
                            ))}
                        </div>
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <Typography variant="subtitle2">{t("studio_webhooks_target_table")}</Typography>
                        <div className="flex items-center gap-1.5 flex-wrap">
                            <Chip
                                size="small"
                                colorScheme={selectedTable === "*" ? "blueLight" : "grayLight"}
                                onClick={() => setSelectedTable("*")}
                            >
                                {t("studio_webhooks_all_tables")}
                            </Chip>
                            {descriptors.map((d) => (
                                <Chip
                                    key={d.slug}
                                    size="small"
                                    colorScheme={selectedTable === d.slug ? "blueLight" : "grayLight"}
                                    onClick={() => setSelectedTable(d.slug)}
                                >
                                    {d.slug}
                                </Chip>
                            ))}
                        </div>
                    </div>
                    <TextField
                        label={editing?.hasSecret ? t("studio_webhooks_secret_keep") : t("studio_webhooks_secret_optional")}
                        value={secret}
                        onChange={(e) => setSecret(e.target.value)}
                        placeholder="whsec_..."
                    />
                    <TextField
                        label={t("studio_webhooks_headers_label")}
                        value={headersText}
                        onChange={(e) => setHeadersText(e.target.value)}
                        multiline
                        minRows={3}
                    />
                    <BooleanSwitchWithLabel
                        label={t("studio_enabled")}
                        value={enabled}
                        onValueChange={setEnabled}
                    />
                </DialogContent>
                <DialogActions>
                    <Button variant="text" onClick={() => setDialogOpen(false)}>{t("cancel")}</Button>
                    <Button
                        variant="filled"
                        disabled={saving || !name.trim() || !url.trim() || events.length === 0}
                        onClick={() => void handleSave()}
                    >
                        {saving ? t("saving") : (editing ? t("studio_save_changes") : t("studio_webhooks_create"))}
                    </Button>
                </DialogActions>
            </Dialog>
        </div>
    );
}
