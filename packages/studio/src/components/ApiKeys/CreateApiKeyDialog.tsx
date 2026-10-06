import React, { useEffect, useMemo, useState } from "react";
import {
    Alert,
    Button,
    Checkbox,
    CircularProgress,
    cls,
    DatabaseIcon,
    defaultBorderMixin,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    iconSize,
    Label,
    MultiSelect,
    MultiSelectItem,
    Select,
    SelectItem,
    ShieldIcon,
    TagIcon,
    TextField,
    Tooltip,
    Typography,
    WrenchIcon
} from "@rebasepro/ui";
import {
    useApiBase,
    useApiConfig,
    useRebaseClient,
    useStorageSources,
    useStudioCollectionRegistry,
    useTranslation
} from "@rebasepro/app";
import {
    DEFAULT_STORAGE_SOURCE_KEY,
    hasAdminRole,
    scopeTargets,
    type ApiKeyKind,
    type ApiKeyWithSecret,
    type RebaseClient,
    type RoleSummary,
    type ScopeSummary
} from "@rebasepro/types";

import {
    buildScopeList,
    combineRoles,
    defaultSelection,
    EXPIRY_CHOICES,
    expiresAtFor,
    functionNamesFrom,
    grantableScopes,
    groupKeyScopes,
    incompleteScopes,
    isExpiryChoice,
    rateLimitFrom,
    readKeyError,
    SCOPE_PLANES,
    splitList,
    type ExpiryChoice,
    type KeyError,
    type ScopeListing,
    type ScopePlane,
    type ScopeSelection,
    type TargetChoice
} from "./scopes";
import { everyTargetLabel, heldScopeLine, keyErrorTitle, localizeScopes, planeHint, planeLabel, type Translate } from "./scope-words";

/** The scope catalogue as the panel holds it: still loading, read, or not readable. */
export type ScopeListingState =
    | { status: "loading" }
    | { status: "ready"; listing: ScopeListing }
    | { status: "failed"; message: string };

/* ═══════════════════════════════════════════════════════════════
   Section heading
   ═══════════════════════════════════════════════════════════════ */

function SectionLabel({ children, hint }: { children: React.ReactNode; hint?: React.ReactNode }) {
    return (
        <div className="flex items-baseline gap-2 mb-2">
            <Typography
                variant="label"
                className="text-2xs uppercase tracking-wider font-semibold text-surface-600 dark:text-surface-300"
                gutterBottom={false}
            >
                {children}
            </Typography>
            {hint && (
                <Typography variant="caption" color="secondary" className="text-2xs" gutterBottom={false}>
                    {hint}
                </Typography>
            )}
        </div>
    );
}

export function PlaneIcon({ plane, className }: { plane: ScopePlane; className?: string }) {
    const Component = plane === "data" ? DatabaseIcon : plane === "admin" ? WrenchIcon : TagIcon;
    return <Component size={iconSize.smallest} className={className}/>;
}

/* ═══════════════════════════════════════════════════════════════
   One scope in the picker
   ═══════════════════════════════════════════════════════════════ */

interface ScopeRowProps {
    summary: ScopeSummary;
    choice: TargetChoice | undefined;
    /** What the caller holds this scope on: every target, or only these. */
    reach: "all" | string[];
    /** The targets the panel can list for this scope's kind, or null to type them. */
    options: { value: string; label: string }[] | null;
    draft: string | undefined;
    onToggle: (on: boolean) => void;
    onChoice: (choice: TargetChoice) => void;
    onDraft: (text: string) => void;
    first: boolean;
    t: Translate;
}

