
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
    ShieldIcon,
    Tooltip,
    Typography,
    CopyIcon,
    PlusIcon as AddIcon,
    Trash2Icon as DeleteIcon,
    AlertCircleIcon,
    CheckCircleIcon
} from "@rebasepro/ui";
import { useRebaseClient, useSnackbarController, useTranslation } from "@rebasepro/app";
import type { ApiKeyMasked, ApiKeyWithSecret, RebaseClient } from "@rebasepro/types";

import { CreateApiKeyDialog } from "./CreateApiKeyDialog";
import { permissionSummary, resourceLabel, resourcePhrase } from "./permissions";
import { classifyLoadFailure, type LoadFailure } from "../load-failure";
import { LoadFailureView } from "../load-failure-view";

/* ═══════════════════════════════════════════════════════════════
   Helpers

   The row types come from `@rebasepro/types`: this view used to declare its
   own copies, and they had already drifted — neither carried `admin`, so the
   panel could not tell an admin key from a scoped one.
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

function isExpired(key: ApiKeyMasked): boolean {
    return !!(key.expires_at && new Date(key.expires_at) < new Date());
}

type KeyStatusKind = "active" | "expired" | "revoked";

function keyStatus(key: ApiKeyMasked): { kind: KeyStatusKind; color: string } {
    if (key.revoked_at) return { kind: "revoked", color: "text-red-500" };
    if (isExpired(key)) return { kind: "expired", color: "text-amber-500" };
    return { kind: "active", color: "text-emerald-500" };
}

/* ═══════════════════════════════════════════════════════════════
   Main Component
   ═══════════════════════════════════════════════════════════════ */

