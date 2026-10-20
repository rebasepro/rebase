import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    Alert,
    Button,
    Checkbox,
    Chip,
    CircularProgress,
    cls,
    defaultBorderMixin,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    GitMergeIcon,
    IconButton,
    iconSize,
    Label,
    RadioGroup,
    RadioGroupItem,
    RefreshCwIcon,
    Tab,
    Table,
    TableBody,
    TableCell,
    TableHeader,
    TableRow,
    Tabs,
    Typography
} from "@rebasepro/ui";
import type { ChipColorKey } from "@rebasepro/ui";
import { useApiBase, useApiConfig, useSnackbarController, useTranslation } from "@rebasepro/app";
import type { BranchDiff, BranchInfo, BranchMergeResult, BranchRowChange, BranchSchemaChange, BranchTableDataDiff } from "@rebasepro/types";

import { classifyLoadFailure, type LoadFailure } from "../load-failure";
import { LoadFailureView } from "../load-failure-view";
import { splitLineDiff } from "./split-line-diff";

/**
 * What a database branch changed, the way a pull request shows it — and the
 * merge, behind a dialog that says what wins before anything is written.
 *
 * The diff is the server's (`GET /api/admin/branches/:name/diff`), computed
 * against the database the branch was made from: schema and RLS policies as
 * SQL, side by side, and the rows the branch inserted, updated and deleted.
 * Rows that database changed on its own since are counted apart and never
 * offered as the branch's.
 *
 * The merge (`POST …/merge`) sends back the fingerprint of the diff on screen,
 * so a merge after either side moved writes nothing, and the pane reloads the
 * diff instead of applying one nobody reviewed.
 */

type DiffTab = "schema" | "data" | "details";
type ConflictRule = "abort" | "branch" | "target";

/** A refusal from the review routes, with the status `classifyLoadFailure` reads. */
class BranchReviewError extends Error {
    constructor(message: string, readonly status: number, readonly code: string | undefined) {
        super(message);
        this.name = "BranchReviewError";
    }
}

function isBranchDiff(value: unknown): value is BranchDiff {
    return typeof value === "object" && value !== null
        && "fingerprint" in value && typeof value.fingerprint === "string"
        && "schema" in value && Array.isArray(value.schema)
        && "data" in value && Array.isArray(value.data);
}

function isMergeResult(value: unknown): value is BranchMergeResult {
    return typeof value === "object" && value !== null
        && "tables" in value && Array.isArray(value.tables)
        && "targetDatabase" in value && typeof value.targetDatabase === "string";
}

