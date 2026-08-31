import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
    AlertTriangleIcon,
    BooleanSwitchWithLabel,
    Button,
    ChevronsUpDownIcon,
    CircularProgress,
    cls,
    DatabaseIcon,
    defaultBorderMixin,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    FolderIcon,
    FunctionSquareIcon,
    GlobeIcon,
    iconSize,
    IconButton,
    PlusIcon,
    Select,
    SelectGroup,
    SelectItem,
    ShieldIcon,
    TextField,
    Tooltip,
    Trash2Icon,
    Typography
} from "@rebasepro/ui";
import {
    useApiBase,
    useApiConfig,
    useRebaseClient,
    useSnackbarController,
    useStudioCollectionRegistry
} from "@rebasepro/app";
import type { ApiKeyPermission, ApiKeyWithSecret, RebaseClient } from "@rebasepro/types";

import {
    FUNCTION_PREFIX,
    grantSentence,
    parseResource,
    RESOURCE_ALL_FUNCTIONS,
    RESOURCE_EVERYTHING,
    RESOURCE_STORAGE,
    type ResourceKind
} from "./permissions";

/* ═══════════════════════════════════════════════════════════════
   Row model
   ═══════════════════════════════════════════════════════════════ */

interface PermissionRow {
    /** The raw wire value for `ApiKeyPermission.collection`. */
    resource: string;
    read: boolean;
    write: boolean;
    delete: boolean;
    /**
     * The row edits its resource as free text instead of through the picker.
     * Tracked separately from the value: a slug the panel has not registered
     * is still a legitimate grant, and without this flag the row would snap
     * back to the picker on the next render as soon as it was typed.
     */
    freeText: boolean;
}

const OPERATIONS = ["read", "write", "delete"] as const;
type Operation = (typeof OPERATIONS)[number];

/** What each operation actually permits, per namespace, shown on the toggle. */
const OPERATION_HINT: Record<ResourceKind, Record<Operation, string>> = {
    everything: {
        read: "GET on every resource",
        write: "POST, PUT and PATCH on every resource",
        delete: "DELETE on every resource"
    },
    collection: {
        read: "List and get snapshots",
        write: "Create and update snapshots",
        delete: "Delete snapshots"
    },
    storage: {
        read: "List and download files",
        write: "Upload files and create folders",
        delete: "Delete files"
    },
    "all-functions": {
        read: "Call any function over GET",
        write: "Call any function over POST, PUT or PATCH",
        delete: "Call any function over DELETE"
    },
    function: {
        read: "Call it over GET",
        write: "Call it over POST, PUT or PATCH",
        delete: "Call it over DELETE"
    }
};

/**
 * Picker value that switches a row to free text.
 *
 * Never reaches the wire — choosing it sets `freeText` and clears the resource
 * — so it only has to be a value no collection slug would take.
 */
const SENTINEL_FREE_TEXT = "__custom__";

const rowToPermission = (row: PermissionRow): ApiKeyPermission => ({
    collection: row.resource.trim(),
    operations: OPERATIONS.filter(op => row[op])
});

const rowGrantsNothing = (row: PermissionRow): boolean => {
    const perm = rowToPermission(row);
    return !perm.collection || perm.operations.length === 0;
};

function ResourceIcon({ kind, className }: { kind: ResourceKind; className?: string }) {
    const Component = kind === "everything" ? GlobeIcon
        : kind === "storage" ? FolderIcon
            : kind === "all-functions" || kind === "function" ? FunctionSquareIcon
                : DatabaseIcon;
    return <Component size={iconSize.smallest} className={className}/>;
}

/* ═══════════════════════════════════════════════════════════════
   Operation toggles

   Three states carried by one control each: off is neutral, on is tinted with
   the operation's own semantic colour. The previous version coloured the
   labels whether or not they were checked, so a read-only key still showed a
   red "delete" and the row read as more permissive than it was.
   ═══════════════════════════════════════════════════════════════ */

