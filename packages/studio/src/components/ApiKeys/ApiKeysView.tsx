
import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
    Alert,
    Button,
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
    Tab,
    Tabs,
    Tooltip,
    Typography,
    CopyIcon,
    PlusIcon as AddIcon,
    Trash2Icon as DeleteIcon,
    AlertCircleIcon,
    CheckCircleIcon
} from "@rebasepro/ui";
import { useRebaseClient, useSnackbarController, useTranslation } from "@rebasepro/app";
import {
    ADMIN_ROLE,
    hasAdminRole,
    summarizeScopes,
    type ApiKeyKind,
    type ApiKeyMasked,
    type ApiKeyWithSecret,
    type RebaseClient,
    type ScopeSummary
} from "@rebasepro/types";

import { CreateApiKeyDialog, PlaneIcon, type ScopeListingState } from "./CreateApiKeyDialog";
import { groupKeyScopes, isPersonalKeysDisabled, readScopeListing, type ScopeGroup } from "./scopes";
import { everyTargetLabel, heldScopeLine, localizeScopes, planeHint, planeLabel, targetLabel, type Translate } from "./scope-words";
import { classifyLoadFailure, type LoadFailure } from "../load-failure";
import { LoadFailureView } from "../load-failure-view";

/* ═══════════════════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════════════════ */

/** Within a day, relative and in the panel's language; beyond it, the date. */
function formatRelative(iso: string | null | undefined, language: string): string {
    if (!iso) return "—";
    const date = new Date(iso);
    const diff = date.getTime() - Date.now();
    const abs = Math.abs(diff);
    try {
        if (abs >= 86_400_000) return date.toLocaleDateString(language);
        const format = new Intl.RelativeTimeFormat(language, { numeric: "auto", style: "short" });
        if (abs < 3_600_000) return format.format(Math.round(diff / 60_000), "minute");
        return format.format(Math.round(diff / 3_600_000), "hour");
    } catch {
        return date.toLocaleDateString();
    }
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

function statusLabel(t: Translate, kind: KeyStatusKind): string {
    switch (kind) {
        case "active": return t("studio_api_keys_status_active");
        case "expired": return t("studio_api_keys_status_expired");
        case "revoked": return t("studio_api_keys_status_revoked");
    }
}

/** A service key that runs as `admin` reads every row. A personal key has no roles of its own. */
function readsEveryRow(key: ApiKeyMasked): boolean {
    return key.kind === "service" && hasAdminRole(key.roles);
}

/** One short phrase for a list row: the one scope a key holds, or how many. */
function scopeBrief(t: Translate, groups: ScopeGroup[]): string {
    const held = groups.flatMap(group => group.scopes);
    if (held.length === 0) return "—";
    if (held.length === 1) return held[0].label;
    return t("studio_api_keys_scopes_count", { count: held.length });
}

/**
 * The scope catalogue — every scope this backend knows, worded, and what the
 * signed-in account holds. The create dialog offers from it; the detail panel
 * labels a key's scopes with it, and falls back to the built-in wording while
 * it is loading or when this backend does not serve it.
 */
function useScopeListing(client: RebaseClient | undefined): [ScopeListingState, () => void] {
    const [state, setState] = useState<ScopeListingState>({ status: "loading" });
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        const api = client?.personalKeys;
        if (!api) {
            setState({ status: "failed", message: "" });
            return;
        }
        let cancelled = false;
        setState({ status: "loading" });
        (async () => {
            try {
                const listing = readScopeListing(await api.listScopes());
                if (!cancelled) setState(listing ? { status: "ready", listing } : { status: "failed", message: "" });
            } catch (e: unknown) {
                if (!cancelled) setState({ status: "failed", message: e instanceof Error ? e.message : String(e) });
            }
        })();
        return () => { cancelled = true; };
    }, [client, attempt]);

    const retry = useCallback(() => setAttempt(n => n + 1), []);
    return [state, retry];
}

/* ═══════════════════════════════════════════════════════════════
   Main Component
   ═══════════════════════════════════════════════════════════════ */

