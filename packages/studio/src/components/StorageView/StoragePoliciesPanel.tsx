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
    asNumber,
    asString,
    asStringArray,
    isRecord,
    useAdminFetch
} from "../../utils/adminFetch";

const OPERATIONS = ["read", "write", "delete", "list"] as const;
const RULE_KINDS = [
    { value: "public", labelKey: "studio_storage_policies_rule_public" },
    { value: "authenticated", labelKey: "studio_storage_policies_rule_authenticated" },
    { value: "owner", labelKey: "studio_storage_policies_rule_owner" },
    { value: "roles", labelKey: "studio_storage_policies_rule_roles" },
    { value: "claim", labelKey: "studio_storage_policies_rule_claim" }
] as const;

interface StoragePolicyRow {
    id: string;
    name: string;
    bucket: string;
    pathPattern: string;
    operations: string[];
    rule: Record<string, unknown>;
    priority: number;
    enabled: boolean;
}

function parsePolicy(raw: unknown): StoragePolicyRow | null {
    if (!isRecord(raw) || typeof raw.id !== "string") return null;
    const pathPattern = asString(raw.pathPattern ?? raw.pathPrefix, "");
    return {
        id: raw.id,
        name: asString(raw.name, pathPattern || raw.id),
        bucket: asString(raw.bucket, "default"),
        pathPattern,
        operations: asStringArray(raw.operations),
        rule: isRecord(raw.rule) ? raw.rule : { kind: "authenticated" },
        priority: asNumber(raw.priority, 100),
        enabled: asBoolean(raw.enabled, true)
    };
}

/** A rule as the table shows it; `none` is the word for a roles rule that names no role. */
function describeRule(rule: Record<string, unknown>, none: string): string {
    const kind = asString(rule.kind, "authenticated");
    if (kind === "roles") {
        const roles = asStringArray(rule.roles);
        return `roles: ${roles.join(", ") || `(${none})`}`;
    }
    if (kind === "claim") {
        const target = typeof rule.param === "string" && rule.param ? `:${rule.param}` : String(rule.equals ?? "");
        return `claim: ${asString(rule.claim)} == ${target}`;
    }
    if (kind === "owner") {
        return `owner (:${asString(rule.param, "uid")})`;
    }
    return kind;
}