const OPERATION_STYLES: Record<Operation, { on: string; dot: string }> = {
    read: {
        on: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 ring-emerald-500/40",
        dot: "bg-emerald-500"
    },
    write: {
        on: "bg-blue-500/12 text-blue-700 dark:text-blue-300 ring-blue-500/40",
        dot: "bg-blue-500"
    },
    delete: {
        on: "bg-rose-500/12 text-rose-700 dark:text-rose-300 ring-rose-500/40",
        dot: "bg-rose-500"
    }
};

function OperationToggles({
                              row,
                              onToggle
                          }: {
    row: PermissionRow;
    onToggle: (operation: Operation, value: boolean) => void;
}) {
    const kind = parseResource(row.resource).kind;
    return (
        <div className="flex items-center gap-1" role="group" aria-label="Allowed operations">
            {OPERATIONS.map(op => {
                const active = row[op];
                const styles = OPERATION_STYLES[op];
                return (
                    <Tooltip key={op} title={OPERATION_HINT[kind][op]} delayDuration={400}>
                        <button
                            type="button"
                            aria-pressed={active}
                            onClick={() => onToggle(op, !active)}
                            className={cls(
                                "flex items-center gap-1.5 h-7 pl-2 pr-2.5 rounded-md text-2xs font-medium",
                                "ring-1 transition-colors duration-150 cursor-pointer",
                                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                                active
                                    ? styles.on
                                    : "bg-transparent ring-transparent text-surface-500 dark:text-surface-400 hover:bg-surface-accent-100 dark:hover:bg-surface-800"
                            )}
                        >
                            <span className={cls(
                                "w-1.5 h-1.5 rounded-full transition-colors duration-150",
                                active ? styles.dot : "bg-surface-300 dark:bg-surface-600"
                            )}/>
                            {op}
                        </button>
                    </Tooltip>
                );
            })}
        </div>
    );
}

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

/* ═══════════════════════════════════════════════════════════════
   Create API Key Dialog
   ═══════════════════════════════════════════════════════════════ */