export function ApiKeysView() {
    const client = useRebaseClient<RebaseClient>();
    const { t } = useTranslation();
    const [kind, setKind] = useState<ApiKeyKind>("service");
    const [scopeListing, retryScopes] = useScopeListing(client);

    const tabs = (
        <Tabs
            value={kind}
            onValueChange={(value) => setKind(value === "personal" ? "personal" : "service")}
            variant="boxy"
            className="border-b border-hairline"
        >
            <Tab value="service">{t("studio_api_keys_tab_service")}</Tab>
            <Tab value="personal">{t("studio_api_keys_tab_personal")}</Tab>
        </Tabs>
    );

    // Keyed by kind: each tab is its own list, selection and failure.
    return (
        <KeysPane
            key={kind}
            kind={kind}
            tabs={tabs}
            scopeListing={scopeListing}
            onRetryScopes={retryScopes}
        />
    );
}

/* ═══════════════════════════════════════════════════════════════
   One tab: service keys, or the signed-in account's own
   ═══════════════════════════════════════════════════════════════ */

function KeysPane({
                      kind,
                      tabs,
                      scopeListing,
                      onRetryScopes
                  }: {
    kind: ApiKeyKind;
    tabs: React.ReactNode;
    scopeListing: ScopeListingState;
    onRetryScopes: () => void;
}) {
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
    /** The backend answered PERSONAL_KEYS_DISABLED: a setting, not a failure. */
    const [personalOff, setPersonalOff] = useState(false);

    // Built-in scopes in the panel's language; app scopes as the app declared them.
    const catalogue: readonly ScopeSummary[] = useMemo(
        () => localizeScopes(t, scopeListing.status === "ready" ? scopeListing.listing.scopes : summarizeScopes()),
        [t, scopeListing]
    );

    const clientRef = useRef(client);
    clientRef.current = client;
    const snackbarRef = useRef(snackbar);
    snackbarRef.current = snackbar;

    const keysApi = useCallback(() => {
        const c = clientRef.current;
        return kind === "service" ? c?.apiKeys : c?.personalKeys;
    }, [kind]);

    const loadKeys = useCallback(async () => {
        const api = keysApi();
        if (!api) { setLoading(false); return; }
        try {
            const res = await api.listKeys();
            setKeys(res.keys);
            setFailure(null);
            setPersonalOff(false);
        } catch (e: unknown) {
            // "No API keys yet" is a claim about the project. A refused listing
            // is a claim about the caller, and only one of the two is an
            // invitation to create a key. Personal keys switched off is a third
            // thing: the app's own setting, explained rather than reported.
            if (kind === "personal" && isPersonalKeysDisabled(e)) {
                setPersonalOff(true);
                setFailure(null);
            } else {
                setFailure(classifyLoadFailure(e));
            }
        } finally {
            setLoading(false);
        }
    }, [keysApi, kind]);

    useEffect(() => { loadKeys(); }, [loadKeys]);

    const handleRevoke = async (id: string) => {
        const api = keysApi();
        if (!api) return;
        setRevoking(id);
        try {
            await api.revokeKey(id);
            snackbarRef.current.open({ type: "success", message: t("studio_api_keys_revoked") });
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

    return (
        <>
            <div className="flex h-full w-full overflow-hidden bg-surface-card">
                {/* ── Key List ── */}
                <div className={cls("flex flex-col w-[340px] min-w-[280px] border-r h-full", defaultBorderMixin)}>
                    {tabs}
                    <div className={cls("flex items-center justify-between px-4 py-2.5 border-b bg-surface-sheet min-h-[48px]", defaultBorderMixin)}>
                        <div className="flex items-center gap-2">
                            <KeyRoundIcon size={iconSize.smallest} className="text-primary"/>
                            <Typography variant="subtitle2" className="font-semibold">{t("studio_tool_api_keys")}</Typography>
                            <Chip size="smallest" className="bg-surface-raised text-surface-600 dark:text-surface-300">{activeKeys.length}</Chip>
                        </div>
                        <div className="flex items-center gap-1">
                            <IconButton size="small" onClick={loadKeys} title={t("studio_api_keys_refresh")}><RefreshCwIcon size={iconSize.smallest}/></IconButton>
                            <Button
                                size="small"
                                color="primary"
                                disabled={personalOff}
                                onClick={() => setShowCreate(true)}
                                startIcon={<AddIcon size={iconSize.smallest}/>}
                            >
                                {t("studio_api_keys_new")}
                            </Button>
                        </div>
                    </div>
                    <div className="flex-1 overflow-y-auto p-2 space-y-1">
                        {loading && (
                            <div className="flex items-center justify-center h-full"><CircularProgress/></div>
                        )}
                        {!loading && failure && (
                            <LoadFailureView
                                failure={failure}
                                title={kind === "service" ? t("studio_api_keys_read_failed") : t("studio_api_keys_personal_read_failed")}
                                deniedTitle={kind === "service" ? t("studio_api_keys_denied_title") : t("studio_api_keys_personal_denied_title")}
                                deniedHint={kind === "service" ? t("studio_api_keys_denied_hint") : t("studio_api_keys_personal_denied_hint")}
                                onRetry={loadKeys}
                            />
                        )}
                        {!loading && personalOff && <PersonalKeysOff/>}
                        {!loading && !failure && !personalOff && activeKeys.length === 0 && inactiveKeys.length === 0 && (
                            <div className="flex flex-col items-center justify-center h-full gap-3 text-center p-6">
                                <KeyRoundIcon size={iconSize.medium} className="text-surface-300 dark:text-surface-600"/>
                                <Typography variant="body2" color="secondary">
                                    {kind === "service" ? t("studio_api_keys_empty_title") : t("studio_api_keys_personal_empty_title")}
                                </Typography>
                                <Typography variant="caption" color="disabled">
                                    {kind === "service" ? t("studio_api_keys_empty_hint") : t("studio_api_keys_personal_empty_hint")}
                                </Typography>
                            </div>
                        )}
                        {!loading && activeKeys.map(key => (
                            <KeyListItem key={key.id} apiKey={key} catalogue={catalogue} selected={selectedId === key.id} onClick={() => setSelectedId(key.id)}/>
                        ))}
                        {!loading && inactiveKeys.length > 0 && (
                            <>
                                <div className="px-2 pt-3 pb-1">
                                    <Typography variant="caption" color="disabled" className="text-[10px] uppercase tracking-wider font-medium">{t("studio_api_keys_inactive_heading")}</Typography>
                                </div>
                                {inactiveKeys.map(key => (
                                    <KeyListItem key={key.id} apiKey={key} catalogue={catalogue} selected={selectedId === key.id} onClick={() => setSelectedId(key.id)}/>
                                ))}
                            </>
                        )}
                    </div>
                </div>

                {/* ── Detail Panel ── */}
                <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
                    {!selectedKey ? (
                        <div className="flex items-center justify-center h-full">
                            {!personalOff && (
                                <Typography variant="body2" color="disabled">{t("studio_api_keys_select_hint")}</Typography>
                            )}
                        </div>
                    ) : (
                        <KeyDetail
                            apiKey={selectedKey}
                            catalogue={catalogue}
                            revoking={revoking === selectedKey.id}
                            onRevoke={() => setConfirmRevoke(selectedKey)}
                        />
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
                        {t("studio_api_keys_revoke_title", { name: confirmRevoke?.name ?? "" })}
                    </Typography>
                    <Typography variant="body2" color="secondary">
                        {t("studio_api_keys_revoke_body")}
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
                        {t("studio_api_keys_revoke")}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Create Dialog */}
            {showCreate && (
                <CreateApiKeyDialog
                    kind={kind}
                    scopeListing={scopeListing}
                    onRetryScopes={onRetryScopes}
                    onClose={() => setShowCreate(false)}
                    onCreated={handleCreated}
                />
            )}

            {/* Secret Display Dialog */}
            {showSecret && (
                <SecretDisplayDialog
                    keyWithSecret={showSecret}
                    catalogue={catalogue}
                    onClose={() => setShowSecret(null)}
                />
            )}
        </>
    );
}

/* ═══════════════════════════════════════════════════════════════
   Personal keys switched off
   ═══════════════════════════════════════════════════════════════ */

/**
 * Not an error and not a refusal of this person: the app has not enabled
 * personal keys. Says what they are and where the switch is.
 */
function PersonalKeysOff() {
    const { t } = useTranslation();
    return (
        <div className="flex flex-col items-center justify-center h-full gap-3 text-center p-6">
            <KeyRoundIcon size={iconSize.medium} className="text-surface-300 dark:text-surface-600"/>
            <Typography variant="body2" color="secondary">{t("studio_api_keys_personal_off_title")}</Typography>
            <Typography variant="caption" color="disabled" className="max-w-[34ch]">
                {t("studio_api_keys_personal_off_body")}
            </Typography>
            <Typography variant="mono" component="div" className="text-[11px] px-2 py-1 rounded-md bg-surface-field">
                {"auth: { personalKeys: true }"}
            </Typography>
        </div>
    );
}

/* ═══════════════════════════════════════════════════════════════
   List item
   ═══════════════════════════════════════════════════════════════ */

/**
 * Marks a service key that runs as the admin role.
 *
 * Not cosmetic: such a key reads every row through the admin policies, and
 * without this it is indistinguishable in the list from a narrow one.
 */
function AdminChip() {
    const { t } = useTranslation();
    return (
        <Tooltip title={t("studio_api_keys_admin_chip_tooltip")}>
            <Chip size="smallest" colorScheme="yellow" className="shrink-0" icon={<ShieldIcon size={10}/>}>
                {ADMIN_ROLE}
            </Chip>
        </Tooltip>
    );
}

function KeyListItem({ apiKey, catalogue, selected, onClick }: {
    apiKey: ApiKeyMasked;
    catalogue: readonly ScopeSummary[];
    selected: boolean;
    onClick: () => void;
}) {
    const { t } = useTranslation();
    const status = keyStatus(apiKey);
    return (
        <div
            onClick={onClick}
            className={cls(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-all",
                selected
                    ? "bg-primary/10 dark:bg-primary/15 ring-1 ring-primary/30"
                    : "hover:bg-surface-hover"
            )}
        >
            <div className={cls("w-2 h-2 rounded-full shrink-0",
                status.kind === "active" ? "bg-emerald-400" :
                status.kind === "expired" ? "bg-amber-400" : "bg-red-400"
            )}/>
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 min-w-0">
                    <Typography variant="body2" className="truncate font-medium text-[13px]">{apiKey.name}</Typography>
                    {readsEveryRow(apiKey) && <AdminChip/>}
                </div>
                <Typography variant="caption" color="secondary" className="truncate text-[11px] font-mono">{apiKey.key_prefix}•••</Typography>
            </div>
            <div className="shrink-0">
                <Typography variant="caption" color="disabled" className="text-[10px]">
                    {scopeBrief(t, groupKeyScopes(apiKey.scopes, catalogue))}
                </Typography>
            </div>
        </div>
    );
}

/* ═══════════════════════════════════════════════════════════════
   Detail
   ═══════════════════════════════════════════════════════════════ */

function KeyDetail({ apiKey, catalogue, revoking, onRevoke }: {
    apiKey: ApiKeyMasked;
    catalogue: readonly ScopeSummary[];
    revoking: boolean;
    onRevoke: () => void;
}) {
    const { t, i18n } = useTranslation();
    const language = i18n.language;
    const status = keyStatus(apiKey);
    const groups = groupKeyScopes(apiKey.scopes, catalogue);
    const service = apiKey.kind === "service";

    return (
        <>
            {/* Header */}
            <div className={cls("flex items-center justify-between px-5 py-3 border-b bg-surface-card min-h-[56px]", defaultBorderMixin)}>
                <div className="flex items-center gap-3 min-w-0">
                    <KeyRoundIcon size={iconSize.small} className="text-primary shrink-0"/>
                    <div className="min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                            <Typography variant="subtitle1" className="font-semibold truncate">{apiKey.name}</Typography>
                            {readsEveryRow(apiKey) && <AdminChip/>}
                        </div>
                        <Typography variant="caption" color="secondary" className="font-mono text-[11px]">{apiKey.key_prefix}•••</Typography>
                    </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    {!apiKey.revoked_at && (
                        <Button
                            size="small"
                            color="error"
                            variant="outlined"
                            onClick={onRevoke}
                            disabled={revoking}
                            startIcon={revoking ? <CircularProgress size="smallest"/> : <DeleteIcon size={iconSize.smallest}/>}
                        >
                            {t("studio_api_keys_revoke")}
                        </Button>
                    )}
                </div>
            </div>

            {/* Stats */}
            <div className="px-5 py-4 bg-surface-sheet">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <StatCard label={t("studio_api_keys_stat_status")} value={statusLabel(t, status.kind)} className={status.color}/>
                    <StatCard label={t("created")} value={formatRelative(apiKey.created_at, language)}/>
                    <StatCard label={t("studio_api_keys_stat_last_used")} value={formatRelative(apiKey.last_used_at, language)}/>
                    <StatCard label={t("studio_api_keys_stat_expires")} value={apiKey.expires_at ? formatRelative(apiKey.expires_at, language) : t("studio_api_keys_never")}/>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-3">
                    <StatCard
                        label={t("studio_api_keys_stat_kind")}
                        value={service ? t("studio_api_keys_kind_service") : t("studio_api_keys_kind_personal")}
                    />
                    <StatCard
                        label={t("studio_api_keys_stat_rate_limit")}
                        value={apiKey.rate_limit
                            ? t("studio_api_keys_rate_limit_value", { limit: apiKey.rate_limit })
                            : t("studio_api_keys_rate_limit_default")}
                    />
                    {service
                        ? <StatCard label={t("studio_api_keys_stat_created_by")} value={apiKey.created_by} mono/>
                        : <StatCard label={t("studio_api_keys_stat_owner")} value={apiKey.owner_uid ?? "—"} mono/>}
                </div>
            </div>

            {/* Scopes */}
            <div className={cls("flex items-center gap-2 px-5 py-2 border-y bg-surface-card", defaultBorderMixin)}>
                <Typography variant="subtitle2" className="font-semibold text-[13px]">{t("studio_api_keys_scopes")}</Typography>
                <Chip size="smallest" className="bg-surface-raised text-surface-600 dark:text-surface-300">
                    {apiKey.scopes.length}
                </Chip>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-3 flex flex-col gap-5">
                <RolesBlock apiKey={apiKey}/>
                {groups.length === 0
                    ? <Typography variant="body2" color="disabled">{t("studio_api_keys_no_scopes")}</Typography>
                    : groups.map(group => (
                        <div key={group.plane}>
                            <BlockHeading
                                icon={<PlaneIcon plane={group.plane} className="text-surface-500 dark:text-surface-400"/>}
                                label={planeLabel(t, group.plane)}
                                hint={planeHint(t, group.plane)}
                            />
                            <div className="space-y-2">
                                {group.scopes.map(held => (
                                    <div key={held.scope} className={cls("flex items-center gap-3 px-3 py-2 rounded-lg border", defaultBorderMixin)}>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-baseline gap-2 min-w-0">
                                                <Typography variant="body2" className="text-[13px] font-medium truncate">
                                                    {held.label}
                                                </Typography>
                                                <Typography variant="caption" color="disabled" className="font-mono text-[11px] shrink-0">
                                                    {held.scope}
                                                </Typography>
                                            </div>
                                            {held.description && (
                                                <Typography variant="caption" color="secondary" className="block text-[11px] leading-snug">
                                                    {held.description}
                                                </Typography>
                                            )}
                                        </div>
                                        {held.targetKind && (
                                            <div className="flex flex-wrap justify-end gap-1 shrink-0 max-w-[50%]">
                                                {held.targets === "all"
                                                    ? (
                                                        <Chip size="smallest" className="bg-surface-raised text-surface-600 dark:text-surface-300">
                                                            {everyTargetLabel(t, held.targetKind)}
                                                        </Chip>
                                                    )
                                                    : held.targets.map(target => (
                                                        <Chip key={target} size="smallest" className="font-mono bg-surface-raised text-surface-700 dark:text-surface-200">
                                                            {targetLabel(t, held.targetKind, target)}
                                                        </Chip>
                                                    ))}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
            </div>
        </>
    );
}

function BlockHeading({ icon, label, hint }: { icon: React.ReactNode; label: string; hint: string }) {
    return (
        <div className="flex items-center gap-2 mb-2 min-w-0">
            {icon}
            <Typography variant="body2" className="text-[13px] font-medium shrink-0">{label}</Typography>
            <Typography variant="caption" color="secondary" className="text-[11px] truncate">{hint}</Typography>
        </div>
    );
}

/**
 * Who the key runs as — which rows it reads. Scopes, below it, are which
 * endpoints it may call; the two are separate and both are shown.
 */
function RolesBlock({ apiKey }: { apiKey: ApiKeyMasked }) {
    const { t } = useTranslation();
    const shield = <ShieldIcon size={iconSize.smallest} className="text-surface-500 dark:text-surface-400"/>;

    if (apiKey.kind === "personal") {
        return (
            <div>
                <BlockHeading icon={shield} label={t("studio_api_keys_roles")} hint={t("studio_api_keys_roles_rows_hint")}/>
                <Typography variant="caption" color="secondary" className="block text-[12px] leading-snug">
                    {t("studio_api_keys_personal_roles")}
                </Typography>
            </div>
        );
    }

    return (
        <div>
            <BlockHeading icon={shield} label={t("studio_api_keys_roles")} hint={t("studio_api_keys_roles_rows_hint")}/>
            <div className="flex flex-wrap gap-1.5">
                <Chip size="small" className="font-mono bg-surface-raised text-surface-600 dark:text-surface-300">service</Chip>
                {apiKey.roles.map(role => (
                    <Chip
                        key={role}
                        size="small"
                        colorScheme={role === ADMIN_ROLE ? "yellow" : undefined}
                        className={cls("font-mono", role !== ADMIN_ROLE && "bg-surface-raised text-surface-700 dark:text-surface-200")}
                    >
                        {role}
                    </Chip>
                ))}
            </div>
            {readsEveryRow(apiKey)
                ? (
                    <Alert color="warning" size="small" outerClassName="mt-2">
                        {t("studio_api_keys_admin_reads_every_row")}
                    </Alert>
                )
                : (
                    <Typography variant="caption" color="secondary" className="block mt-1.5 text-[11px] leading-snug">
                        {apiKey.roles.length === 0 ? t("studio_api_keys_roles_service_only") : t("studio_api_keys_roles_service_plus")}
                    </Typography>
                )}
        </div>
    );
}

/* ═══════════════════════════════════════════════════════════════
   Stat card
   ═══════════════════════════════════════════════════════════════ */

function StatCard({ label, value, mono, className }: { label: string; value: string; mono?: boolean; className?: string }) {
    return (
        <div className={cls("px-3 py-2 rounded-lg border bg-surface-card", defaultBorderMixin)}>
            <Typography variant="caption" color="secondary" className="text-[10px] uppercase tracking-wider font-medium">{label}</Typography>
            <Typography variant="body2" className={cls(
                "mt-0.5 font-semibold text-[13px] truncate",
                mono && "font-mono",
                className
            )}>{value}</Typography>
        </div>
    );
}

/* ═══════════════════════════════════════════════════════════════
   Secret Display Dialog — shown exactly once after creation
   ═══════════════════════════════════════════════════════════════ */

function SecretDisplayDialog({ keyWithSecret, catalogue, onClose }: {
    keyWithSecret: ApiKeyWithSecret;
    catalogue: readonly ScopeSummary[];
    onClose: () => void;
}) {
    const { t } = useTranslation();
    const snackbar = useSnackbarController();
    const [copied, setCopied] = useState(false);
    const granted = groupKeyScopes(keyWithSecret.scopes, catalogue).flatMap(group => group.scopes);

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(keyWithSecret.key);
            setCopied(true);
            snackbar.open({ type: "success", message: t("studio_api_keys_copied") });
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
                    {t("studio_api_keys_created_title")}
                </div>
            </DialogTitle>
            <DialogContent>
                <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 mb-4">
                    <div className="flex items-center gap-2 mb-1">
                        <AlertCircleIcon size={iconSize.smallest} className="text-amber-600 dark:text-amber-400"/>
                        <Typography variant="caption" className="font-semibold text-amber-700 dark:text-amber-400">
                            {t("studio_api_keys_copy_now")}
                        </Typography>
                    </div>
                    <Typography variant="caption" className="text-amber-600 dark:text-amber-300">
                        {t("studio_api_keys_copy_now_hint")}
                    </Typography>
                </div>

                <div className={cls("flex items-center gap-2 p-3 rounded-lg border bg-surface-sheet", defaultBorderMixin)}>
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
                    <Typography variant="caption" color="secondary" className="block">
                        <strong>{t("studio_api_keys_name_label")}</strong> {keyWithSecret.name}
                    </Typography>
                    <Typography variant="caption" color="secondary" className="block">
                        <strong>{t("studio_api_keys_access_label")}</strong>{" "}
                        {granted.length > 0 ? granted.map(held => heldScopeLine(t, held)).join("; ") : "—"}
                    </Typography>
                    {readsEveryRow(keyWithSecret) && (
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