export function ApiKeysView() {
    const client = useRebaseClient<RebaseClient>();
    const snackbar = useSnackbarController();
    const { t } = useTranslation();
    const [keys, setKeys] = useState<ApiKeyMasked[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [showCreate, setShowCreate] = useState(false);
    const [showSecret, setShowSecret] = useState<ApiKeyWithSecret | null>(null);
    const [revoking, setRevoking] = useState<string | null>(null);
    const [confirmRevoke, setConfirmRevoke] = useState<ApiKeyMasked | null>(null);
    /** Why the key listing failed, classified — see `load-failure.ts`. */
    const [failure, setFailure] = useState<LoadFailure | null>(null);

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
            setFailure(null);
        } catch (e: unknown) {
            // "No API keys yet" is a claim about the project. A refused listing
            // is a claim about the caller, and only one of the two is an
            // invitation to create a key.
            setFailure(classifyLoadFailure(e));
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
                            <Typography variant="subtitle2" className="font-semibold">{t("studio_tool_api_keys")}</Typography>
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
                        {failure && (
                            <LoadFailureView
                                failure={failure}
                                title={t("studio_api_keys_read_failed")}
                                deniedTitle={t("studio_api_keys_denied_title")}
                                deniedHint={t("studio_api_keys_denied_hint")}
                                onRetry={loadKeys}
                            />
                        )}
                        {!failure && activeKeys.length === 0 && inactiveKeys.length === 0 && (
                            <div className="flex flex-col items-center justify-center h-full gap-3 text-center p-6">
                                <KeyRoundIcon size={iconSize.medium} className="text-surface-300 dark:text-surface-600"/>
                                <Typography variant="body2" color="secondary">{t("studio_api_keys_empty_title")}</Typography>
                                <Typography variant="caption" color="disabled">{t("studio_api_keys_empty_hint")}</Typography>
                            </div>
                        )}
                        {activeKeys.map(key => (
                            <KeyListItem key={key.id} apiKey={key} selected={selectedId === key.id} onClick={() => setSelectedId(key.id)}/>
                        ))}
                        {inactiveKeys.length > 0 && (
                            <>
                                <div className="px-2 pt-3 pb-1">
                                    <Typography variant="caption" color="disabled" className="text-[10px] uppercase tracking-wider font-medium">{t("studio_api_keys_revoke")}d / Expired</Typography>
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
                            <Typography variant="body2" color="disabled">{t("studio_api_keys_select_hint")}</Typography>
                        </div>
                    ) : (
                        <>
                            {/* Header */}
                            <div className={cls("flex items-center justify-between px-5 py-3 border-b bg-white dark:bg-surface-950 min-h-[56px]", defaultBorderMixin)}>
                                <div className="flex items-center gap-3 min-w-0">
                                    <KeyRoundIcon size={iconSize.small} className="text-primary shrink-0"/>
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2 min-w-0">
                                            <Typography variant="subtitle1" className="font-semibold truncate">{selectedKey.name}</Typography>
                                            {selectedKey.admin && <AdminChip/>}
                                        </div>
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
                                            {t("studio_api_keys_revoke")}
                                        </Button>
                                    )}
                                </div>
                            </div>

                            {/* Stats */}
                            <div className="px-5 py-4 bg-surface-50 dark:bg-surface-900/50">
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                    <StatCard label={t("studio_api_keys_stat_status")} value={t(`studio_api_keys_status_${keyStatus(selectedKey).kind}`)} className={keyStatus(selectedKey).color}/>
                                    <StatCard label={t("created")} value={formatRelative(selectedKey.created_at)}/>
                                    <StatCard label={t("studio_api_keys_stat_last_used")} value={formatRelative(selectedKey.last_used_at)}/>
                                    <StatCard label={t("studio_api_keys_stat_expires")} value={selectedKey.expires_at ? formatRelative(selectedKey.expires_at) : t("studio_api_keys_never")}/>
                                </div>
                                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-3">
                                    <StatCard
                                        label={t("role")}
                                        value={selectedKey.admin ? t("admin") : t("studio_api_keys_role_service")}
                                        className={selectedKey.admin ? "text-amber-600 dark:text-amber-400" : undefined}
                                    />
                                    <StatCard label={t("studio_api_keys_stat_rate_limit")} value={selectedKey.rate_limit ? `${selectedKey.rate_limit}/15min` : t("studio_api_keys_rate_limit_default")}/>
                                    <StatCard label={t("studio_api_keys_stat_created_by")} value={selectedKey.created_by} mono/>
                                </div>
                            </div>

                            {/* Permissions */}
                            <div className={cls("flex items-center gap-2 px-5 py-2 border-y bg-white dark:bg-surface-950", defaultBorderMixin)}>
                                <Typography variant="subtitle2" className="font-semibold text-[13px]">{t("studio_api_keys_permissions")}</Typography>
                                <Chip size="smallest" className="bg-surface-200 dark:bg-surface-700 text-surface-600 dark:text-surface-300">
                                    {selectedKey.permissions.length}
                                </Chip>
                            </div>
                            <div className="flex-1 overflow-y-auto px-5 py-3">
                                {selectedKey.admin && (
                                    <div className="flex items-start gap-2 mb-3 px-3 py-2 rounded-lg border border-amber-500/40 bg-amber-500/[0.06]">
                                        <ShieldIcon size={iconSize.smallest} className="mt-[3px] shrink-0 text-amber-600 dark:text-amber-400"/>
                                        <Typography variant="caption" className="text-[12px] leading-snug text-amber-700 dark:text-amber-300">
                                            This key holds the <span className="font-semibold">admin role</span>: it also passes the
                                            admin-gated routes — users, roles, cron, backups, logs — and reads through the
                                            <span className="font-mono"> default_admin</span> RLS policies, beyond the resources listed here.
                                        </Typography>
                                    </div>
                                )}
                                {selectedKey.permissions.length === 0 ? (
                                    <Typography variant="body2" color="disabled">{t("studio_api_keys_no_permissions")}</Typography>
                                ) : (
                                    <div className="space-y-2">
                                        {selectedKey.permissions.map((perm, idx) => (
                                            <div key={idx} className={cls("flex items-center gap-3 px-3 py-2 rounded-lg border", defaultBorderMixin)}>
                                                <div className="flex-1 min-w-0">
                                                    <Typography variant="body2" className="text-[13px] font-medium truncate">
                                                        {resourceLabel(perm.collection)}
                                                    </Typography>
                                                    <Typography variant="caption" color="secondary" className="text-[11px]">
                                                        {resourcePhrase(perm.collection)}
                                                    </Typography>
                                                </div>
                                                <div className="flex items-center gap-1 shrink-0">
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
                <DialogTitle hidden>{t("studio_api_keys_revoke_confirmation")}</DialogTitle>
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
                        {t("cancel")}
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

/**
 * Marks a key that carries the admin role.
 *
 * Not cosmetic: an admin key reaches the admin routes and the `default_admin`
 * RLS policies, and without this it is indistinguishable in the list from a
 * read-only one.
 */
function AdminChip() {
    return (
        <Tooltip title="Carries the admin role: the admin-gated routes and the default_admin RLS policies">
            <Chip
                size="smallest"
                className="shrink-0 bg-amber-500/12 dark:bg-amber-500/12 text-amber-700 dark:text-amber-300 border-amber-500/30 dark:border-amber-500/30"
            >
                <ShieldIcon size={10}/>
                admin
            </Chip>
        </Tooltip>
    );
}

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
                status.kind === "active" ? "bg-emerald-400" :
                status.kind === "expired" ? "bg-amber-400" : "bg-red-400"
            )}/>
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 min-w-0">
                    <Typography variant="body2" className="truncate font-medium text-[13px]">{apiKey.name}</Typography>
                    {apiKey.admin && <AdminChip/>}
                </div>
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
   Secret Display Dialog — shown exactly once after creation
   ═══════════════════════════════════════════════════════════════ */

function SecretDisplayDialog({ keyWithSecret, onClose }: { keyWithSecret: ApiKeyWithSecret; onClose: () => void }) {
    const { t } = useTranslation();
    const snackbar = useSnackbarController();
    const [copied, setCopied] = useState(false);

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(keyWithSecret.key);
            setCopied(true);
            snackbar.open({ type: "success", message: "API key copied to clipboard" });
            setTimeout(() => setCopied(false), 2000);
        } catch {
            snackbar.open({ type: "error", message: t("studio_api_keys_copy_failed") });
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
                    <Tooltip title={copied ? t("copied") : t("copy")}>
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
                        <strong>{t("studio_api_keys_name_label")}</strong> {keyWithSecret.name}
                    </Typography>
                    <Typography variant="caption" color="secondary">
                        <strong>{t("studio_api_keys_access_label")}</strong> {permissionSummary(keyWithSecret.permissions)}
                    </Typography>
                    {keyWithSecret.admin && (
                        <Typography variant="caption" className="flex items-center gap-1.5 text-amber-700 dark:text-amber-300">
                            <ShieldIcon size={iconSize.smallest} className="shrink-0"/>
                            <span><strong>{t("studio_api_keys_admin_granted")}</strong> — {t("studio_api_keys_admin_granted_hint")}</span>
                        </Typography>
                    )}
                </div>
            </DialogContent>
            <DialogActions>
                <Button color="primary" onClick={onClose}>{t("studio_api_keys_done")}</Button>
            </DialogActions>
        </Dialog>
    );
}