function ScopeRow({ summary, choice, reach, options, draft, onToggle, onChoice, onDraft, first, t }: ScopeRowProps) {
    const id = `api-key-scope-${summary.scope.replace(/[^a-z0-9-]/gi, "-")}`;
    const targetKind = summary.target;
    const pickable = reach === "all" ? options : reach.map(value => ({ value, label: value }));
    return (
        <div className={cls("flex flex-col gap-2 px-3 py-2.5", !first && cls("border-t", defaultBorderMixin))}>
            <div className="flex items-start gap-3">
                {/* The kit's checkbox sits in a 32px hit area; pulled up and left so
                    the box lines up with the label's first line and the row's edge. */}
                <div className="-my-1.5 -ml-2 shrink-0">
                    <Checkbox id={id} size="small" checked={!!choice} onCheckedChange={onToggle}/>
                </div>
                <Label htmlFor={id} className="flex-1 min-w-0 cursor-pointer">
                    <Typography variant="body2" component="span" gutterBottom={false} className="block text-[13px] font-medium">
                        {summary.label}
                    </Typography>
                    {summary.description && (
                        <Typography variant="caption" component="span" color="secondary" gutterBottom={false} className="block text-2xs leading-snug font-normal">
                            {summary.description}
                        </Typography>
                    )}
                </Label>
                <Typography variant="caption" color="disabled" gutterBottom={false} className="font-mono text-2xs shrink-0 pt-0.5">
                    {summary.scope}
                </Typography>
            </div>

            {choice && targetKind && (
                <div className="flex flex-wrap items-center gap-2 pl-9">
                    {reach === "all" && (
                        <div className="w-52 shrink-0">
                            <Select
                                size="small"
                                fullWidth
                                position="popper"
                                value={choice.mode}
                                aria-label={t("studio_api_keys_target_mode")}
                                onValueChange={(mode) => onChoice(mode === "all"
                                    ? { mode: "all" }
                                    : { mode: "some", targets: choice.mode === "some" ? choice.targets : [] })}
                                renderValue={(mode) => mode === "all"
                                    ? everyTargetLabel(t, targetKind)
                                    : t("studio_api_keys_target_some")}
                            >
                                <SelectItem value="all">{everyTargetLabel(t, targetKind)}</SelectItem>
                                <SelectItem value="some">{t("studio_api_keys_target_some")}</SelectItem>
                            </Select>
                        </div>
                    )}
                    {choice.mode === "some" && (pickable && pickable.length > 0
                        ? (
                            <div className="flex-1 min-w-[12rem]">
                                <MultiSelect
                                    size="small"
                                    className="w-full"
                                    value={choice.targets}
                                    placeholder={t("studio_api_keys_target_pick")}
                                    onValueChange={(targets) => onChoice({ mode: "some", targets })}
                                >
                                    {pickable.map(option => (
                                        <MultiSelectItem key={option.value} value={option.value}>
                                            {option.label}
                                        </MultiSelectItem>
                                    ))}
                                </MultiSelect>
                            </div>
                        )
                        : (
                            <TextField
                                size="small"
                                className="flex-1 min-w-[12rem]"
                                aria-label={t("studio_api_keys_target_typed_placeholder", { kind: targetKind })}
                                placeholder={t("studio_api_keys_target_typed_placeholder", { kind: targetKind })}
                                value={draft ?? (choice.mode === "some" ? choice.targets.join(", ") : "")}
                                onChange={(e) => {
                                    onDraft(e.target.value);
                                    onChoice({ mode: "some", targets: splitList(e.target.value) });
                                }}
                            />
                        ))}
                </div>
            )}
        </div>
    );
}

/* ═══════════════════════════════════════════════════════════════
   Create API Key Dialog
   ═══════════════════════════════════════════════════════════════ */

