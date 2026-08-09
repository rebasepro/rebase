
import React, { useState, useEffect, useRef, useCallback } from "react";
import {
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
    KeyRoundIcon,
    RefreshCwIcon,
    Tooltip,
    Typography,
    TextField,
    Select,
    SelectItem,
    Checkbox,
    CopyIcon,
    PlusIcon as AddIcon,
    Trash2Icon as DeleteIcon,
    AlertCircleIcon,
    CheckCircleIcon
} from "@rebasepro/ui";
import { useRebaseClient, useSnackbarController } from "@rebasepro/app";
import type { RebaseClient } from "@rebasepro/types";

/* ═══════════════════════════════════════════════════════════════
   Types — mirrors server api-key-types.ts
   ═══════════════════════════════════════════════════════════════ */

interface ApiKeyPermission {
    collection: string;
    operations: ("read" | "write" | "delete")[];
}

interface ApiKeyMasked {
    id: string;
    name: string;
    key_prefix: string;
    permissions: ApiKeyPermission[];
    rate_limit: number | null;
    created_by: string;
    created_at: string;
    updated_at: string;
    last_used_at: string | null;
    expires_at: string | null;
    revoked_at: string | null;
}

interface ApiKeyWithSecret extends ApiKeyMasked {
    key: string;
}

/* ═══════════════════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════════════════ */

function formatRelative(iso: string | null | undefined): string {
    if (!iso) return "—";
    const d = new Date(iso);
    const now = Date.now();
    const diff = d.getTime() - now;
    const abs = Math.abs(diff);
    if (abs < 60000) return diff > 0 ? "in <1m" : "<1m ago";
    if (abs < 3600000) { const m = Math.round(abs / 60000); return diff > 0 ? `in ${m}m` : `${m}m ago`; }
    if (abs < 86400000) { const h = Math.round(abs / 3600000); return diff > 0 ? `in ${h}h` : `${h}h ago`; }
    return d.toLocaleDateString();
}

function permissionSummary(perms: ApiKeyPermission[]): string {
    if (perms.length === 0) return "No permissions";
    const wildcard = perms.find(p => p.collection === "*");
    if (wildcard) {
        return `All collections (${wildcard.operations.join(", ")})`;
    }
    if (perms.length === 1) {
        return `${perms[0].collection} (${perms[0].operations.join(", ")})`;
    }
    return `${perms.length} collections`;
}

function isExpired(key: ApiKeyMasked): boolean {
    return !!(key.expires_at && new Date(key.expires_at) < new Date());
}

function keyStatus(key: ApiKeyMasked): { label: string; color: string } {
    if (key.revoked_at) return { label: "Revoked", color: "text-red-500" };
    if (isExpired(key)) return { label: "Expired", color: "text-amber-500" };
    return { label: "Active", color: "text-emerald-500" };
}

/* ═══════════════════════════════════════════════════════════════
   Main Component
   ═══════════════════════════════════════════════════════════════ */

