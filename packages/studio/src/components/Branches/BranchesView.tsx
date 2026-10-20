
import React, { useState, useEffect, useRef, useCallback } from "react";
import {
    Alert,
    Button,
    Chip,
    CircularProgress,
    cls,
    CopyIcon,
    defaultBorderMixin,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    GitBranchIcon,
    IconButton,
    iconSize,
    Paper,
    PlusIcon,
    RefreshCwIcon,
    Select,
    SelectItem,
    TextField,
    Trash2Icon,
    Typography
} from "@rebasepro/ui";
import { useRebaseContext, useSnackbarController, ConfirmationDialog, useTranslation } from "@rebasepro/app";
import { isBranchAdmin } from "@rebasepro/types";
import type { BranchInfo } from "@rebasepro/types";
import { formatRelativeTime } from "@rebasepro/utils";

import { classifyLoadFailure, type LoadFailure } from "../load-failure";

/**
 * The prefix the driver puts on every branch database.
 *
 * Stated here rather than derived from the row, because `BranchInfo` carries
 * the *name* a person typed and not the database it became — and the detail
 * pane used to print the name under "Database:", which is a connection string
 * to nothing. Kept in step with `BranchService.BRANCH_DB_PREFIX` and the CLI's
 * `branch-pointer.ts`, which say the same thing for the same reason.
 */
const BRANCH_DB_PREFIX = "rb_";
import { LoadFailureView } from "../load-failure-view";

