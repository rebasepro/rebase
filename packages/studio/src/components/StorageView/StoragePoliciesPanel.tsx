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
    { value: "public", label: "Public (anyone, including anonymous)" },
    { value: "authenticated", label: "Authenticated (any signed-in user)" },
    { value: "owner", label: "Owner (path param matches user UID, e.g. users/:uid/**)" },
    { value: "roles", label: "Specific Roles" },
    { value: "claim", label: "JWT Claim match" }
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

function describeRule(rule: Record<string, unknown>): string {
    const kind = asString(rule.kind, "authenticated");
    if (kind === "roles") {
        const roles = asStringArray(rule.roles);
        return `roles: ${roles.join(", ") || "(none)"}`;
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
    const [policyName, setPolicyName] = useState("Public assets");
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
            setError(err instanceof Error ? err.message : "Failed to load storage policies.");
        } finally {
            setLoading(false);
        }
    }, [requestJson]);

    useEffect(() => {
        void load();
    }, [load]);

    const openCreate = () => {
        setEditing(null);
        setPolicyName("Public assets");
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
                snackbar.open({ type: "success", message: "Storage policy updated." });
            } else {
                await requestJson("/admin/storage/policies", {
                    method: "POST",
                    body: payload
                });
                snackbar.open({ type: "success", message: "Storage policy created." });
            }
            setDialogOpen(false);
            await load();
        } catch (err: unknown) {
            snackbar.open({ type: "error", message: err instanceof Error ? err.message : "Failed to save storage policy." });
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
            snackbar.open({ type: "error", message: err instanceof Error ? err.message : "Failed to update policy." });
        }
    };

    const handleDelete = async (p: StoragePolicyRow) => {
        try {
            await requestJson(`/admin/storage/policies/${encodeURIComponent(p.id)}`, { method: "DELETE" });
            snackbar.open({ type: "success", message: "Storage policy deleted." });
            await load();
        } catch (err: unknown) {
            snackbar.open({ type: "error", message: err instanceof Error ? err.message : "Failed to delete policy." });
        }
    };

    return (
        <div className="flex flex-col gap-4 p-5 h-full overflow-auto">
            <div className="flex items-center justify-between gap-4">
                <div>
                    <Typography variant="subtitle1" className="font-semibold">
                        Declarative Storage Access Policies
                    </Typography>
                    <Typography variant="caption" color="secondary">
                        Rules for uploads, reads, lists and deletes, applied live. Once a policy exists, a request no policy allows is refused.
                    </Typography>
                </div>
                <div className="flex items-center gap-2">
                    <Tooltip title="Refresh policies">
                        <IconButton size="small" aria-label="Refresh storage policies" onClick={() => void load()}>
                            <RefreshCwIcon size={iconSize.small} />
                        </IconButton>
                    </Tooltip>
                    <Button size="small" variant="filled" onClick={openCreate}>
                        <PlusIcon size={iconSize.small} />
                        New Policy
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
                        No storage policies yet. Until you add one, the storage rules declared in code apply; with none declared, development lets any signed-in user through and production lets only admins.
                    </Typography>
                    <Button size="small" variant="filled" onClick={openCreate}>
                        <PlusIcon size={iconSize.small} />
                        Create First Policy
                    </Button>
                </Card>
            ) : (
                <div className={cls("overflow-x-auto rounded-lg border", defaultBorderMixin)}>
                    <Table className="w-full">
                        <TableHeader>
                                <TableCell header>Name</TableCell>
                                <TableCell header>Priority</TableCell>
                                <TableCell header>Bucket</TableCell>
                                <TableCell header>Path Pattern</TableCell>
                                <TableCell header>Operations</TableCell>
                                <TableCell header>Rule</TableCell>
                                <TableCell header>Enabled</TableCell>
                                <TableCell header className="text-right">Actions</TableCell>
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
                                    <TableCell className="font-mono text-xs">{describeRule(p.rule)}</TableCell>
                                    <TableCell>
                                        <BooleanSwitch
                                            size="small"
                                            value={p.enabled}
                                            onValueChange={(v) => void handleToggle(p, v)}
                                        />
                                    </TableCell>
                                    <TableCell className="text-right whitespace-nowrap">
                                        <IconButton size="small" aria-label="Edit storage policy" onClick={() => openEdit(p)}>
                                            <PencilIcon size={iconSize.small} />
                                        </IconButton>
                                        <IconButton size="small" aria-label="Delete storage policy" onClick={() => void handleDelete(p)}>
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
                <DialogTitle>{editing ? "Edit Storage Policy" : "New Storage Policy"}</DialogTitle>
                <DialogContent className="flex flex-col gap-3">
                    <TextField
                        label={t("studio_policy_name")}
                        value={policyName}
                        onChange={(e) => setPolicyName(e.target.value)}
                        placeholder="Owner avatar uploads"
                    />
                    <div className="grid grid-cols-2 gap-3">
                        <TextField label="Bucket" value={bucket} onChange={(e) => setBucket(e.target.value)} placeholder="default" />
                        <TextField label="Priority (higher runs first)" value={priority} onChange={(e) => setPriority(e.target.value)} />
                    </div>
                    <TextField
                        label="Path Pattern"
                        value={pathPattern}
                        onChange={(e) => setPathPattern(e.target.value)}
                        placeholder="users/:uid/** or public/**"
                    />
                    <div className="flex flex-col gap-1.5">
                        <Typography variant="subtitle2">Allowed Operations</Typography>
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
                    <Select label="Access Rule" value={ruleKind} onValueChange={(v) => setRuleKind(String(v))}>
                        {RULE_KINDS.map((k) => (
                            <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>
                        ))}
                    </Select>
                    {ruleKind === "roles" && (
                        <TextField label="Roles (comma-separated)" value={ruleRoles} onChange={(e) => setRuleRoles(e.target.value)} placeholder="admin, editor" />
                    )}
                    {ruleKind === "owner" && (
                        <TextField label="Path parameter matching user UID (e.g. uid in users/:uid/**)" value={ruleOwnerParam} onChange={(e) => setRuleOwnerParam(e.target.value)} placeholder="uid" />
                    )}
                    {ruleKind === "claim" && (
                        <div className="grid grid-cols-2 gap-3">
                            <TextField label="Claim key" value={ruleClaim} onChange={(e) => setRuleClaim(e.target.value)} placeholder="org_id" />
                            <TextField label="Expected value" value={ruleClaimValue} onChange={(e) => setRuleClaimValue(e.target.value)} />
                        </div>
                    )}
                    <BooleanSwitchWithLabel label="Enabled" value={enabled} onValueChange={setEnabled} />
                </DialogContent>
                <DialogActions>
                    <Button variant="text" onClick={() => setDialogOpen(false)}>Cancel</Button>
                    <Button variant="filled" disabled={saving || operations.length === 0 || !pathPattern.trim()} onClick={() => void handleSave()}>
                        {saving ? t("saving") : "Save Policy"}
                    </Button>
                </DialogActions>
            </Dialog>
        </div>
    );
}
