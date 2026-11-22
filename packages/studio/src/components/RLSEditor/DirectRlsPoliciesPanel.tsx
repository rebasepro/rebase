import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
    Alert,
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
    IconButton,
    iconSize,
    PlusIcon,
    RefreshCwIcon,
    Select,
    SelectItem,
    ShieldIcon,
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
    asNullableString,
    asString,
    asStringArray,
    isRecord,
    useAdminFetch
} from "../../utils/adminFetch";

interface PgPolicy {
    name: string;
    command: string;
    roles: string[];
    using: string | null;
    withCheck: string | null;
}

interface PgTableRls {
    schema: string;
    name: string;
    rlsEnabled: boolean;
    policies: PgPolicy[];
}

const COMMANDS = ["ALL", "SELECT", "INSERT", "UPDATE", "DELETE"] as const;

const POLICY_TEMPLATES = [
    { labelKey: "studio_rls_direct_tpl_public_read", name: "public_read", command: "SELECT", using: "true", withCheck: "" },
    { labelKey: "studio_rls_direct_tpl_authenticated", name: "authenticated_all", command: "ALL", using: "rebase.uid() IS NOT NULL", withCheck: "rebase.uid() IS NOT NULL" },
    { labelKey: "studio_rls_direct_tpl_owner", name: "owner_all", command: "ALL", using: "user_id = rebase.uid()", withCheck: "user_id = rebase.uid()" },
    { labelKey: "studio_rls_direct_tpl_admin", name: "admin_all", command: "ALL", using: "'admin' = ANY(string_to_array(rebase.roles(), ','))", withCheck: "'admin' = ANY(string_to_array(rebase.roles(), ','))" }
] as const;

function parsePolicy(raw: unknown): PgPolicy | null {
    if (!isRecord(raw) || typeof raw.name !== "string") return null;
    return {
        name: raw.name,
        command: asString(raw.operation ?? raw.command, "ALL"),
        roles: asStringArray(raw.roles),
        using: asNullableString(raw.using),
        withCheck: asNullableString(raw.withCheck)
    };
}

function parseTable(raw: unknown): PgTableRls | null {
    if (!isRecord(raw) || typeof raw.name !== "string") return null;
    const policies = Array.isArray(raw.policies) ? raw.policies.map(parsePolicy).filter((p): p is PgPolicy => p !== null) : [];
    return {
        schema: asString(raw.schema, "public"),
        name: raw.name,
        rlsEnabled: asBoolean(raw.rlsEnabled, false),
        policies
    };
}

/**
 * Direct PostgreSQL RLS policy manager over `/api/admin/db/tables`.
 * Works with zero `backend/schema` source files — every change applies live
 * to Postgres and reloads the data API immediately.
 */