async function requestJson(url: string, init: RequestInit, token: string | null): Promise<unknown> {
    const response = await fetch(url, {
        ...init,
        headers: {
            ...(init.body ? { "Content-Type": "application/json" } : {}),
            ...(token ? { Authorization: `Bearer ${token}` } : {})
        }
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
        const error = typeof body === "object" && body !== null && "error" in body
            && typeof body.error === "object" && body.error !== null ? body.error : null;
        const message = error && "message" in error && typeof error.message === "string" ? error.message : `HTTP ${response.status}`;
        const code = error && "code" in error && typeof error.code === "string" ? error.code : undefined;
        throw new BranchReviewError(message, response.status, code);
    }
    return body;
}

const CHANGE_COLOR: Record<BranchSchemaChange["change"], ChipColorKey> = { added: "green", dropped: "red", altered: "yellow" };
const ROW_COLOR: Record<BranchRowChange["change"], ChipColorKey> = { inserted: "green", updated: "yellow", deleted: "red", conflict: "orange" };

export interface BranchDiffViewProps {
    branch: BranchInfo;
    /** The branch's connection details: the third tab. */
    details: React.ReactNode;
    /** Called once a merge has written to the target. */
    onMerged?: () => void;
}

export function BranchDiffView({ branch, details, onMerged }: BranchDiffViewProps) {
    const { t } = useTranslation();
    const apiBase = useApiBase();
    const apiConfig = useApiConfig();
    const snackbar = useSnackbarController();
    const snackbarRef = useRef(snackbar);
    snackbarRef.current = snackbar;

    const [tab, setTab] = useState<DiffTab>("schema");
    const [diff, setDiff] = useState<BranchDiff | null>(null);
    const [loading, setLoading] = useState(true);
    const [failure, setFailure] = useState<LoadFailure | null>(null);
    const [mergeOpen, setMergeOpen] = useState(false);

    // Read through refs: the load below must run when the branch changes, not
    // whenever a context hands back a new object or function.
    const apiConfigRef = useRef(apiConfig);
    apiConfigRef.current = apiConfig;
    const tRef = useRef(t);
    tRef.current = t;
    const token = useCallback(async () => {
        const config = apiConfigRef.current;
        return config?.getAuthToken ? await config.getAuthToken() : null;
    }, []);

    const load = useCallback(async () => {
        if (!apiBase) {
            // Nothing to ask: say so rather than spin.
            setLoading(false);
            setFailure(classifyLoadFailure(new Error(tRef.current("studio_branch_diff_no_api"))));
            return;
        }
        setLoading(true);
        try {
            const body = await requestJson(`${apiBase}/admin/branches/${encodeURIComponent(branch.name)}/diff`, { method: "GET" }, await token());
            if (!isBranchDiff(body)) throw new Error(tRef.current("studio_branch_diff_unreadable"));
            setDiff(body);
            setFailure(null);
        } catch (e: unknown) {
            setDiff(null);
            setFailure(classifyLoadFailure(e));
        } finally {
            setLoading(false);
        }
    }, [apiBase, branch.name, token]);

    useEffect(() => {
        setDiff(null);
        void load();
    }, [load]);

    const branchChanges = diff?.data.filter((entry) => entry.inserted + entry.updated + entry.deleted + entry.conflicts > 0) ?? [];
    const canMerge = branchChanges.some((entry) => !entry.blocked);

    return (
        <div className="flex flex-col flex-1 min-h-0">
            <div className="flex items-end justify-between gap-3 px-5 pt-3">
                <Tabs value={tab} onValueChange={(value) => setTab(value === "data" || value === "details" ? value : "schema")} variant="boxy" className="border-b border-hairline flex-1 min-w-0">
                    <Tab value="schema" innerClassName="flex items-center gap-1.5">
                        {t("studio_branch_diff_tab_schema")}
                        {diff && diff.schema.length > 0 && <Chip size="smallest">{diff.schema.length}</Chip>}
                    </Tab>
                    <Tab value="data" innerClassName="flex items-center gap-1.5">
                        {t("studio_branch_diff_tab_data")}
                        {diff && diff.data.length > 0 && <Chip size="smallest">{diff.data.length}</Chip>}
                    </Tab>
                    <Tab value="details">{t("studio_branch_diff_tab_details")}</Tab>
                </Tabs>
                <div className="flex items-center gap-2 pb-1.5 shrink-0">
                    <IconButton aria-label={t("refresh")} title={t("refresh")} size="small" onClick={() => void load()} disabled={loading}>
                        <RefreshCwIcon size={iconSize.smallest}/>
                    </IconButton>
                    <Button
                        size="small"
                        color="primary"
                        disabled={!diff || !canMerge || loading}
                        onClick={() => setMergeOpen(true)}
                        startIcon={<GitMergeIcon size={iconSize.smallest}/>}
                    >
                        {t("studio_branch_diff_merge", { target: branch.parentDatabase })}
                    </Button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
                {tab === "details" ? details : loading && !diff ? (
                    <div className="flex items-center justify-center h-full"><CircularProgress/></div>
                ) : failure ? (
                    <LoadFailureView
                        failure={failure}
                        title={t("studio_branch_diff_failed")}
                        deniedTitle={t("studio_branch_diff_denied_title")}
                        deniedHint={t("studio_branch_diff_denied_hint")}
                        onRetry={() => void load()}
                    />
                ) : diff ? (
                    <div className="space-y-4">
                        {!diff.forkPointKnown && (
                            <Alert color="warning">
                                <Typography variant="body2">{t("studio_branch_diff_fork_unknown", { target: diff.targetDatabase })}</Typography>
                            </Alert>
                        )}
                        {tab === "schema"
                            ? <SchemaChanges diff={diff}/>
                            : <DataChanges diff={diff}/>}
                    </div>
                ) : null}
            </div>

            {diff && (
                <MergeDialog
                    open={mergeOpen}
                    diff={diff}
                    onClose={() => setMergeOpen(false)}
                    merge={async (rule, skipBlocked) => {
                        if (!apiBase) return;
                        try {
                            const body = await requestJson(
                                `${apiBase}/admin/branches/${encodeURIComponent(branch.name)}/merge`,
                                { method: "POST", body: JSON.stringify({ expectedFingerprint: diff.fingerprint, onConflict: rule, skipBlocked }) },
                                await token()
                            );
                            if (!isMergeResult(body)) throw new Error(t("studio_branch_diff_unreadable"));
                            const rows = body.tables.reduce((sum, table) => sum + table.inserted + table.updated + table.deleted, 0);
                            snackbarRef.current.open({ type: "success", message: t("studio_branch_diff_merged", { count: rows, target: body.targetDatabase }) });
                            for (const warning of body.warnings) snackbarRef.current.open({ type: "warning", message: warning });
                            setMergeOpen(false);
                            onMerged?.();
                            await load();
                        } catch (e: unknown) {
                            // A diff that went stale is answered by showing the
                            // one that is true now, not by asking to merge again.
                            if (e instanceof BranchReviewError && e.code === "BRANCH_DIFF_STALE") {
                                snackbarRef.current.open({ type: "warning", message: e.message });
                                setMergeOpen(false);
                                await load();
                                return;
                            }
                            throw e;
                        }
                    }}
                />
            )}
        </div>
    );
}

// ── Schema & RLS ─────────────────────────────────────────────────────────────

function SchemaChanges({ diff }: { diff: BranchDiff }) {
    const { t } = useTranslation();
    if (diff.schema.length === 0) {
        return <EmptyState text={t("studio_branch_diff_schema_empty", { target: diff.targetDatabase })}/>;
    }
    const objectLabel: Record<BranchSchemaChange["object"], string> = {
        table: t("studio_branch_diff_object_table"),
        column: t("studio_branch_diff_object_column"),
        policy: t("studio_branch_diff_object_policy"),
        rls: t("studio_branch_diff_object_rls")
    };
    const changeLabel: Record<BranchSchemaChange["change"], string> = {
        added: t("studio_branch_diff_change_added"),
        dropped: t("studio_branch_diff_change_dropped"),
        altered: t("studio_branch_diff_change_altered")
    };
    return (
        <div className="space-y-3">
            <Typography variant="body2" color="secondary">{t("studio_branch_diff_schema_not_merged")}</Typography>
            {diff.schema.map((change, index) => (
                <div key={index} className={cls("rounded-xl border bg-surface-card overflow-hidden", defaultBorderMixin)}>
                    <div className="flex items-center gap-2 px-3 py-2 min-w-0">
                        <Chip size="smallest" colorScheme={CHANGE_COLOR[change.change]}>{changeLabel[change.change]}</Chip>
                        <Typography variant="caption" color="secondary" className="shrink-0">{objectLabel[change.object]}</Typography>
                        <Typography variant="body2" className="font-mono text-[12px] truncate">
                            {`${change.schema}.${change.table}${change.name ? `.${change.name}` : ""}`}
                        </Typography>
                    </div>
                    <SplitDiff before={change.before} after={change.after} targetLabel={diff.targetDatabase} branchLabel={diff.branchDatabase}/>
                </div>
            ))}
        </div>
    );
}

function SplitDiff({ before, after, targetLabel, branchLabel }: { before?: string; after?: string; targetLabel: string; branchLabel: string }) {
    const rows = useMemo(() => splitLineDiff(before, after), [before, after]);
    const line = "font-mono text-[12px] leading-5 whitespace-pre-wrap break-all px-3 min-h-5";
    return (
        <div className={cls("grid grid-cols-2 border-t", defaultBorderMixin)}>
            <Typography variant="caption" color="secondary" className={cls("px-3 py-1 border-b border-r font-mono", defaultBorderMixin)}>{targetLabel}</Typography>
            <Typography variant="caption" color="secondary" className={cls("px-3 py-1 border-b font-mono", defaultBorderMixin)}>{branchLabel}</Typography>
            {rows.map((row, index) => (
                <React.Fragment key={index}>
                    <Typography component="div" variant="body2" className={cls(line, "border-r", defaultBorderMixin,
                        row.left === null ? "bg-surface-field" : !row.same && "bg-red-500/10 text-red-700 dark:text-red-300")}>
                        {row.left ?? ""}
                    </Typography>
                    <Typography component="div" variant="body2" className={cls(line,
                        row.right === null ? "bg-surface-field" : !row.same && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300")}>
                        {row.right ?? ""}
                    </Typography>
                </React.Fragment>
            ))}
        </div>
    );
}

// ── Data ─────────────────────────────────────────────────────────────────────

function DataChanges({ diff }: { diff: BranchDiff }) {
    const { t } = useTranslation();
    if (diff.data.length === 0) {
        return <EmptyState text={t("studio_branch_diff_data_empty", { target: diff.targetDatabase })}/>;
    }
    return (
        <div className="space-y-5">
            {diff.data.map((entry) => <TableChanges key={`${entry.schema}.${entry.table}`} entry={entry} target={diff.targetDatabase}/>)}
        </div>
    );
}

function TableChanges({ entry, target }: { entry: BranchTableDataDiff; target: string }) {
    const { t } = useTranslation();
    const rowLabel: Record<BranchRowChange["change"], string> = {
        inserted: t("studio_branch_diff_row_inserted"),
        updated: t("studio_branch_diff_row_updated"),
        deleted: t("studio_branch_diff_row_deleted"),
        conflict: t("studio_branch_diff_row_conflict")
    };
    const total = entry.inserted + entry.updated + entry.deleted + entry.conflicts;
    return (
        <section className="space-y-2">
            <div className="flex flex-wrap items-center gap-2 min-w-0">
                <Typography variant="subtitle2" className="font-mono truncate">{`${entry.schema}.${entry.table}`}</Typography>
                {entry.collection && <Chip size="smallest">{entry.collection}</Chip>}
                {entry.inserted > 0 && <Chip size="smallest" colorScheme="green">{`+${entry.inserted} ${rowLabel.inserted}`}</Chip>}
                {entry.updated > 0 && <Chip size="smallest" colorScheme="yellow">{`~${entry.updated} ${rowLabel.updated}`}</Chip>}
                {entry.deleted > 0 && <Chip size="smallest" colorScheme="red">{`−${entry.deleted} ${rowLabel.deleted}`}</Chip>}
                {entry.conflicts > 0 && <Chip size="smallest" colorScheme="orange">{t("studio_branch_diff_conflicts", { count: entry.conflicts })}</Chip>}
            </div>
            {entry.targetChanges > 0 && (
                <Typography variant="caption" color="secondary" className="block">
                    {t("studio_branch_diff_target_changes", { count: entry.targetChanges, target })}
                </Typography>
            )}
            {entry.blocked && (
                <Alert color="warning">
                    <Typography variant="body2">{entry.blocked.message}</Typography>
                    {entry.rowCounts && (
                        <Typography variant="caption" color="secondary" className="block mt-1">
                            {t("studio_branch_diff_row_counts", { target, targetCount: entry.rowCounts.target, branchCount: entry.rowCounts.branch })}
                        </Typography>
                    )}
                </Alert>
            )}
            {entry.samples.length > 0 && (
                <div className={cls("rounded-xl border overflow-hidden", defaultBorderMixin)}>
                    <Table className="w-full">
                        <TableHeader>
                            <TableCell header className="w-28">{t("studio_branch_diff_column_change")}</TableCell>
                            <TableCell header className="w-32">{t("studio_branch_diff_column_key")}</TableCell>
                            <TableCell header>{t("studio_branch_diff_column_values")}</TableCell>
                        </TableHeader>
                        <TableBody>
                            {entry.samples.map((sample) => (
                                <TableRow key={`${sample.change}:${sample.key}`}>
                                    <TableCell><Chip size="smallest" colorScheme={ROW_COLOR[sample.change]}>{rowLabel[sample.change]}</Chip></TableCell>
                                    <TableCell><Typography variant="body2" className="font-mono text-[12px] break-all">{keyText(sample.key)}</Typography></TableCell>
                                    <TableCell><RowValues sample={sample}/></TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            )}
            {total > entry.samples.length && entry.samples.length > 0 && (
                <Typography variant="caption" color="disabled" className="block">
                    {t("studio_branch_diff_samples_shown", { shown: entry.samples.length, total })}
                </Typography>
            )}
        </section>
    );
}

/** `[42]` → `42`; a composite key keeps its commas. */
function keyText(key: string): string {
    return key.startsWith("[") && key.endsWith("]") ? key.slice(1, -1) : key;
}

const VALUES_SHOWN = 8;

function RowValues({ sample }: { sample: BranchRowChange }) {
    const mono = "font-mono text-[12px] break-all";
    if (sample.change === "updated" || sample.change === "conflict") {
        return (
            <div className="space-y-0.5">
                {(sample.changedColumns ?? []).map((column) => (
                    <Typography key={column} variant="body2" className={mono}>
                        <span className="text-text-secondary dark:text-text-secondary-dark">{column}: </span>
                        <span className="bg-red-500/10 text-red-700 dark:text-red-300 rounded-md px-1">{display(sample.before?.[column])}</span>
                        {" → "}
                        <span className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 rounded-md px-1">{display(sample.after?.[column])}</span>
                    </Typography>
                ))}
            </div>
        );
    }
    const values = Object.entries((sample.change === "inserted" ? sample.after : sample.before) ?? {});
    return (
        <Typography variant="body2" className={cls(mono, "text-text-secondary dark:text-text-secondary-dark")}>
            {values.slice(0, VALUES_SHOWN).map(([column, value]) => `${column}=${display(value)}`).join("  ")}
            {values.length > VALUES_SHOWN ? "  …" : ""}
        </Typography>
    );
}

function display(value: string | null | undefined): string {
    if (value === null || value === undefined) return "NULL";
    return value.length > 80 ? `${value.slice(0, 80)}…` : value;
}

function EmptyState({ text }: { text: string }) {
    return (
        <div className="flex items-center justify-center py-16">
            <Typography variant="body2" color="disabled">{text}</Typography>
        </div>
    );
}

// ── Merge ────────────────────────────────────────────────────────────────────

function MergeDialog({ open, diff, onClose, merge }: {
    open: boolean;
    diff: BranchDiff;
    onClose: () => void;
    merge: (rule: ConflictRule, skipBlocked: boolean) => Promise<void>;
}) {
    const { t } = useTranslation();
    const [rule, setRule] = useState<ConflictRule>("abort");
    const [skipBlocked, setSkipBlocked] = useState(false);
    const [merging, setMerging] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!open) return;
        setRule("abort");
        setSkipBlocked(false);
        setError(null);
    }, [open, diff.fingerprint]);

    const mergeable = diff.data.filter((entry) => !entry.blocked);
    const blocked = diff.data.filter((entry) => entry.blocked && entry.inserted + entry.updated + entry.deleted + entry.conflicts > 0);
    const sum = (key: "inserted" | "updated" | "deleted" | "conflicts" | "targetChanges") =>
        mergeable.reduce((total, entry) => total + entry[key], 0);
    const conflicts = sum("conflicts");
    const targetChanges = sum("targetChanges");
    const target = diff.targetDatabase;
    const ready = (conflicts === 0 || rule !== "abort") && (blocked.length === 0 || skipBlocked);

    return (
        <Dialog open={open} onOpenChange={(next) => { if (!next && !merging) onClose(); }}>
            <DialogTitle>{t("studio_branch_diff_merge_title", { branch: diff.branch, target })}</DialogTitle>
            <DialogContent className="space-y-4 min-w-[420px] max-w-[560px]">
                <Typography variant="body2">
                    {t("studio_branch_diff_merge_writes", { inserted: sum("inserted"), updated: sum("updated"), deleted: sum("deleted"), target })}
                </Typography>
                <Typography variant="body2" color="secondary">
                    {targetChanges > 0
                        ? t("studio_branch_diff_merge_target_kept_count", { count: targetChanges, target })
                        : t("studio_branch_diff_merge_target_kept", { target })}
                </Typography>
                {diff.schema.length > 0 && (
                    <Typography variant="body2" color="secondary">{t("studio_branch_diff_merge_schema_skipped", { count: diff.schema.length })}</Typography>
                )}
                {conflicts > 0 && (
                    <div className="space-y-2">
                        <Typography variant="body2" className="font-medium">{t("studio_branch_diff_merge_conflicts", { count: conflicts })}</Typography>
                        <RadioGroup value={rule} onValueChange={(value) => setRule(value === "branch" || value === "target" ? value : "abort")}>
                            {([
                                ["abort", t("studio_branch_diff_conflict_abort")],
                                ["branch", t("studio_branch_diff_conflict_branch", { branch: diff.branch })],
                                ["target", t("studio_branch_diff_conflict_target", { target })]
                            ] as const).map(([value, label]) => (
                                <div key={value} className="flex items-center gap-2">
                                    <RadioGroupItem id={`merge-conflict-${value}`} value={value}/>
                                    <Label htmlFor={`merge-conflict-${value}`}>{label}</Label>
                                </div>
                            ))}
                        </RadioGroup>
                    </div>
                )}
                {blocked.length > 0 && (
                    <Alert color="warning">
                        <Typography variant="body2">{t("studio_branch_diff_merge_blocked", { count: blocked.length })}</Typography>
                        <div className="mt-1 space-y-0.5">
                            {blocked.map((entry) => (
                                <Typography key={`${entry.schema}.${entry.table}`} variant="caption" className="block">
                                    <span className="font-mono">{`${entry.schema}.${entry.table}`}</span>
                                    {` — ${entry.blocked?.message ?? ""}`}
                                </Typography>
                            ))}
                        </div>
                        <div className="flex items-center gap-2 mt-2">
                            <Checkbox id="merge-skip-blocked" checked={skipBlocked} onCheckedChange={setSkipBlocked} size="small"/>
                            <Label htmlFor="merge-skip-blocked">{t("studio_branch_diff_merge_skip_blocked")}</Label>
                        </div>
                    </Alert>
                )}
                <Typography variant="caption" color="secondary" className="block">{t("studio_branch_diff_merge_atomic", { target })}</Typography>
                {error && (
                    <Alert color="error"><Typography variant="body2">{error}</Typography></Alert>
                )}
            </DialogContent>
            <DialogActions>
                <Button variant="text" onClick={onClose} disabled={merging}>{t("cancel")}</Button>
                <Button
                    color="primary"
                    disabled={!ready || merging}
                    startIcon={merging ? <CircularProgress size="smallest"/> : <GitMergeIcon size={iconSize.smallest}/>}
                    onClick={async () => {
                        setMerging(true);
                        setError(null);
                        try {
                            await merge(rule, skipBlocked);
                        } catch (e: unknown) {
                            setError(e instanceof Error ? e.message : String(e));
                        } finally {
                            setMerging(false);
                        }
                    }}
                >
                    {t("studio_branch_diff_merge_confirm")}
                </Button>
            </DialogActions>
        </Dialog>
    );
}