export function ApiKeysView() {
    const client = useRebaseClient<RebaseClient>();
    const snackbar = useSnackbarController();
    const [keys, setKeys] = useState<ApiKeyMasked[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [showCreate, setShowCreate] = useState(false);
    const [showSecret, setShowSecret] = useState<ApiKeyWithSecret | null>(null);
    const [revoking, setRevoking] = useState<string | null>(null);
    const [confirmRevoke, setConfirmRevoke] = useState<ApiKeyMasked | null>(null);

    const clientRef = useRef(client);
    clientRef.current = client;
    const snackbarRef = useRef(snackbar);
    snackbarRef.current = snackbar;

    const loadKeys = useCallback(async () => {
        const c = clientRef.current;
        if (!c?.apiKeys) { setLoading(false); return; }
        try {
            const res = await c.apiKeys.listKeys();
            setKeys(res.keys);
        } catch (e: unknown) {
            snackbarRef.current.open({
                type: "error",
                message: e instanceof Error ? e.message : String(e)
            });
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { loadKeys(); }, [loadKeys]);

    const handleRevoke = async (id: string) => {
        const c = clientRef.current;
        if (!c?.apiKeys) return;
        setRevoking(id);
        try {
            await c.apiKeys.revokeKey(id);
            snackbarRef.current.open({ type: "success", message: "API key revoked" });
            await loadKeys();
            if (selectedId === id) setSelectedId(null);
        } catch (e: unknown) {
            snackbarRef.current.open({ type: "error", message: e instanceof Error ? e.message : String(e) });
        } finally { setRevoking(null); }
    };

    const handleCreated = (keyWithSecret: ApiKeyWithSecret) => {
        setShowCreate(false);
        setShowSecret(keyWithSecret);
        loadKeys();
    };

    const selectedKey = keys.find(k => k.id === selectedId);
    const activeKeys = keys.filter(k => !k.revoked_at && !isExpired(k));
    const inactiveKeys = keys.filter(k => k.revoked_at || isExpired(k));

    if (loading) return <div className="flex items-center justify-center h-full"><CircularProgress/></div>;

    return (
        <>
            <div className="flex h-full w-full overflow-hidden bg-white dark:bg-surface-950">
                {/* ── Key List ── */}
                <div className={cls("flex flex-col w-[340px] min-w-[280px] border-r h-full", defaultBorderMixin)}>
                    <div className={cls("flex items-center justify-between px-4 py-2.5 border-b bg-surface-50 dark:bg-surface-900 min-h-[48px]", defaultBorderMixin)}>
                        <div className="flex items-center gap-2">
                            <KeyRoundIcon size={iconSize.smallest} className="text-primary"/>
                            <Typography variant="subtitle2" className="font-semibold">API Keys</Typography>
                            <Chip size="smallest" className="bg-surface-200 dark:bg-surface-700 text-surface-600 dark:text-surface-300">{activeKeys.length}</Chip>
                        </div>
                        <div className="flex items-center gap-1">
                            <IconButton size="small" onClick={loadKeys} title="Refresh"><RefreshCwIcon size={iconSize.smallest}/></IconButton>
                            <Button size="small" color="primary" onClick={() => setShowCreate(true)} startIcon={<AddIcon size={iconSize.smallest}/>}>
                                New
                            </Button>
                        </div>
                    </div>
                    <div className="flex-1 overflow-y-auto p-2 space-y-1">
                        {activeKeys.length === 0 && inactiveKeys.length === 0 && (
                            <div className="flex flex-col items-center justify-center h-full gap-3 text-center p-6">
                                <KeyRoundIcon size={iconSize.medium} className="text-surface-300 dark:text-surface-600"/>
                                <Typography variant="body2" color="secondary">No API keys yet</Typography>
                                <Typography variant="caption" color="disabled">Create a key to enable machine-to-machine authentication</Typography>
                            </div>
                        )}
                        {activeKeys.map(key => (
                            <KeyListItem key={key.id} apiKey={key} selected={selectedId === key.id} onClick={() => setSelectedId(key.id)}/>
                        ))}
                        {inactiveKeys.length > 0 && (
                            <>
                                <div className="px-2 pt-3 pb-1">
                                    <Typography variant="caption" color="disabled" className="text-[10px] uppercase tracking-wider font-medium">Revoked / Expired</Typography>
                                </div>
                                {inactiveKeys.map(key => (
                                    <KeyListItem key={key.id} apiKey={key} selected={selectedId === key.id} onClick={() => setSelectedId(key.id)}/>
                                ))}
                            </>
                        )}
                    </div>
                </div>

                {/* ── Detail Panel ── */}
                <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
                    {!selectedKey ? (
                        <div className="flex items-center justify-center h-full">
                            <Typography variant="body2" color="disabled">Select an API key to view details</Typography>
                        </div>
                    ) : (
                        <>
                            {/* Header */}
                            <div className={cls("flex items-center justify-between px-5 py-3 border-b bg-white dark:bg-surface-950 min-h-[56px]", defaultBorderMixin)}>
                                <div className="flex items-center gap-3 min-w-0">
                                    <KeyRoundIcon size={iconSize.small} className="text-primary shrink-0"/>
                                    <div className="min-w-0">
                                        <Typography variant="subtitle1" className="font-semibold truncate">{selectedKey.name}</Typography>
                                        <Typography variant="caption" color="secondary" className="font-mono text-[11px]">{selectedKey.key_prefix}•••</Typography>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    {!selectedKey.revoked_at && (
                                        <Button
                                            size="small"
                                            color="error"
                                            variant="outlined"
                                            onClick={() => setConfirmRevoke(selectedKey)}
                                            disabled={revoking === selectedKey.id}
                                            startIcon={revoking === selectedKey.id ? <CircularProgress size="smallest"/> : <DeleteIcon size={iconSize.smallest}/>}
                                        >
                                            Revoke
                                        </Button>
                                    )}
                                </div>
                            </div>

                            {/* Stats */}
                            <div className="px-5 py-4 bg-surface-50 dark:bg-surface-900/50">
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                    <StatCard label="Status" value={keyStatus(selectedKey).label} className={keyStatus(selectedKey).color}/>
                                    <StatCard label="Created" value={formatRelative(selectedKey.created_at)}/>
                                    <StatCard label="Last Used" value={formatRelative(selectedKey.last_used_at)}/>
                                    <StatCard label="Expires" value={selectedKey.expires_at ? formatRelative(selectedKey.expires_at) : "Never"}/>
                                </div>
                                <div className="grid grid-cols-2 gap-3 mt-3">
                                    <StatCard label="Rate Limit" value={selectedKey.rate_limit ? `${selectedKey.rate_limit}/15min` : "Default (1000/15min)"}/>
                                    <StatCard label="Created By" value={selectedKey.created_by} mono/>
                                </div>
                            </div>

                            {/* Permissions */}
                            <div className={cls("flex items-center gap-2 px-5 py-2 border-y bg-white dark:bg-surface-950", defaultBorderMixin)}>
                                <Typography variant="subtitle2" className="font-semibold text-[13px]">Permissions</Typography>
                                <Chip size="smallest" className="bg-surface-200 dark:bg-surface-700 text-surface-600 dark:text-surface-300">
                                    {selectedKey.permissions.length}
                                </Chip>
                            </div>
                            <div className="flex-1 overflow-y-auto px-5 py-3">
                                {selectedKey.permissions.length === 0 ? (
                                    <Typography variant="body2" color="disabled">No permissions configured</Typography>
                                ) : (
                                    <div className="space-y-2">
                                        {selectedKey.permissions.map((perm, idx) => (
                                            <div key={idx} className={cls("flex items-center gap-3 px-3 py-2 rounded-lg border", defaultBorderMixin)}>
                                                <Typography variant="body2" className="font-mono text-[13px] font-medium flex-1">
                                                    {perm.collection === "*" ? "* (all collections)" : perm.collection}
                                                </Typography>
                                                <div className="flex items-center gap-1">
                                                    {perm.operations.map(op => (
                                                        <Chip key={op} size="smallest" className={cls(
                                                            op === "read" && "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300",
                                                            op === "write" && "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300",
                                                            op === "delete" && "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300"
                                                        )}>{op}</Chip>
                                                    ))}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* Revoke Confirmation Dialog */}
            <Dialog
                open={confirmRevoke !== null}
                onOpenChange={(open) => {
                    if (!open && !revoking) setConfirmRevoke(null);
                }}
            >
                <DialogTitle hidden>Revoke Confirmation</DialogTitle>
                <DialogContent>
                    <Typography variant="subtitle1" className="font-semibold mb-2">
                        Revoke &quot;{confirmRevoke?.name}&quot;?
                    </Typography>
                    <Typography variant="body2" color="secondary">
                        Requests authenticated with this key will stop working immediately. This action cannot be undone.
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button
                        variant="text"
                        onClick={() => setConfirmRevoke(null)}
                        disabled={revoking !== null}
                    >
                        Cancel
                    </Button>
                    <Button
                        color="error"
                        disabled={revoking !== null}
                        startIcon={revoking !== null ? <CircularProgress size="smallest"/> : <DeleteIcon size={iconSize.smallest}/>}
                        onClick={async () => {
                            if (!confirmRevoke) return;
                            await handleRevoke(confirmRevoke.id);
                            setConfirmRevoke(null);
                        }}
                    >
                        Revoke
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Create Dialog */}
            {showCreate && (
                <CreateApiKeyDialog
                    onClose={() => setShowCreate(false)}
                    onCreated={handleCreated}
                />
            )}

            {/* Secret Display Dialog */}
            {showSecret && (
                <SecretDisplayDialog
                    keyWithSecret={showSecret}
                    onClose={() => setShowSecret(null)}
                />
            )}
        </>
    );
}

/* ═══════════════════════════════════════════════════════════════
   List item
   ═══════════════════════════════════════════════════════════════ */

function KeyListItem({ apiKey, selected, onClick }: { apiKey: ApiKeyMasked; selected: boolean; onClick: () => void }) {
    const status = keyStatus(apiKey);
    return (
        <div
            onClick={onClick}
            className={cls(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-all",
                selected
                    ? "bg-primary/10 dark:bg-primary/15 ring-1 ring-primary/30"
                    : "hover:bg-surface-100 dark:hover:bg-surface-950"
            )}
        >
            <div className={cls("w-2 h-2 rounded-full shrink-0",
                status.label === "Active" ? "bg-emerald-400" :
                status.label === "Expired" ? "bg-amber-400" : "bg-red-400"
            )}/>
            <div className="flex-1 min-w-0">
                <Typography variant="body2" className="truncate font-medium text-[13px]">{apiKey.name}</Typography>
                <Typography variant="caption" color="secondary" className="truncate text-[11px] font-mono">{apiKey.key_prefix}•••</Typography>
            </div>
            <div className="shrink-0">
                <Typography variant="caption" color="disabled" className="text-[10px]">{permissionSummary(apiKey.permissions)}</Typography>
            </div>
        </div>
    );
}

/* ═══════════════════════════════════════════════════════════════
   Stat card
   ═══════════════════════════════════════════════════════════════ */

function StatCard({ label, value, mono, className }: { label: string; value: string; mono?: boolean; className?: string }) {
    return (
        <div className={cls("px-3 py-2 rounded-lg border bg-white dark:bg-surface-900", defaultBorderMixin)}>
            <Typography variant="caption" color="secondary" className="text-[10px] uppercase tracking-wider font-medium">{label}</Typography>
            <Typography variant="body2" className={cls(
                "mt-0.5 font-semibold text-[13px]",
                mono && "font-mono",
                className
            )}>{value}</Typography>
        </div>
    );
}

/* ═══════════════════════════════════════════════════════════════
   Create API Key Dialog
   ═══════════════════════════════════════════════════════════════ */

interface PermissionRow {
    collection: string;
    read: boolean;
    write: boolean;
    delete: boolean;
}

function CreateApiKeyDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (key: ApiKeyWithSecret) => void }) {
    const client = useRebaseClient<RebaseClient>();
    const snackbar = useSnackbarController();
    const [name, setName] = useState("");
    const [permissions, setPermissions] = useState<PermissionRow[]>([{ collection: "*", read: true, write: false, delete: false }]);
    const [rateLimit, setRateLimit] = useState("");
    const [expiresIn, setExpiresIn] = useState("never");
    const [creating, setCreating] = useState(false);

    const addRow = () => setPermissions([...permissions, { collection: "", read: true, write: false, delete: false }]);
    const removeRow = (idx: number) => setPermissions(permissions.filter((_, i) => i !== idx));

    const updateRow = (idx: number, field: keyof PermissionRow, value: string | boolean) => {
        setPermissions(permissions.map((row, i) => i === idx ? { ...row, [field]: value } : row));
    };

    const handleCreate = async () => {
        if (!client?.apiKeys || !name.trim()) return;
        const apiPerms: ApiKeyPermission[] = permissions
            .filter(r => r.collection.trim())
            .map(r => ({
                collection: r.collection.trim(),
                operations: [
                    ...(r.read ? ["read" as const] : []),
                    ...(r.write ? ["write" as const] : []),
                    ...(r.delete ? ["delete" as const] : [])
                ]
            }))
            .filter(p => p.operations.length > 0);

        if (apiPerms.length === 0) {
            snackbar.open({ type: "error", message: "At least one permission is required" });
            return;
        }

        let expires_at: string | null = null;
        if (expiresIn === "7d") expires_at = new Date(Date.now() + 7 * 86400000).toISOString();
        else if (expiresIn === "30d") expires_at = new Date(Date.now() + 30 * 86400000).toISOString();
        else if (expiresIn === "90d") expires_at = new Date(Date.now() + 90 * 86400000).toISOString();
        else if (expiresIn === "1y") expires_at = new Date(Date.now() + 365 * 86400000).toISOString();

        setCreating(true);
        try {
            const res = await client.apiKeys.createKey({
                name: name.trim(),
                permissions: apiPerms,
                rate_limit: rateLimit ? parseInt(rateLimit, 10) : null,
                expires_at
            });
            onCreated(res.key);
        } catch (e: unknown) {
            snackbar.open({ type: "error", message: e instanceof Error ? e.message : String(e) });
        } finally { setCreating(false); }
    };

    return (
        <Dialog open onOpenChange={(open) => { if (!open) onClose(); }} maxWidth="lg">
            <DialogTitle>Create API Key</DialogTitle>
            <DialogContent className="space-y-4">
                <TextField
                    label="Name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Analytics Pipeline"
                    size="small"
                    autoFocus
                />

                <div>
                    <Typography variant="caption" color="secondary" className="text-[11px] uppercase tracking-wider font-medium mb-2 block">
                        Permissions
                    </Typography>
                    <div className="space-y-2">
                        {permissions.map((row, idx) => (
                            <div key={idx} className={cls("flex items-center gap-2 p-2 rounded-lg border", defaultBorderMixin)}>
                                <TextField
                                    size="small"
                                    aria-label={`Permission ${idx + 1} collection`}
                                    value={row.collection}
                                    onChange={(e) => updateRow(idx, "collection", e.target.value)}
                                    placeholder="Collection slug or *"
                                    className="flex-1"
                                />
                                <label className="flex items-center gap-1 text-xs cursor-pointer">
                                    <Checkbox size="small" checked={row.read} onCheckedChange={(v) => updateRow(idx, "read", !!v)}/>
                                    <span className="text-emerald-600 dark:text-emerald-400">read</span>
                                </label>
                                <label className="flex items-center gap-1 text-xs cursor-pointer">
                                    <Checkbox size="small" checked={row.write} onCheckedChange={(v) => updateRow(idx, "write", !!v)}/>
                                    <span className="text-blue-600 dark:text-blue-400">write</span>
                                </label>
                                <label className="flex items-center gap-1 text-xs cursor-pointer">
                                    <Checkbox size="small" checked={row.delete} onCheckedChange={(v) => updateRow(idx, "delete", !!v)}/>
                                    <span className="text-red-600 dark:text-red-400">delete</span>
                                </label>
                                {permissions.length > 1 && (
                                    <IconButton size="small" onClick={() => removeRow(idx)}>
                                        <DeleteIcon size={iconSize.smallest}/>
                                    </IconButton>
                                )}
                            </div>
                        ))}
                    </div>
                    <Button size="small" variant="text" onClick={addRow} className="mt-1" startIcon={<AddIcon size={iconSize.smallest}/>}>
                        Add collection
                    </Button>
                </div>

                <div className="flex gap-4">
                    <div className="flex-1">
                        <Select label="Expires" value={expiresIn} onValueChange={setExpiresIn} size="small" renderValue={(v) =>
                            v === "never" ? "Never" :
                            v === "7d" ? "7 days" :
                            v === "30d" ? "30 days" :
                            v === "90d" ? "90 days" : "1 year"
                        }>
                            <SelectItem value="never">Never</SelectItem>
                            <SelectItem value="7d">7 days</SelectItem>
                            <SelectItem value="30d">30 days</SelectItem>
                            <SelectItem value="90d">90 days</SelectItem>
                            <SelectItem value="1y">1 year</SelectItem>
                        </Select>
                    </div>
                    <div className="flex-1">
                        <TextField
                            label="Rate Limit (per 15 min)"
                            value={rateLimit}
                            onChange={(e) => setRateLimit(e.target.value.replace(/\D/g, ""))}
                            placeholder="Default: 1000"
                            size="small"
                        />
                    </div>
                </div>
            </DialogContent>
            <DialogActions>
                <Button variant="text" onClick={onClose}>Cancel</Button>
                <Button
                    color="primary"
                    onClick={handleCreate}
                    disabled={creating || !name.trim()}
                    startIcon={creating ? <CircularProgress size="smallest"/> : undefined}
                >
                    Create Key
                </Button>
            </DialogActions>
        </Dialog>
    );
}

/* ═══════════════════════════════════════════════════════════════
   Secret Display Dialog — shown exactly once after creation
   ═══════════════════════════════════════════════════════════════ */

function SecretDisplayDialog({ keyWithSecret, onClose }: { keyWithSecret: ApiKeyWithSecret; onClose: () => void }) {
    const snackbar = useSnackbarController();
    const [copied, setCopied] = useState(false);

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(keyWithSecret.key);
            setCopied(true);
            snackbar.open({ type: "success", message: "API key copied to clipboard" });
            setTimeout(() => setCopied(false), 2000);
        } catch {
            snackbar.open({ type: "error", message: "Failed to copy" });
        }
    };

    return (
        <Dialog open onOpenChange={(open) => { if (!open) onClose(); }} maxWidth="md">
            <DialogTitle>
                <div className="flex items-center gap-2">
                    <CheckCircleIcon size={iconSize.small} className="text-emerald-500"/>
                    API Key Created
                </div>
            </DialogTitle>
            <DialogContent>
                <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 mb-4">
                    <div className="flex items-center gap-2 mb-1">
                        <AlertCircleIcon size={iconSize.smallest} className="text-amber-600 dark:text-amber-400"/>
                        <Typography variant="caption" className="font-semibold text-amber-700 dark:text-amber-400">
                            Copy your key now — it won&apos;t be shown again
                        </Typography>
                    </div>
                    <Typography variant="caption" className="text-amber-600 dark:text-amber-300">
                        This is the only time the full API key will be displayed. Store it securely.
                    </Typography>
                </div>

                <div className={cls("flex items-center gap-2 p-3 rounded-lg border bg-surface-50 dark:bg-surface-900", defaultBorderMixin)}>
                    <code className="flex-1 text-[12px] font-mono break-all text-surface-700 dark:text-surface-300 select-all">
                        {keyWithSecret.key}
                    </code>
                    <Tooltip title={copied ? "Copied!" : "Copy"}>
                        <IconButton size="small" onClick={handleCopy}>
                            {copied
                                ? <CheckCircleIcon size={iconSize.smallest} className="text-emerald-500"/>
                                : <CopyIcon size={iconSize.smallest}/>
                            }
                        </IconButton>
                    </Tooltip>
                </div>

                <div className="mt-4 space-y-1">
                    <Typography variant="caption" color="secondary">
                        <strong>Name:</strong> {keyWithSecret.name}
                    </Typography>
                    <Typography variant="caption" color="secondary">
                        <strong>Permissions:</strong> {permissionSummary(keyWithSecret.permissions)}
                    </Typography>
                </div>
            </DialogContent>
            <DialogActions>
                <Button color="primary" onClick={onClose}>Done</Button>
            </DialogActions>
        </Dialog>
    );
}