function formatSize(bytes: number | undefined): string {
    if (bytes === undefined || bytes === null) return "—";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatRelative(date: Date | string | undefined): string {
    if (!date) return "—";
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return "—";
    return formatRelativeTime(d) ?? d.toLocaleDateString();
}

export function BranchesView() {
    const { databaseAdmin } = useRebaseContext();
    const snackbar = useSnackbarController();
    const { t } = useTranslation();

    const [branches, setBranches] = useState<BranchInfo[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedBranch, setSelectedBranch] = useState<string | null>(null);

    // Create dialog
    const [createOpen, setCreateOpen] = useState(false);
    const [newBranchName, setNewBranchName] = useState("");
    /**
     * The database to copy, when it is not the main one: a branch's own
     * database, which is not its name.
     */
    const [sourceDatabase, setSourceDatabase] = useState<string | undefined>(undefined);
    const [creating, setCreating] = useState(false);
    /**
     * Why the last create attempt was refused, kept on screen.
     *
     * The server refuses branching outright on the managed development
     * database — PGlite serves one database, so the "branch" would be the
     * parent. That refusal is the whole answer to what the reader just tried to
     * do, and a snackbar is gone in four seconds; the same argument
     * `load-failure.ts` makes for listings.
     */
    const [createError, setCreateError] = useState<string | null>(null);

    // Delete confirm
    const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
    const [deleting, setDeleting] = useState(false);

    /** Why the branch listing failed, classified — see `load-failure.ts`. */
    const [failure, setFailure] = useState<LoadFailure | null>(null);

    // Refs
    const snackbarRef = useRef(snackbar);
    snackbarRef.current = snackbar;

    const branchAdmin = isBranchAdmin(databaseAdmin) ? databaseAdmin : undefined;

    const loadBranches = useCallback(async () => {
        if (!branchAdmin) {
            setLoading(false);
            return;
        }
        try {
            const result = await branchAdmin.listBranches();
            setBranches(result);
            setFailure(null);
        } catch (e: unknown) {
            // "No branches yet. Create one…" over a refused listing invites the
            // reader to create a branch they are not allowed to see, and then
            // hides the one they already have.
            setFailure(classifyLoadFailure(e));
        } finally {
            setLoading(false);
        }
    }, [branchAdmin]);

    useEffect(() => {
        loadBranches();
    }, [loadBranches]);

    const handleCreate = async () => {
        if (!branchAdmin || !newBranchName.trim()) return;
        setCreating(true);
        setCreateError(null);
        try {
            await branchAdmin.createBranch(newBranchName.trim(), sourceDatabase ? { source: sourceDatabase } : undefined);
            snackbarRef.current.open({
                type: "success",
                message: t("studio_branches_created_snackbar", { name: newBranchName.trim() })
            });
            setCreateOpen(false);
            setNewBranchName("");
            setSourceDatabase(undefined);
            await loadBranches();
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            setCreateError(message);
            snackbarRef.current.open({ type: "error",
                message });
        } finally {
            setCreating(false);
        }
    };

    const handleDelete = async () => {
        if (!branchAdmin || !deleteTarget) return;
        setDeleting(true);
        try {
            await branchAdmin.deleteBranch(deleteTarget);
            snackbarRef.current.open({
                type: "success",
                message: t("studio_branches_deleted_snackbar", { name: deleteTarget })
            });
            if (selectedBranch === deleteTarget) setSelectedBranch(null);
            setDeleteTarget(null);
            await loadBranches();
        } catch (e: unknown) {
            snackbarRef.current.open({
                type: "error",
                message: e instanceof Error ? e.message : String(e)
            });
        } finally {
            setDeleting(false);
        }
    };

    // Not supported
    if (!branchAdmin) {
        return (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-center p-8">
                <GitBranchIcon size={iconSize.large} className="text-surface-300 dark:text-surface-600"/>
                <Typography variant="h6" color="secondary">{t("studio_branches_unavailable_title")}</Typography>
                <Typography variant="body2" color="disabled" className="max-w-md">
                    {t("studio_branches_unavailable_body")}
                </Typography>
                <a
                    href="https://rebase.pro/docs/backend/branching"
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary text-sm underline"
                >
                    {t("studio_read_the_docs")}
                </a>
            </div>
        );
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full">
                <CircularProgress/>
            </div>
        );
    }

    const selected = branches.find(b => b.name === selectedBranch);

    return (
        <div className="flex h-full w-full overflow-hidden bg-surface-card">
            {/* ── Branch List ── */}
            <div className={cls("flex flex-col w-[340px] min-w-[280px] border-r h-full", defaultBorderMixin)}>
                <div className={cls("flex items-center justify-between px-4 py-2.5 border-b bg-surface-sheet min-h-[48px]", defaultBorderMixin)}>
                    <div className="flex items-center gap-2">
                        <GitBranchIcon size={iconSize.small} className="text-primary"/>
                        <Typography variant="subtitle2" className="font-semibold">{t("studio_tool_branches")}</Typography>
                        <Chip size="smallest" className="bg-surface-raised text-surface-600 dark:text-surface-300">{branches.length}</Chip>
                    </div>
                    <div className="flex items-center gap-1">
                        <IconButton aria-label={t("refresh")} size="small" onClick={loadBranches} title={t("refresh")}>
                            <RefreshCwIcon size={iconSize.smallest}/>
                        </IconButton>
                        <IconButton aria-label={t("create_branch")} size="small" onClick={() => setCreateOpen(true)} title={t("create_branch")} className="text-primary">
                            <PlusIcon size={iconSize.smallest}/>
                        </IconButton>
                    </div>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-1">
                    {failure ? (
                        <LoadFailureView
                            failure={failure}
                            title={t("studio_branches_read_failed")}
                            deniedTitle={t("studio_branches_denied_title")}
                            deniedHint={t("studio_branches_denied_hint")}
                            onRetry={loadBranches}
                        />
                    ) : branches.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-4">
                            <CopyIcon size={iconSize.small} className="text-surface-300 dark:text-surface-600"/>
                            <Typography variant="body2" color="disabled" className="text-[13px]">
                                {t("studio_branches_empty")}
                            </Typography>
                            <Button
                                size="small"
                                variant="outlined"
                                onClick={() => setCreateOpen(true)}
                                startIcon={<PlusIcon size={iconSize.smallest}/>}
                            >
                                {t("studio_branches_create_action")}
                            </Button>
                        </div>
                    ) : (
                        branches.map(branch => (
                            <div
                                key={branch.name}
                                onClick={() => setSelectedBranch(branch.name)}
                                className={cls(
                                    "flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-all",
                                    selectedBranch === branch.name
                                        ? "bg-primary/10 dark:bg-primary/15 ring-1 ring-primary/30"
                                        : "hover:bg-surface-hover"
                                )}
                            >
                                <div className="w-2 h-2 rounded-full shrink-0 bg-emerald-500"/>
                                <div className="flex-1 min-w-0">
                                    <Typography variant="body2" className="truncate font-medium text-[13px]">{branch.name}</Typography>
                                    <Typography variant="caption" color="secondary" className="truncate text-[11px]">
                                        {t("studio_branches_list_from", { parent: branch.parentDatabase, when: formatRelative(branch.createdAt) })}
                                    </Typography>
                                </div>
                                {branch.sizeBytes !== undefined && (
                                    <Typography variant="caption" color="disabled" className="font-mono text-[10px] shrink-0">
                                        {formatSize(branch.sizeBytes)}
                                    </Typography>
                                )}
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* ── Detail Panel ── */}
            <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
                {!selected ? (
                    <div className="flex flex-col items-center justify-center h-full gap-3">
                        <GitBranchIcon size={iconSize.large} className="text-surface-200 dark:text-surface-700"/>
                        <Typography variant="body2" color="disabled">
                            {branches.length === 0 ? t("studio_branches_empty_detail") : t("studio_branches_select_prompt")}
                        </Typography>
                    </div>
                ) : (
                    <>
                        {/* Header */}
                        <div className={cls("flex items-center justify-between px-5 py-3 border-b bg-surface-card min-h-[56px]", defaultBorderMixin)}>
                            <div className="flex items-center gap-3 min-w-0">
                                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500"/>
                                <div className="min-w-0">
                                    <Typography variant="subtitle1" className="font-semibold truncate">{selected.name}</Typography>
                                    <Typography variant="caption" color="secondary" className="truncate">
                                        {t("studio_branches_created_from")} <Typography variant="mono" component="span" className="text-[11px]">{selected.parentDatabase}</Typography>
                                    </Typography>
                                </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                                <Button
                                    size="small"
                                    color="error"
                                    variant="outlined"
                                    onClick={() => setDeleteTarget(selected.name)}
                                    startIcon={<Trash2Icon size={iconSize.smallest}/>}
                                >
                                    {t("delete")}
                                </Button>
                            </div>
                        </div>

                        {/* Info Cards */}
                        <div className="px-5 py-4 bg-surface-sheet">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                <StatCard label={t("studio_branches_branch_name")} value={selected.name} mono/>
                                <StatCard label={t("studio_branches_source_database")} value={selected.parentDatabase} mono/>
                                <StatCard label={t("studio_branches_created")} value={formatRelative(selected.createdAt)}/>
                                <StatCard label={t("studio_branches_size")} value={formatSize(selected.sizeBytes)}/>
                            </div>
                        </div>

                        {/* Usage Info */}
                        <div className="flex-1 overflow-y-auto px-5 py-4">
                            <Alert color="info">
                                <div className="space-y-1.5">
                                    <Typography variant="body2" className="text-[13px] font-medium">
                                        {t("studio_branches_usage_title")}
                                    </Typography>
                                    <Typography variant="body2" className="text-[13px]">
                                        {t("studio_branches_usage_switch")}
                                    </Typography>
                                    <UsageCommand command={`rebase db branch switch ${selected.name}`}/>
                                    <Typography variant="body2" className="text-[13px]">
                                        {t("studio_branches_usage_off")}
                                    </Typography>
                                    <UsageCommand command="rebase db branch switch --off"/>
                                    <Typography variant="body2" className="text-[13px]">
                                        {t("studio_branches_usage_isolated")}
                                    </Typography>
                                </div>
                            </Alert>
                            <div className="mt-4 p-4 rounded-lg border bg-surface-sheet border-hairline-strong">
                                <Typography variant="caption" className="text-[10px] uppercase tracking-wider text-surface-400 mb-2 block font-medium">{t("studio_branches_connection_details")}</Typography>
                                <div className="space-y-2">
                                    <div className="flex items-center gap-2">
                                        {/* The *database*, not the branch name. They are not the
                                            same string — the driver prefixes every branch database
                                            with `rb_` — and a connection string built from the name
                                            on this pane pointed at a database that does not
                                            exist. */}
                                        <Typography variant="caption" color="secondary" className="w-24 shrink-0 text-[11px]">{t("studio_branches_row_database")}</Typography>
                                        <Typography variant="body2" className="font-mono text-[12px]">{`${BRANCH_DB_PREFIX}${selected.name}`}</Typography>
                                    </div>
                                    <div className="flex items-start gap-2">
                                        <Typography variant="caption" color="secondary" className="w-24 shrink-0 text-[11px]">{t("studio_branches_row_connect")}</Typography>
                                        <Typography variant="body2" className="font-mono text-[12px] break-all">
                                            {`DATABASE_URL=…/${BRANCH_DB_PREFIX}${selected.name}`}
                                        </Typography>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Typography variant="caption" color="secondary" className="w-24 shrink-0 text-[11px]">{t("studio_branches_row_branched_from")}</Typography>
                                        <Typography variant="body2" className="font-mono text-[12px]">{selected.parentDatabase}</Typography>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Typography variant="caption" color="secondary" className="w-24 shrink-0 text-[11px]">{t("studio_branches_row_created_at")}</Typography>
                                        <Typography variant="body2" className="font-mono text-[12px]">
                                            {selected.createdAt instanceof Date
                                                ? selected.createdAt.toLocaleString()
                                                : new Date(selected.createdAt).toLocaleString()}
                                        </Typography>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </>
                )}
            </div>

            {/* ── Create Dialog ── */}
            <Dialog open={createOpen} onOpenChange={(open) => {
                setCreateOpen(open);
                if (!open) setCreateError(null);
            }}>
                <DialogTitle>{t("studio_branches_create_title")}</DialogTitle>
                <DialogContent className="space-y-4 min-w-[400px]">
                    <Typography variant="body2" color="secondary" className="text-[13px]">
                        {t("studio_branches_create_body")}
                    </Typography>
                    {createError && (
                        <Alert color="error">
                            <Typography variant="body2" className="text-[13px]">{createError}</Typography>
                        </Alert>
                    )}
                    <div>
                        <TextField
                            label={t("studio_branches_branch_name")}
                            value={newBranchName}
                            onChange={(e) => setNewBranchName(e.target.value)}
                            placeholder={t("studio_branches_name_placeholder")}
                            size="small"
                            autoFocus
                        />
                    </div>
                    {branches.length > 0 && (
                        <div>
                            <Select
                                label={t("studio_branches_source_database")}
                                value={sourceDatabase ?? "__main__"}
                                onValueChange={(v) => setSourceDatabase(v === "__main__" ? undefined : v)}
                                placeholder={t("studio_branches_source_main")}
                                size="small"
                            >
                                <SelectItem value="__main__">{t("studio_branches_source_main")}</SelectItem>
                                {branches.map(b => (
                                    <SelectItem key={b.name} value={b.database}>{b.name}</SelectItem>
                                ))}
                            </Select>
                        </div>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button variant="text" onClick={() => setCreateOpen(false)} disabled={creating}>
                        {t("cancel")}
                    </Button>
                    <Button
                        color="primary"
                        onClick={handleCreate}
                        disabled={!newBranchName.trim() || creating}
                        startIcon={creating ? <CircularProgress size="smallest"/> : <PlusIcon size={iconSize.smallest}/>}
                    >
                        {creating ? t("studio_branches_creating") : t("studio_branches_create_action")}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* ── Delete Confirm ── */}
            <ConfirmationDialog
                open={!!deleteTarget}
                onAccept={handleDelete}
                onCancel={() => setDeleteTarget(null)}
                title={t("studio_branches_delete_title")}
                body={
                    <Typography variant="body2">
                        {t("studio_branches_delete_body", { name: deleteTarget ?? "" })}
                    </Typography>
                }
                loading={deleting}
            />
        </div>
    );
}

/** A command the usage alert tells the reader to run, set apart from the prose. */
function UsageCommand({ command }: { command: string }) {
    return (
        <Typography
            variant="mono"
            component="div"
            className="px-2 py-1 rounded bg-surface-well text-[12px] break-all"
        >
            {command}
        </Typography>
    );
}

function StatCard({ label, value, mono }: {
    label: string; value: string; mono?: boolean;
}) {
    return (
        <div className={cls("px-3 py-2 rounded-lg border bg-surface-card", defaultBorderMixin)}>
            <Typography variant="caption" color="secondary" className="text-[10px] uppercase tracking-wider font-medium">{label}</Typography>
            <Typography variant="body2" className={cls(
                "mt-0.5 font-semibold text-[13px] truncate",
                mono && "font-mono"
            )}>{value}</Typography>
        </div>
    );
}