export function CreateApiKeyDialog({
                                       kind,
                                       scopeListing,
                                       onRetryScopes,
                                       onClose,
                                       onCreated
                                   }: {
    /** A service key for the project, or a personal key for the signed-in account. */
    kind: ApiKeyKind;
    scopeListing: ScopeListingState;
    onRetryScopes: () => void;
    onClose: () => void;
    onCreated: (key: ApiKeyWithSecret) => void;
}) {
    const client = useRebaseClient<RebaseClient>();
    const { t } = useTranslation();
    const collectionRegistry = useStudioCollectionRegistry();
    const storageSources = useStorageSources();
    const apiConfig = useApiConfig();
    const apiBase = useApiBase();

    const listing = scopeListing.status === "ready" ? scopeListing.listing : null;
    /** Built-in scopes in the panel's language; app scopes as the app declared them. */
    const catalogue = useMemo(() => listing ? localizeScopes(t, listing.scopes) : [], [listing, t]);
    const grantable = useMemo(() => listing ? grantableScopes(catalogue, listing.held) : [], [listing, catalogue]);
    const order = useMemo(() => catalogue.map(summary => summary.scope), [catalogue]);

    const [name, setName] = useState("");
    /** Null until the person changes it: the default follows the catalogue once it arrives. */
    const [chosen, setChosen] = useState<ScopeSelection | null>(null);
    const [drafts, setDrafts] = useState<Record<string, string>>({});
    const [pickedRoles, setPickedRoles] = useState<string[]>([]);
    const [typedRoles, setTypedRoles] = useState("");
    const [roleOptions, setRoleOptions] = useState<RoleSummary[]>([]);
    const [rolesUnavailable, setRolesUnavailable] = useState(false);
    const [rateLimit, setRateLimit] = useState("");
    const [expiry, setExpiry] = useState<ExpiryChoice>("never");
    const [creating, setCreating] = useState(false);
    const [error, setError] = useState<KeyError | null>(null);

    const selection = chosen ?? defaultSelection(grantable);

    /* ── What a target can name, for the scopes that take one ── */

    const collections = useMemo(
        () => (collectionRegistry?.collections ?? [])
            .map(col => col.slug)
            .filter((slug): slug is string => !!slug)
            .sort((a, b) => a.localeCompare(b)),
        [collectionRegistry?.collections]
    );

    const buckets = useMemo(() => {
        const keys = Object.keys(storageSources.sources);
        if (!keys.includes(DEFAULT_STORAGE_SOURCE_KEY)) keys.unshift(DEFAULT_STORAGE_SOURCE_KEY);
        return keys.map(key => ({
            value: key,
            label: storageSources.registry[key]?.label
                ?? (key === DEFAULT_STORAGE_SOURCE_KEY ? t("studio_api_keys_bucket_default") : key)
        }));
    }, [storageSources.sources, storageSources.registry, t]);

    /**
     * Served functions, so a key can be narrowed to one by name. Best-effort:
     * a backend that serves none, or refuses the index, leaves the free-text
     * field — and the server refuses a name it does not serve.
     */
    const [functionNames, setFunctionNames] = useState<string[]>([]);
    useEffect(() => {
        if (!apiBase) return;
        let cancelled = false;
        (async () => {
            try {
                const token = await apiConfig?.getAuthToken?.();
                const res = await fetch(`${apiBase}/functions`, {
                    headers: token ? { Authorization: `Bearer ${token}` } : undefined
                });
                if (!res.ok) return;
                const names = functionNamesFrom(await res.json());
                if (!cancelled) setFunctionNames(names);
            } catch {
                /* No listing available; the free-text field covers it. */
            }
        })();
        return () => { cancelled = true; };
    }, [apiBase, apiConfig]);

    const optionsFor = (summary: ScopeSummary): { value: string; label: string }[] | null => {
        switch (summary.target) {
            case "collection": return collections.map(slug => ({ value: slug, label: slug }));
            case "bucket": return buckets;
            case "function": return functionNames.map(fn => ({ value: fn, label: `${fn}()` }));
            default: return null;
        }
    };

    /* ── Roles a service key runs as ── */

    useEffect(() => {
        if (kind !== "service") return;
        const admin = client?.admin;
        if (!admin) {
            setRolesUnavailable(true);
            return;
        }
        let cancelled = false;
        admin.listRoles()
            .then(res => { if (!cancelled) setRoleOptions(res.roles); })
            .catch(() => { if (!cancelled) setRolesUnavailable(true); });
        return () => { cancelled = true; };
    }, [client, kind]);

    /* ── Picker edits ── */

    const toggle = (summary: ScopeSummary, on: boolean) => {
        setChosen(current => {
            const next: Record<string, TargetChoice> = { ...(current ?? defaultSelection(grantable)) };
            if (!on) {
                delete next[summary.scope];
                return next;
            }
            const reach = listing ? scopeTargets(listing.held, summary.scope) : "all";
            next[summary.scope] = reach === "all" ? { mode: "all" } : { mode: "some", targets: [] };
            return next;
        });
    };

    const setChoice = (scope: string, choice: TargetChoice) => {
        setChosen(current => ({ ...(current ?? defaultSelection(grantable)), [scope]: choice }));
    };

    /* ── What would be sent ── */

    const scopes = buildScopeList(selection, order);
    const incomplete = incompleteScopes(selection);
    const roles = kind === "service" ? combineRoles(pickedRoles, typedRoles) : [];
    const runsAsAdmin = hasAdminRole(roles);
    const granted = groupKeyScopes(scopes, catalogue);
    const labelOf = (scope: string) => catalogue.find(summary => summary.scope === scope)?.label ?? scope;

    const canSubmit = !!listing && !!name.trim() && scopes.length > 0 && incomplete.length === 0 && !creating;
    const submitBlockedReason = !name.trim()
        ? t("studio_api_keys_block_name")
        : scopes.length === 0
            ? t("studio_api_keys_block_scopes")
            : incomplete.length > 0
                ? t("studio_api_keys_block_targets")
                : "";

    const handleCreate = async () => {
        if (!canSubmit || !client) return;
        setCreating(true);
        setError(null);
        try {
            const expires_at = expiresAtFor(expiry);
            const created = kind === "service"
                ? await client.apiKeys?.createKey({
                    name: name.trim(),
                    scopes,
                    roles,
                    rate_limit: rateLimitFrom(rateLimit),
                    expires_at
                })
                : await client.personalKeys?.createKey({ name: name.trim(), scopes, expires_at });
            if (!created) {
                setError({ code: null, message: t("studio_api_keys_unsupported") });
                return;
            }
            onCreated(created.key);
        } catch (e: unknown) {
            setError(readKeyError(e));
        } finally {
            setCreating(false);
        }
    };

    const planes = SCOPE_PLANES
        .map(plane => ({ plane, scopes: grantable.filter(summary => summary.plane === plane) }))
        .filter(group => group.scopes.length > 0);

    return (
        <Dialog open onOpenChange={(open) => { if (!open && !creating) onClose(); }} maxWidth="2xl">

            <DialogTitle variant="subtitle1" gutterBottom={false} className="font-semibold">
                {kind === "service" ? t("studio_api_keys_create_title") : t("studio_api_keys_create_personal_title")}
            </DialogTitle>

            <DialogContent includeMargin={false} className="px-8 pt-2 pb-4 flex flex-col gap-6">

                <Typography variant="body2" color="secondary" gutterBottom={false} className="text-[13px] max-w-[62ch]">
                    {kind === "service" ? t("studio_api_keys_create_intro") : t("studio_api_keys_create_personal_intro")}
                </Typography>

                <TextField
                    label={t("studio_api_keys_field_name")}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t("studio_api_keys_field_name_placeholder")}
                    size="small"
                    autoFocus
                />

                {/* ── Scopes ── */}
                <div>
                    <SectionLabel hint={t("studio_api_keys_section_scopes_hint")}>
                        {t("studio_api_keys_scopes")}
                    </SectionLabel>

                    {scopeListing.status === "loading" && (
                        <div className="flex justify-center py-6"><CircularProgress size="small"/></div>
                    )}

                    {scopeListing.status === "failed" && (
                        <Alert
                            color="error"
                            size="small"
                            action={<Button size="small" variant="text" onClick={onRetryScopes}>{t("retry")}</Button>}
                        >
                            <Typography variant="body2" gutterBottom={false} className="font-medium">
                                {t("studio_api_keys_scopes_read_failed")}
                            </Typography>
                            {scopeListing.message && (
                                <Typography variant="caption" gutterBottom={false} className="block font-mono break-all">
                                    {scopeListing.message}
                                </Typography>
                            )}
                        </Alert>
                    )}

                    {listing && (
                        <div className="flex flex-col gap-4">
                            {planes.map(({ plane, scopes: offered }) => (
                                <div key={plane}>
                                    <div className="flex items-center gap-2 mb-1.5">
                                        <PlaneIcon plane={plane} className="text-surface-500 dark:text-surface-400"/>
                                        <Typography variant="body2" gutterBottom={false} className="text-[13px] font-medium">
                                            {planeLabel(t, plane)}
                                        </Typography>
                                        <Typography variant="caption" color="secondary" gutterBottom={false} className="text-2xs truncate">
                                            {planeHint(t, plane)}
                                        </Typography>
                                    </div>
                                    <div className={cls("rounded-lg border overflow-hidden", defaultBorderMixin)}>
                                        {offered.map((summary, index) => (
                                            <ScopeRow
                                                key={summary.scope}
                                                summary={summary}
                                                choice={selection[summary.scope]}
                                                reach={scopeTargets(listing.held, summary.scope)}
                                                options={optionsFor(summary)}
                                                draft={drafts[summary.scope]}
                                                onToggle={(on) => toggle(summary, on)}
                                                onChoice={(choice) => setChoice(summary.scope, choice)}
                                                onDraft={(text) => setDrafts(current => ({ ...current, [summary.scope]: text }))}
                                                first={index === 0}
                                                t={t}
                                            />
                                        ))}
                                    </div>
                                </div>
                            ))}
                            <Typography variant="caption" color="secondary" gutterBottom={false} className="text-2xs leading-snug max-w-[70ch]">
                                {t("studio_api_keys_scopes_offered_note")}
                            </Typography>
                        </div>
                    )}
                </div>

                {/* ── RLS roles ── */}
                {kind === "service" && (
                    <div>
                        <SectionLabel hint={t("studio_api_keys_roles_rows_hint")}>
                            {t("studio_api_keys_roles")}
                        </SectionLabel>
                        <Typography variant="caption" color="secondary" gutterBottom={false} className="block mb-3 text-2xs leading-snug max-w-[70ch]">
                            {t("studio_api_keys_roles_explainer")}
                        </Typography>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
                            {roleOptions.length > 0 && (
                                <div>
                                    <MultiSelect
                                        size="small"
                                        className="w-full"
                                        label={t("roles")}
                                        value={pickedRoles}
                                        onValueChange={setPickedRoles}
                                    >
                                        {roleOptions.map(role => (
                                            <MultiSelectItem key={role.id} value={role.id}>
                                                {role.name === role.id ? role.id : `${role.name} (${role.id})`}
                                            </MultiSelectItem>
                                        ))}
                                    </MultiSelect>
                                </div>
                            )}
                            <TextField
                                size="small"
                                label={t("studio_api_keys_roles_other")}
                                placeholder={t("studio_api_keys_roles_other_placeholder")}
                                value={typedRoles}
                                onChange={(e) => setTypedRoles(e.target.value)}
                            />
                        </div>
                        {rolesUnavailable && (
                            <Typography variant="caption" color="secondary" gutterBottom={false} className="block mt-1.5 text-2xs">
                                {t("studio_api_keys_roles_unavailable")}
                            </Typography>
                        )}
                        {runsAsAdmin && (
                            <Alert color="warning" size="small" outerClassName="mt-3">
                                {t("studio_api_keys_roles_admin_warning")}
                            </Alert>
                        )}
                    </div>
                )}

                {/* ── Limits ── */}
                <div>
                    <SectionLabel>{t("studio_api_keys_section_limits")}</SectionLabel>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
                        {/* Each control gets its own cell: `Select.Root` renders no DOM
                            node, so an unwrapped Select puts its label and its control
                            into two separate grid items. */}
                        <div>
                            <Select
                                label={t("studio_api_keys_stat_expires")}
                                value={expiry}
                                onValueChange={(value) => { if (isExpiryChoice(value)) setExpiry(value); }}
                                size="small"
                                fullWidth
                                position="popper"
                                renderValue={(value) => expiryLabel(t, isExpiryChoice(value) ? value : "never")}
                            >
                                {EXPIRY_CHOICES.map(choice => (
                                    <SelectItem key={choice} value={choice}>{expiryLabel(t, choice)}</SelectItem>
                                ))}
                            </Select>
                        </div>
                        {kind === "service" && (
                            <div>
                                {/* Labelled above rather than floating inside, so it lines
                                    up with the Select beside it. */}
                                <Label
                                    htmlFor="api-key-rate-limit"
                                    className="block ml-3.5 mb-1 text-text-secondary dark:text-text-secondary-dark"
                                >
                                    {t("studio_api_keys_stat_rate_limit")}
                                </Label>
                                <TextField
                                    id="api-key-rate-limit"
                                    value={rateLimit}
                                    onChange={(e) => setRateLimit(e.target.value.replace(/\D/g, ""))}
                                    placeholder="1000"
                                    size="small"
                                    endAdornment={
                                        <Typography variant="caption" color="secondary" component="span" gutterBottom={false} className="text-2xs whitespace-nowrap">
                                            {t("studio_api_keys_rate_limit_unit")}
                                        </Typography>
                                    }
                                />
                            </div>
                        )}
                    </div>
                    {kind === "service" && (
                        <Typography variant="caption" color="secondary" gutterBottom={false} className="block mt-1.5 text-2xs">
                            {t("studio_api_keys_rate_limit_hint")}
                        </Typography>
                    )}
                </div>

                {/* ── Plain-language read-back of the key being built ── */}
                {listing && (
                    <div className={cls("rounded-lg border px-3 py-2.5 bg-surface-field", defaultBorderMixin)}>
                        <Typography
                            variant="label"
                            gutterBottom={false}
                            className="text-2xs uppercase tracking-wider font-semibold text-surface-600 dark:text-surface-300"
                        >
                            {t("studio_api_keys_summary_title")}
                        </Typography>
                        {granted.length === 0
                            ? (
                                <Typography variant="body2" color="secondary" gutterBottom={false} className="mt-1.5 text-[13px]">
                                    {t("studio_api_keys_summary_empty")}
                                </Typography>
                            )
                            : (
                                <div className="mt-1.5 flex flex-col gap-1">
                                    {granted.flatMap(group => group.scopes.map(held => (
                                        <div key={held.scope} className="flex items-start gap-2">
                                            <PlaneIcon plane={group.plane} className="mt-[3px] shrink-0 text-surface-500 dark:text-surface-400"/>
                                            <Typography variant="body2" gutterBottom={false} className="text-[13px] leading-snug">
                                                {heldScopeLine(t, held)}
                                            </Typography>
                                        </div>
                                    )))}
                                    {kind === "service" && roles.length > 0 && (
                                        <div className="flex items-start gap-2">
                                            <ShieldIcon
                                                size={iconSize.smallest}
                                                className={cls("mt-[3px] shrink-0", runsAsAdmin
                                                    ? "text-amber-600 dark:text-amber-400"
                                                    : "text-surface-500 dark:text-surface-400")}
                                            />
                                            <Typography variant="body2" gutterBottom={false} className="text-[13px] leading-snug">
                                                {t("studio_api_keys_summary_roles", { roles: ["service", ...roles].join(", ") })}
                                            </Typography>
                                        </div>
                                    )}
                                </div>
                            )}
                        {incomplete.length > 0 && (
                            <Typography variant="caption" color="secondary" gutterBottom={false} className="block mt-2 text-2xs">
                                {incomplete.map(scope => t("studio_api_keys_target_missing", { scope: labelOf(scope) })).join(" ")}
                            </Typography>
                        )}
                    </div>
                )}

                {error && (
                    <Alert color="error" size="small">
                        <Typography variant="body2" gutterBottom={false} className="font-medium">
                            {keyErrorTitle(t, error.code)}
                        </Typography>
                        <Typography variant="caption" gutterBottom={false} className="block leading-snug">
                            {error.message}
                        </Typography>
                    </Alert>
                )}

            </DialogContent>

            <DialogActions>
                <Button variant="text" onClick={onClose} disabled={creating}>{t("cancel")}</Button>
                <Tooltip title={submitBlockedReason}>
                    <span>
                        <Button
                            color="primary"
                            onClick={handleCreate}
                            disabled={!canSubmit}
                            startIcon={creating ? <CircularProgress size="smallest"/> : undefined}
                        >
                            {creating ? t("studio_api_keys_creating") : t("studio_api_keys_create")}
                        </Button>
                    </span>
                </Tooltip>
            </DialogActions>
        </Dialog>
    );
}

function expiryLabel(t: Translate, choice: ExpiryChoice): string {
    switch (choice) {
        case "never": return t("studio_api_keys_never");
        case "7d": return t("studio_api_keys_expiry_7d");
        case "30d": return t("studio_api_keys_expiry_30d");
        case "90d": return t("studio_api_keys_expiry_90d");
        case "1y": return t("studio_api_keys_expiry_1y");
    }
}