export function StoragePoliciesPanel() {
    const { requestJson } = useAdminFetch();
    const snackbar = useSnackbarController();
    const { t } = useTranslation();

    const [policies, setPolicies] = useState<StoragePolicyRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [dialogOpen, setDialogOpen] = useState(false);
    const [editing, setEditing] = useState<StoragePolicyRow | null>(null);
    const [policyName, setPolicyName] = useState("");
    const [bucket, setBucket] = useState("default");
    const [pathPattern, setPathPattern] = useState("public/**");
    const [operations, setOperations] = useState<string[]>(["read"]);
    const [ruleKind, setRuleKind] = useState("public");
    const [ruleRoles, setRuleRoles] = useState("admin");
    const [ruleOwnerParam, setRuleOwnerParam] = useState("uid");
    const [ruleClaim, setRuleClaim] = useState("org_id");
    const [ruleClaimValue, setRuleClaimValue] = useState("");
    const [priority, setPriority] = useState("100");
    const [enabled, setEnabled] = useState(true);
    const [saving, setSaving] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const raw = await requestJson("/admin/storage/policies");
            const arr = isRecord(raw) && Array.isArray(raw.policies) ? raw.policies : [];
            setPolicies(arr.map(parsePolicy).filter((p): p is StoragePolicyRow => p !== null));
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : t("studio_storage_policies_load_failed"));
        } finally {
            setLoading(false);
        }
    }, [requestJson, t]);

    useEffect(() => {
        void load();
    }, [load]);

    const openCreate = () => {
        setEditing(null);
        setPolicyName(t("studio_storage_policies_default_name"));
        setBucket("default");
        setPathPattern("public/**");
        setOperations(["read"]);
        setRuleKind("public");
        setRuleRoles("admin");
        setRuleOwnerParam("uid");
        setRuleClaim("org_id");
        setRuleClaimValue("");
        setPriority("100");
        setEnabled(true);
        setDialogOpen(true);
    };

    const openEdit = (p: StoragePolicyRow) => {
        setEditing(p);
        setPolicyName(p.name);
        setBucket(p.bucket);
        setPathPattern(p.pathPattern);
        setOperations([...p.operations]);
        const kind = asString(p.rule.kind, "authenticated");
        setRuleKind(kind);
        setRuleRoles(asStringArray(p.rule.roles).join(", "));
        setRuleOwnerParam(asString(p.rule.param, "uid"));
        setRuleClaim(asString(p.rule.claim, "org_id"));
        setRuleClaimValue(String(p.rule.equals ?? ""));
        setPriority(String(p.priority));
        setEnabled(p.enabled);
        setDialogOpen(true);
    };

    const toggleOp = (op: string) => {
        setOperations((prev) => prev.includes(op) ? prev.filter((o) => o !== op) : [...prev, op]);
    };

    const buildRule = (): Record<string, unknown> => {
        if (ruleKind === "roles") {
            return { kind: "roles", roles: ruleRoles.split(",").map((s) => s.trim()).filter(Boolean) };
        }
        if (ruleKind === "owner") {
            return { kind: "owner", param: ruleOwnerParam.trim() || "uid" };
        }
        if (ruleKind === "claim") {
            return { kind: "claim", claim: ruleClaim.trim(), equals: ruleClaimValue };
        }
        return { kind: ruleKind };
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            const trimmedPattern = pathPattern.trim();
            const trimmedName = policyName.trim() || `${bucket.trim() || "default"}:${trimmedPattern}`;
            const payload = {
                name: trimmedName,
                bucket: bucket.trim() || "default",
                pathPattern: trimmedPattern,
                operations,
                rule: buildRule(),
                priority: Number(priority) || 100,
                enabled
            };
            if (editing) {
                await requestJson(`/admin/storage/policies/${encodeURIComponent(editing.id)}`, {
                    method: "PATCH",
                    body: payload
                });
                snackbar.open({ type: "success", message: t("studio_storage_policies_updated") });
            } else {
                await requestJson("/admin/storage/policies", {
                    method: "POST",
                    body: payload
                });
                snackbar.open({ type: "success", message: t("studio_storage_policies_created") });
            }
            setDialogOpen(false);
            await load();
        } catch (err: unknown) {
            snackbar.open({ type: "error", message: err instanceof Error ? err.message : t("studio_storage_policies_save_failed") });
        } finally {
            setSaving(false);
        }
    };

    const handleToggle = async (p: StoragePolicyRow, next: boolean) => {
        try {
            await requestJson(`/admin/storage/policies/${encodeURIComponent(p.id)}`, {
                method: "PATCH",
                body: { enabled: next }
            });
            await load();
        } catch (err: unknown) {
            snackbar.open({ type: "error", message: err instanceof Error ? err.message : t("studio_storage_policies_toggle_failed") });
        }
    };

    const handleDelete = async (p: StoragePolicyRow) => {
        try {
            await requestJson(`/admin/storage/policies/${encodeURIComponent(p.id)}`, { method: "DELETE" });
            snackbar.open({ type: "success", message: t("studio_storage_policies_deleted") });
            await load();
        } catch (err: unknown) {
            snackbar.open({ type: "error", message: err instanceof Error ? err.message : t("studio_storage_policies_delete_failed") });
        }
    };

    return (
        <div className="flex flex-col gap-4 p-5 h-full overflow-auto">
            <div className="flex items-center justify-between gap-4">
                <div>
                    <Typography variant="subtitle1" className="font-semibold">
                        {t("studio_storage_policies_title")}
                    </Typography>
                    <Typography variant="caption" color="secondary">
                        {t("studio_storage_policies_subtitle")}
                    </Typography>
                </div>
                <div className="flex items-center gap-2">
                    <Tooltip title={t("studio_storage_policies_refresh")}>
                        <IconButton size="small" aria-label={t("studio_storage_policies_refresh_aria")} onClick={() => void load()}>
                            <RefreshCwIcon size={iconSize.small} />
                        </IconButton>
                    </Tooltip>
                    <Button size="small" variant="filled" onClick={openCreate}>
                        <PlusIcon size={iconSize.small} />
                        {t("studio_new_policy")}
                    </Button>
                </div>
            </div>

            {error && <Alert color="error">{error}</Alert>}

            {loading ? (
                <div className="flex justify-center py-12"><CircularProgress size="small" /></div>
            ) : policies.length === 0 ? (
                <Card className="p-8 text-center flex flex-col items-center gap-3">
                    <ShieldIcon className="w-8 h-8 text-text-disabled" />
                    <Typography variant="body2" color="secondary">
                        {t("studio_storage_policies_empty")}
                    </Typography>
                    <Button size="small" variant="filled" onClick={openCreate}>
                        <PlusIcon size={iconSize.small} />
                        {t("studio_storage_policies_create_first")}
                    </Button>
                </Card>
            ) : (
                <div className={cls("overflow-x-auto rounded-lg border", defaultBorderMixin)}>
                    <Table className="w-full">
                        <TableHeader>
                                <TableCell header>{t("name")}</TableCell>
                                <TableCell header>{t("studio_storage_policies_priority")}</TableCell>
                                <TableCell header>{t("studio_storage_policies_bucket")}</TableCell>
                                <TableCell header>{t("studio_storage_policies_path_pattern")}</TableCell>
                                <TableCell header>{t("studio_storage_policies_operations")}</TableCell>
                                <TableCell header>{t("studio_storage_policies_rule")}</TableCell>
                                <TableCell header>{t("studio_enabled")}</TableCell>
                                <TableCell header className="text-right">{t("actions")}</TableCell>
                            </TableHeader>
                        <TableBody>
                            {policies.map((p) => (
                                <TableRow key={p.id}>
                                    <TableCell className="font-medium text-sm">{p.name}</TableCell>
                                    <TableCell className="font-mono text-xs">{p.priority}</TableCell>
                                    <TableCell className="font-mono text-xs">{p.bucket}</TableCell>
                                    <TableCell className="font-mono text-sm">{p.pathPattern || "**"}</TableCell>
                                    <TableCell>
                                        <div className="flex items-center gap-1 flex-wrap">
                                            {p.operations.map((op) => (
                                                <Chip key={op} size="small" colorScheme="blueLight">{op}</Chip>
                                            ))}
                                        </div>
                                    </TableCell>
                                    <TableCell className="font-mono text-xs">{describeRule(p.rule, t("studio_users_no_roles"))}</TableCell>
                                    <TableCell>
                                        <BooleanSwitch
                                            size="small"
                                            value={p.enabled}
                                            onValueChange={(v) => void handleToggle(p, v)}
                                        />
                                    </TableCell>
                                    <TableCell className="text-right whitespace-nowrap">
                                        <IconButton size="small" aria-label={t("studio_storage_policies_edit_aria")} onClick={() => openEdit(p)}>
                                            <PencilIcon size={iconSize.small} />
                                        </IconButton>
                                        <IconButton size="small" aria-label={t("studio_storage_policies_delete_aria")} onClick={() => void handleDelete(p)}>
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
                <DialogTitle>{editing ? t("studio_storage_policies_edit_title") : t("studio_storage_policies_new_title")}</DialogTitle>
                <DialogContent className="flex flex-col gap-3">
                    <TextField
                        label={t("studio_policy_name")}
                        value={policyName}
                        onChange={(e) => setPolicyName(e.target.value)}
                        placeholder={t("studio_storage_policies_name_placeholder")}
                    />
                    <div className="grid grid-cols-2 gap-3">
                        <TextField label={t("studio_storage_policies_bucket")} value={bucket} onChange={(e) => setBucket(e.target.value)} placeholder="default" />
                        <TextField label={t("studio_storage_policies_priority_label")} value={priority} onChange={(e) => setPriority(e.target.value)} />
                    </div>
                    <TextField
                        label={t("studio_storage_policies_path_pattern")}
                        value={pathPattern}
                        onChange={(e) => setPathPattern(e.target.value)}
                        placeholder={t("studio_storage_policies_path_placeholder")}
                    />
                    <div className="flex flex-col gap-1.5">
                        <Typography variant="subtitle2">{t("studio_storage_policies_allowed_operations")}</Typography>
                        <div className="flex items-center gap-1.5 flex-wrap">
                            {OPERATIONS.map((op) => (
                                <Chip
                                    key={op}
                                    size="small"
                                    colorScheme={operations.includes(op) ? "blueLight" : "grayLight"}
                                    onClick={() => toggleOp(op)}
                                >
                                    {op}
                                </Chip>
                            ))}
                        </div>
                    </div>
                    <Select label={t("studio_storage_policies_access_rule")} value={ruleKind} onValueChange={(v) => setRuleKind(String(v))}>
                        {RULE_KINDS.map((k) => (
                            <SelectItem key={k.value} value={k.value}>{t(k.labelKey)}</SelectItem>
                        ))}
                    </Select>
                    {ruleKind === "roles" && (
                        <TextField label={t("studio_roles_comma_separated")} value={ruleRoles} onChange={(e) => setRuleRoles(e.target.value)} placeholder="admin, editor" />
                    )}
                    {ruleKind === "owner" && (
                        <TextField label={t("studio_storage_policies_owner_param_label")} value={ruleOwnerParam} onChange={(e) => setRuleOwnerParam(e.target.value)} placeholder="uid" />
                    )}
                    {ruleKind === "claim" && (
                        <div className="grid grid-cols-2 gap-3">
                            <TextField label={t("studio_storage_policies_claim_key")} value={ruleClaim} onChange={(e) => setRuleClaim(e.target.value)} placeholder="org_id" />
                            <TextField label={t("studio_storage_policies_claim_value")} value={ruleClaimValue} onChange={(e) => setRuleClaimValue(e.target.value)} />
                        </div>
                    )}
                    <BooleanSwitchWithLabel label={t("studio_enabled")} value={enabled} onValueChange={setEnabled} />
                </DialogContent>
                <DialogActions>
                    <Button variant="text" onClick={() => setDialogOpen(false)}>{t("cancel")}</Button>
                    <Button variant="filled" disabled={saving || operations.length === 0 || !pathPattern.trim()} onClick={() => void handleSave()}>
                        {saving ? t("saving") : t("studio_policy_save")}
                    </Button>
                </DialogActions>
            </Dialog>
        </div>
    );
}