export function DirectRlsPoliciesPanel() {
    const { requestJson } = useAdminFetch();
    const snackbar = useSnackbarController();
    const { t } = useTranslation();

    const [tables, setTables] = useState<PgTableRls[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedName, setSelectedName] = useState<string | null>(null);

    const [dialogOpen, setDialogOpen] = useState(false);
    const [policyName, setPolicyName] = useState("");
    const [command, setCommand] = useState("ALL");
    const [usingExpr, setUsingExpr] = useState("rebase.uid() IS NOT NULL");
    const [withCheckExpr, setWithCheckExpr] = useState("");
    const [saving, setSaving] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const raw = await requestJson("/admin/db/tables");
            const list = isRecord(raw) && Array.isArray(raw.tables)
                ? raw.tables.map(parseTable).filter((t): t is PgTableRls => t !== null)
                : [];
            setTables(list);
            setSelectedName((prev) => (prev && list.some((t) => t.name === prev) ? prev : (list[0]?.name ?? null)));
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : t("studio_rls_direct_load_failed"));
        } finally {
            setLoading(false);
        }
    }, [requestJson, t]);

    useEffect(() => {
        void load();
    }, [load]);

    const selected = useMemo(() => tables.find((t) => t.name === selectedName) ?? null, [tables, selectedName]);

    const handleToggleRls = async (enabled: boolean) => {
        if (!selected) return;
        try {
            await requestJson(`/admin/db/tables/${encodeURIComponent(selected.name)}`, {
                method: "PATCH",
                body: { rlsEnabled: enabled }
            });
            snackbar.open({ type: "success", message: t(enabled ? "studio_tables_rls_enabled_on" : "studio_tables_rls_disabled_on", { name: selected.name }) });
            await load();
        } catch (err: unknown) {
            snackbar.open({ type: "error", message: err instanceof Error ? err.message : t("studio_rls_direct_update_failed") });
        }
    };

    const handleCreatePolicy = async () => {
        if (!selected || !policyName.trim()) return;
        setSaving(true);
        try {
            await requestJson(`/admin/db/tables/${encodeURIComponent(selected.name)}/policies`, {
                method: "POST",
                body: {
                    name: policyName.trim(),
                    operation: command,
                    ...(usingExpr.trim() ? { using: usingExpr.trim() } : {}),
                    ...(withCheckExpr.trim() ? { withCheck: withCheckExpr.trim() } : {})
                }
            });
            snackbar.open({ type: "success", message: t("studio_rls_direct_policy_created", { name: policyName.trim() }) });
            setDialogOpen(false);
            setPolicyName("");
            await load();
        } catch (err: unknown) {
            snackbar.open({ type: "error", message: err instanceof Error ? err.message : t("studio_rls_direct_policy_create_failed") });
        } finally {
            setSaving(false);
        }
    };

    const handleDropPolicy = async (name: string) => {
        if (!selected) return;
        try {
            await requestJson(`/admin/db/tables/${encodeURIComponent(selected.name)}/policies/${encodeURIComponent(name)}`, {
                method: "DELETE"
            });
            snackbar.open({ type: "success", message: t("studio_rls_direct_policy_dropped", { name }) });
            await load();
        } catch (err: unknown) {
            snackbar.open({ type: "error", message: err instanceof Error ? err.message : t("studio_rls_direct_policy_drop_failed") });
        }
    };

    return (
        <div className="flex h-full w-full overflow-hidden bg-surface-card">
            <aside className={cls("w-64 shrink-0 border-r bg-surface-card flex flex-col", defaultBorderMixin)}>
                <div className={cls("h-[42px] px-3 border-b bg-surface-sheet flex items-center justify-between shrink-0", defaultBorderMixin)}>
                    <Typography variant="caption" className="font-semibold uppercase tracking-wider text-text-disabled dark:text-text-disabled-dark">{t("studio_rls_direct_tables_heading")}</Typography>
                    <Tooltip title={t("refresh")}>
                        <IconButton size="small" aria-label={t("studio_rls_direct_refresh_aria")} onClick={() => void load()}>
                            <RefreshCwIcon size={iconSize.smallest} />
                        </IconButton>
                    </Tooltip>
                </div>
                <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1">
                    {loading ? (
                        <div className="flex justify-center py-8"><CircularProgress size="small" /></div>
                    ) : tables.map((table) => (
                        <button
                            key={table.name}
                            type="button"
                            onClick={() => setSelectedName(table.name)}
                            className={cls(
                                "w-full text-left px-2.5 h-8 rounded-lg flex items-center justify-between gap-2 text-[13px] transition-colors cursor-pointer",
                                table.name === selectedName
                                    ? "bg-surface-active text-text-primary dark:text-text-primary-dark font-medium"
                                    : "text-text-secondary dark:text-text-secondary-dark hover:bg-surface-hover hover:text-text-primary dark:hover:text-text-primary-dark"
                            )}
                        >
                            <span className="font-mono truncate">{table.name}</span>
                            <Chip size="small" colorScheme={table.rlsEnabled ? "greenLight" : "grayLight"}>
                                {table.policies.length}
                            </Chip>
                        </button>
                    ))}
                </div>
            </aside>

            <main className="flex-1 flex flex-col min-w-0 h-full overflow-hidden bg-surface-sheet">
                {error && <div className="p-5 pb-0"><Alert color="error">{error}</Alert></div>}

                {!selected ? (
                    <div className="p-5">
                        <Card className="p-8 text-center">
                            <Typography variant="body2" color="secondary">
                                {t("studio_rls_direct_select_table")}
                            </Typography>
                        </Card>
                    </div>
                ) : (
                    <>
                        <div className={cls("h-[42px] px-4 border-b bg-surface-sheet flex items-center justify-between gap-4 shrink-0", defaultBorderMixin)}>
                            <div className="flex items-center gap-2.5 min-w-0">
                                <ShieldIcon size={iconSize.small} className={"text-text-secondary shrink-0"} />
                                <Typography variant="subtitle2" className="font-mono truncate">{selected.schema}.{selected.name}</Typography>
                                <Chip size="smallest" colorScheme={selected.rlsEnabled ? "greenLight" : "orangeLight"}>
                                    {selected.rlsEnabled ? t("studio_rls_enabled") : t("studio_rls_disabled")}
                                </Chip>
                            </div>
                            <Button size="small" color="primary" variant="filled" onClick={() => setDialogOpen(true)}>
                                <PlusIcon size={iconSize.smallest} />
                                {t("studio_new_policy")}
                            </Button>
                        </div>

                        <div className="flex-1 overflow-auto p-5 flex flex-col gap-4">
                        <Card className="p-4">
                            <BooleanSwitchWithLabel
                                label={t("studio_rls_direct_enabled_label")}
                                value={selected.rlsEnabled}
                                onValueChange={(v) => void handleToggleRls(v)}
                            />
                        </Card>

                        {selected.policies.length === 0 ? (
                            <Card className="p-8 text-center flex flex-col items-center gap-3">
                                <Typography variant="body2" color="secondary">
                                    {t("studio_rls_direct_no_policies", { name: selected.name })}
                                </Typography>
                                <Button size="small" color="primary" variant="filled" onClick={() => setDialogOpen(true)}>
                                    <PlusIcon size={iconSize.small} />
                                    {t("studio_rls_direct_add_first_policy")}
                                </Button>
                            </Card>
                        ) : (
                            <div className={cls("overflow-x-auto rounded-lg border", defaultBorderMixin)}>
                                <Table className="w-full">
                                    <TableHeader>
                                            <TableCell header>{t("studio_policy_name")}</TableCell>
                                            <TableCell header>{t("studio_rls_direct_command")}</TableCell>
                                            <TableCell header>USING</TableCell>
                                            <TableCell header>WITH CHECK</TableCell>
                                            <TableCell header className="text-right">{t("actions")}</TableCell>
                                        </TableHeader>
                                    <TableBody>
                                        {selected.policies.map((p) => (
                                            <TableRow key={p.name}>
                                                <TableCell className="font-mono text-sm font-medium">{p.name}</TableCell>
                                                <TableCell><Chip size="small" colorScheme="blueLight">{p.command}</Chip></TableCell>
                                                <TableCell className="font-mono text-xs text-text-secondary">{p.using ?? "—"}</TableCell>
                                                <TableCell className="font-mono text-xs text-text-secondary">{p.withCheck ?? "—"}</TableCell>
                                                <TableCell className="text-right">
                                                    <IconButton
                                                        size="small"
                                                        aria-label={t("studio_rls_direct_drop_policy_aria", { name: p.name })}
                                                        onClick={() => void handleDropPolicy(p.name)}
                                                    >
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
                    </>
                )}
            </main>

            <Dialog open={dialogOpen} onOpenChange={setDialogOpen} maxWidth="md" fullWidth>
                <DialogTitle>{t("studio_rls_direct_new_policy_title", { name: selected?.name ?? "" })}</DialogTitle>
                <DialogContent className="flex flex-col gap-3">
                    <div className="flex items-center gap-1.5 flex-wrap">
                        {POLICY_TEMPLATES.map((tpl) => (
                            <Chip
                                key={tpl.name}
                                size="small"
                                colorScheme="grayLight"
                                onClick={() => {
                                    setPolicyName(tpl.name);
                                    setCommand(tpl.command);
                                    setUsingExpr(tpl.using);
                                    setWithCheckExpr(tpl.withCheck);
                                }}
                            >
                                {t(tpl.labelKey)}
                            </Chip>
                        ))}
                    </div>
                    <TextField label={t("studio_policy_name")} value={policyName} onChange={(e) => setPolicyName(e.target.value)} placeholder="owner_all" />
                    <Select label={t("studio_rls_direct_command")} value={command} onValueChange={(v) => setCommand(String(v))}>
                        {COMMANDS.map((cmd) => <SelectItem key={cmd} value={cmd}>{cmd}</SelectItem>)}
                    </Select>
                    <TextField label={t("studio_policy_using_expr")} value={usingExpr} onChange={(e) => setUsingExpr(e.target.value)} placeholder="user_id = rebase.uid()" />
                    <TextField label={t("studio_rls_direct_with_check_label")} value={withCheckExpr} onChange={(e) => setWithCheckExpr(e.target.value)} placeholder="user_id = rebase.uid()" />
                </DialogContent>
                <DialogActions>
                    <Button variant="text" onClick={() => setDialogOpen(false)}>{t("cancel")}</Button>
                    <Button variant="filled" disabled={saving || !policyName.trim()} onClick={() => void handleCreatePolicy()}>
                        {saving ? t("saving") : t("studio_rls_create_policy")}
                    </Button>
                </DialogActions>
            </Dialog>
        </div>
    );
}