export function CreateApiKeyDialog({
                                       onClose,
                                       onCreated
                                   }: {
    onClose: () => void;
    onCreated: (key: ApiKeyWithSecret) => void;
}) {
    const client = useRebaseClient<RebaseClient>();
    const snackbar = useSnackbarController();
    const collectionRegistry = useStudioCollectionRegistry();
    const apiConfig = useApiConfig();
    const apiBase = useApiBase();

    const [name, setName] = useState("");
    const [rows, setRows] = useState<PermissionRow[]>([
        { resource: RESOURCE_EVERYTHING, read: true, write: false, delete: false, freeText: false }
    ]);
    const [admin, setAdmin] = useState(false);
    const [rateLimit, setRateLimit] = useState("");
    const [expiresIn, setExpiresIn] = useState("never");
    const [creating, setCreating] = useState(false);

    /* The collections the panel already knows — the picker's main list. */
    const collections = useMemo(
        () => (collectionRegistry?.collections ?? [])
            .map(col => ({ slug: col.slug, name: col.name }))
            .filter(col => !!col.slug)
            .sort((a, b) => a.slug.localeCompare(b.slug)),
        [collectionRegistry?.collections]
    );

    /**
     * Deployed functions, so a single-function grant can be picked instead of
     * spelled `functions/<name>` from memory. Best-effort: this is an ordinary
     * API route, and a backend that serves no functions — or refuses the
     * request — just leaves the free-text escape to cover it.
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
                const body = await res.json() as { functions?: { name?: string }[] };
                if (cancelled) return;
                setFunctionNames((body.functions ?? [])
                    .map(fn => fn.name)
                    .filter((fnName): fnName is string => !!fnName));
            } catch {
                /* No listing available; the picker falls back to free text. */
            }
        })();
        return () => { cancelled = true; };
    }, [apiBase, apiConfig]);

    const updateRow = useCallback((idx: number, patch: Partial<PermissionRow>) => {
        setRows(current => current.map((row, i) => i === idx ? { ...row, ...patch } : row));
    }, []);

    const addRow = () => setRows(current => [
        ...current,
        {
            resource: collections[0]?.slug ?? "",
            read: true,
            write: false,
            delete: false,
            freeText: collections.length === 0
        }
    ]);

    const removeRow = (idx: number) => setRows(current => current.filter((_, i) => i !== idx));

    /* What would actually be sent. A row with no operations grants nothing;
       it used to be dropped at submit time with no indication it had been. */
    const effectivePermissions = useMemo(
        () => rows.map(rowToPermission).filter(perm => perm.collection && perm.operations.length > 0),
        [rows]
    );

    const droppedRows = rows.filter(rowGrantsNothing).length;
    const hasWildcard = rows.some(row => row.resource === RESOURCE_EVERYTHING && OPERATIONS.some(op => row[op]));
    const canSubmit = !!name.trim() && effectivePermissions.length > 0 && !creating;

    const handleCreate = async () => {
        if (!client?.apiKeys || !canSubmit) return;

        let expires_at: string | null = null;
        if (expiresIn === "7d") expires_at = new Date(Date.now() + 7 * 86400000).toISOString();
        else if (expiresIn === "30d") expires_at = new Date(Date.now() + 30 * 86400000).toISOString();
        else if (expiresIn === "90d") expires_at = new Date(Date.now() + 90 * 86400000).toISOString();
        else if (expiresIn === "1y") expires_at = new Date(Date.now() + 365 * 86400000).toISOString();

        setCreating(true);
        try {
            const res = await client.apiKeys.createKey({
                name: name.trim(),
                permissions: effectivePermissions,
                admin,
                rate_limit: rateLimit ? parseInt(rateLimit, 10) : null,
                expires_at
            });
            onCreated(res.key);
        } catch (e: unknown) {
            snackbar.open({ type: "error", message: e instanceof Error ? e.message : String(e) });
        } finally {
            setCreating(false);
        }
    };

    const submitBlockedReason = !name.trim()
        ? "Name the key first"
        : effectivePermissions.length === 0
            ? "Grant at least one operation on one resource"
            : "";

    return (
        <Dialog open onOpenChange={(open) => { if (!open && !creating) onClose(); }} maxWidth="2xl">

            <DialogTitle variant="subtitle1" gutterBottom={false} className="font-semibold">
                Create API key
            </DialogTitle>

            <DialogContent includeMargin={false} className="px-8 pt-2 pb-4 flex flex-col gap-6">

                <Typography variant="body2" color="secondary" gutterBottom={false} className="text-[13px] max-w-[62ch]">
                    A credential for scripts, cron jobs and agents. It authenticates as itself rather
                    than as a user, and reaches only what you grant here.
                </Typography>

                <TextField
                    label="Name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Analytics pipeline"
                    size="small"
                    autoFocus
                />

                {/* ── Access ── */}
                <div>
                    <SectionLabel hint="What the key may call">Access</SectionLabel>

                    <div className={cls("rounded-lg border overflow-hidden", defaultBorderMixin)}>
                        {rows.map((row, idx) => {
                            const parsed = parseResource(row.resource);
                            return (
                                <div
                                    key={idx}
                                    role="group"
                                    aria-label={`Resource ${idx + 1}`}
                                    className={cls(
                                        "flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5",
                                        idx > 0 && cls("border-t", defaultBorderMixin)
                                    )}
                                >
                                    <div className="flex items-center gap-2 flex-1 min-w-[15rem]">
                                        <ResourceIcon
                                            kind={parsed.kind}
                                            className={cls(
                                                "shrink-0",
                                                parsed.kind === "everything"
                                                    ? "text-amber-600 dark:text-amber-400"
                                                    : "text-surface-500 dark:text-surface-400"
                                            )}
                                        />
                                        {row.freeText
                                            ? (
                                                <TextField
                                                    size="small"
                                                    aria-label={`Resource ${idx + 1} name`}
                                                    value={row.resource}
                                                    onChange={(e) => updateRow(idx, { resource: e.target.value })}
                                                    placeholder="collection slug, or functions/<name>"
                                                    className="flex-1"
                                                    endAdornment={
                                                        <Tooltip title="Back to the list">
                                                            <IconButton
                                                                size="smallest"
                                                                aria-label="Pick from the list instead"
                                                                onClick={() => updateRow(idx, {
                                                                    resource: collections[0]?.slug ?? RESOURCE_EVERYTHING,
                                                                    freeText: false
                                                                })}
                                                            >
                                                                <ChevronsUpDownIcon size={iconSize.smallest}/>
                                                            </IconButton>
                                                        </Tooltip>
                                                    }
                                                />
                                            )
                                            : (
                                                <Select
                                                    size="small"
                                                    fullWidth
                                                    className="flex-1"
                                                    aria-label={`Resource ${idx + 1}`}
                                                    value={row.resource}
                                                    position="popper"
                                                    onValueChange={(value) => {
                                                        if (value === SENTINEL_FREE_TEXT) {
                                                            updateRow(idx, { freeText: true, resource: "" });
                                                        } else {
                                                            updateRow(idx, { resource: value, freeText: false });
                                                        }
                                                    }}
                                                    renderValue={(value) => (
                                                        <span className="truncate">
                                                            {value === RESOURCE_EVERYTHING ? "Everything"
                                                                : value === RESOURCE_STORAGE ? "Storage"
                                                                    : value === RESOURCE_ALL_FUNCTIONS ? "All functions"
                                                                        : String(value).startsWith(FUNCTION_PREFIX)
                                                                            ? `${String(value).slice(FUNCTION_PREFIX.length)}()`
                                                                            : String(value)}
                                                        </span>
                                                    )}
                                                >
                                                    <SelectItem value={RESOURCE_EVERYTHING}>
                                                        <div className="flex flex-col text-left">
                                                            <span>Everything</span>
                                                            <span className="text-2xs text-text-secondary dark:text-text-secondary-dark">
                                                                Every collection, every function and storage
                                                            </span>
                                                        </div>
                                                    </SelectItem>

                                                    {collections.length > 0 && (
                                                        <SelectGroup label="Collections">
                                                            {collections.map(col => (
                                                                <SelectItem key={col.slug} value={col.slug}>
                                                                    <div className="flex flex-col text-left">
                                                                        <span>{col.slug}</span>
                                                                        {col.name && col.name !== col.slug && (
                                                                            <span className="text-2xs text-text-secondary dark:text-text-secondary-dark">
                                                                                {col.name}
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                </SelectItem>
                                                            ))}
                                                        </SelectGroup>
                                                    )}

                                                    <SelectGroup label="Functions">
                                                        <SelectItem value={RESOURCE_ALL_FUNCTIONS}>All functions</SelectItem>
                                                        {functionNames.map(fnName => (
                                                            <SelectItem key={fnName} value={`${FUNCTION_PREFIX}${fnName}`}>
                                                                {fnName}()
                                                            </SelectItem>
                                                        ))}
                                                    </SelectGroup>

                                                    <SelectGroup label="Storage">
                                                        <SelectItem value={RESOURCE_STORAGE}>Storage</SelectItem>
                                                    </SelectGroup>

                                                    <SelectGroup label="Other">
                                                        <SelectItem value={SENTINEL_FREE_TEXT}>Type a name…</SelectItem>
                                                    </SelectGroup>
                                                </Select>
                                            )}
                                    </div>

                                    <OperationToggles
                                        row={row}
                                        onToggle={(operation, value) => updateRow(idx, { [operation]: value })}
                                    />

                                    <Tooltip title={rows.length > 1 ? "Remove" : "At least one resource is required"}>
                                        <span>
                                            <IconButton
                                                size="small"
                                                disabled={rows.length === 1}
                                                onClick={() => removeRow(idx)}
                                                aria-label={`Remove resource ${idx + 1}`}
                                            >
                                                <Trash2Icon size={iconSize.smallest}/>
                                            </IconButton>
                                        </span>
                                    </Tooltip>
                                </div>
                            );
                        })}
                    </div>

                    <Button
                        size="small"
                        variant="text"
                        onClick={addRow}
                        className="mt-1.5"
                        startIcon={<PlusIcon size={iconSize.smallest}/>}
                    >
                        Add resource
                    </Button>

                    {/* Plain-language read-back of the grant being built. */}
                    <div className={cls(
                        "mt-3 rounded-lg border px-3 py-2.5 bg-surface-accent-50 dark:bg-surface-900",
                        defaultBorderMixin
                    )}>
                        <Typography
                            variant="label"
                            gutterBottom={false}
                            className="text-2xs uppercase tracking-wider font-semibold text-surface-600 dark:text-surface-300"
                        >
                            This key will be able to
                        </Typography>
                        {effectivePermissions.length === 0
                            ? (
                                <Typography
                                    variant="body2"
                                    gutterBottom={false}
                                    className="mt-1.5 text-[13px] text-surface-500 dark:text-surface-400"
                                >
                                    Nothing yet — pick a resource and at least one operation.
                                </Typography>
                            )
                            : (
                                <ul className="mt-1.5 space-y-1">
                                    {effectivePermissions.map((perm, idx) => (
                                        <li key={idx} className="flex items-start gap-2">
                                            <ResourceIcon
                                                kind={parseResource(perm.collection).kind}
                                                className="mt-[3px] shrink-0 text-surface-500 dark:text-surface-400"
                                            />
                                            <Typography variant="body2" gutterBottom={false} className="text-[13px] leading-snug">
                                                {grantSentence(perm)}
                                            </Typography>
                                        </li>
                                    ))}
                                    {admin && (
                                        <li className="flex items-start gap-2">
                                            <ShieldIcon size={iconSize.smallest} className="mt-[3px] shrink-0 text-amber-600 dark:text-amber-400"/>
                                            <Typography variant="body2" gutterBottom={false} className="text-[13px] leading-snug">
                                                Reach every admin route — users, roles, cron, backups, logs — and read
                                                through the <span className="font-mono text-2xs">default_admin</span> policies
                                            </Typography>
                                        </li>
                                    )}
                                </ul>
                            )}
                        {droppedRows > 0 && effectivePermissions.length > 0 && (
                            <Typography
                                variant="caption"
                                gutterBottom={false}
                                className="block mt-2 text-2xs text-surface-500 dark:text-surface-400"
                            >
                                {droppedRows === 1
                                    ? "1 row grants nothing and will not be saved."
                                    : `${droppedRows} rows grant nothing and will not be saved.`}
                            </Typography>
                        )}
                    </div>

                    {hasWildcard && (
                        <div className="flex items-start gap-2 mt-2 px-1">
                            <AlertTriangleIcon size={iconSize.smallest} className="mt-[3px] shrink-0 text-amber-600 dark:text-amber-400"/>
                            <Typography
                                variant="caption"
                                gutterBottom={false}
                                className="text-2xs text-amber-700 dark:text-amber-300 leading-snug max-w-[70ch]"
                            >
                                <span className="font-semibold">Everything</span> is the widest grant there is. It also
                                covers collections and functions you add later, without this key being edited again.
                            </Typography>
                        </div>
                    )}
                </div>

                {/* ── Admin role ── */}
                <div>
                    <SectionLabel hint="Off for almost every key">Admin role</SectionLabel>
                    <div className={cls(
                        "rounded-lg border px-3 py-2.5 transition-colors duration-150",
                        admin ? "border-amber-500/40 bg-amber-500/[0.06]" : defaultBorderMixin
                    )}>
                        <BooleanSwitchWithLabel
                            size="small"
                            position="start"
                            invisible
                            value={admin}
                            onValueChange={setAdmin}
                            label={
                                <div className="flex items-center gap-2">
                                    <ShieldIcon
                                        size={iconSize.smallest}
                                        className={admin
                                            ? "text-amber-600 dark:text-amber-400"
                                            : "text-surface-500 dark:text-surface-400"}
                                    />
                                    <span className="text-[13px]">Grant the admin role</span>
                                </div>
                            }
                        />
                        <Typography
                            variant="caption"
                            color="secondary"
                            gutterBottom={false}
                            className="block mt-1.5 text-2xs leading-snug max-w-[70ch]"
                        >
                            {admin
                                ? "The key passes the admin-gated routes and reads through the default_admin RLS policies — far wider than the resources above. It still cannot manage API keys."
                                : "Without it the key carries only the service role, and RLS grants it nothing unless a collection policy names that role."}
                        </Typography>
                    </div>
                </div>

                {/* ── Limits ── */}
                <div>
                    <SectionLabel>Limits</SectionLabel>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
                        {/* Each control gets its own cell: `Select.Root` renders no DOM
                            node, so an unwrapped Select puts its label and its control
                            into two separate grid items. */}
                        <div>
                            <Select
                                label="Expires"
                                value={expiresIn}
                                onValueChange={setExpiresIn}
                                size="small"
                                fullWidth
                                position="popper"
                                renderValue={(v) =>
                                    v === "never" ? "Never"
                                        : v === "7d" ? "In 7 days"
                                            : v === "30d" ? "In 30 days"
                                                : v === "90d" ? "In 90 days" : "In 1 year"
                                }
                            >
                                <SelectItem value="never">Never</SelectItem>
                                <SelectItem value="7d">In 7 days</SelectItem>
                                <SelectItem value="30d">In 30 days</SelectItem>
                                <SelectItem value="90d">In 90 days</SelectItem>
                                <SelectItem value="1y">In 1 year</SelectItem>
                            </Select>
                        </div>
                        <div>
                            {/* Labelled above rather than floating inside, so it lines
                                up with the Select beside it — a Select can only label
                                above, and the two idioms in one row do not align. */}
                            <label
                                htmlFor="api-key-rate-limit"
                                className="block text-sm font-medium ml-3.5 mb-1 text-text-secondary dark:text-text-secondary-dark"
                            >
                                Rate limit
                            </label>
                            <TextField
                                id="api-key-rate-limit"
                                value={rateLimit}
                                onChange={(e) => setRateLimit(e.target.value.replace(/\D/g, ""))}
                                placeholder="1000"
                                size="small"
                                endAdornment={
                                    <span className="text-2xs text-text-secondary dark:text-text-secondary-dark whitespace-nowrap">
                                        / 15 min
                                    </span>
                                }
                            />
                        </div>
                    </div>
                    <Typography
                        variant="caption"
                        color="secondary"
                        gutterBottom={false}
                        className="block mt-1.5 text-2xs"
                    >
                        Leave the rate limit empty for the server default of 1000 requests per 15-minute window.
                    </Typography>
                </div>

            </DialogContent>

            <DialogActions>
                <Button variant="text" onClick={onClose} disabled={creating}>Cancel</Button>
                <Tooltip title={submitBlockedReason}>
                    <span>
                        <Button
                            color="primary"
                            onClick={handleCreate}
                            disabled={!canSubmit}
                            startIcon={creating ? <CircularProgress size="smallest"/> : undefined}
                        >
                            {creating ? "Creating…" : "Create key"}
                        </Button>
                    </span>
                </Tooltip>
            </DialogActions>
        </Dialog>
    );
}
