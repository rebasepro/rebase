import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    Button,
    Checkbox,
    Chip,
    CircularProgress,
    cls,
    TextField,
    Tooltip,
    Typography
} from "@rebasepro/ui";
import { useSnackbarController } from "@rebasepro/app";
import type { ReviewConfig, StagedChange, StagedChangeOperation, StagedTableReview, StateFieldReview } from "../config/types";
import { useReviewApi, type ReviewApi, type ReviewRow } from "../hooks/useReviewApi";
import { useReviewTranslation, type ReviewTranslationKey } from "../i18n";
import { formatReviewValue, StagedChangeDiff } from "./StagedChangeDiff";

/** One entry of the queue, whatever the review mode. */
export interface ReviewQueueItem {
    id: string;
    /** The badges and title line. */
    header: React.ReactNode;
    /** What the reviewer judges: the diff, or the row. */
    body: React.ReactNode;
}

const OPERATION_COLORS: Record<StagedChangeOperation, "emerald" | "yellow" | "red"> = {
    insert: "emerald",
    update: "yellow",
    delete: "red"
};

const OPERATION_LABELS: Record<StagedChangeOperation, ReviewTranslationKey> = {
    insert: "review_op_insert",
    update: "review_op_update",
    delete: "review_op_delete"
};

/** Whether a key press is typing into a field rather than a command to the queue. */
function isTyping(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    return target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT";
}

/**
 * The list a reviewer works through, with the keyboard or the pointer.
 *
 * `j` / `k` (or the arrows) move, `a` approves and `r` rejects — the selection
 * when there is one, the focused entry otherwise — and Space adds the focused
 * entry to the selection. The keys are handled on the list itself, so they
 * only act while focus is in it, and each one it acts on is claimed with
 * `preventDefault()`.
 */
export function ReviewQueueList({
    items,
    loading,
    error,
    onDecide,
    onReload,
    allowReject
}: {
    items: ReviewQueueItem[];
    loading: boolean;
    error?: string;
    onDecide: (action: "approve" | "reject", ids: string[], note?: string) => Promise<void>;
    onReload: () => void;
    allowReject: boolean;
}) {
    const { t } = useReviewTranslation();
    const [active, setActive] = useState(0);
    const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState("");
    const entries = useRef(new Map<string, HTMLElement>());

    // Keep the focus and the selection on entries that still exist.
    useEffect(() => {
        setActive(index => Math.min(index, Math.max(items.length - 1, 0)));
        setSelected(current => {
            const ids = new Set(items.map(item => item.id));
            const kept = [...current].filter(id => ids.has(id));
            return kept.length === current.size ? current : new Set(kept);
        });
    }, [items]);

    useEffect(() => {
        const id = items[active]?.id;
        const element = id ? entries.current.get(id) : undefined;
        if (element && typeof element.scrollIntoView === "function") element.scrollIntoView({ block: "nearest" });
    }, [active, items]);

    const toggle = useCallback((id: string) => {
        setSelected(current => {
            const next = new Set(current);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, []);

    const decide = useCallback(async (action: "approve" | "reject", ids: string[]) => {
        if (ids.length === 0 || busy) return;
        if (action === "reject" && !allowReject) return;
        setBusy(true);
        try {
            await onDecide(action, ids, note.trim() || undefined);
            setSelected(new Set());
            setNote("");
        } finally {
            setBusy(false);
        }
    }, [allowReject, busy, note, onDecide]);

    const targets = useCallback((): string[] => {
        if (selected.size > 0) return items.filter(item => selected.has(item.id)).map(item => item.id);
        const focused = items[active];
        return focused ? [focused.id] : [];
    }, [active, items, selected]);

    const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.defaultPrevented || event.nativeEvent.isComposing || isTyping(event.target)) return;
        if (event.metaKey || event.ctrlKey || event.altKey) return;
        const focused = items[active];
        switch (event.key) {
            case "j":
            case "ArrowDown":
                event.preventDefault();
                setActive(index => Math.min(index + 1, items.length - 1));
                return;
            case "k":
            case "ArrowUp":
                event.preventDefault();
                setActive(index => Math.max(index - 1, 0));
                return;
            case " ":
                if (!focused) return;
                event.preventDefault();
                toggle(focused.id);
                return;
            case "a":
                event.preventDefault();
                void decide("approve", targets());
                return;
            case "r":
                if (!allowReject) return;
                event.preventDefault();
                void decide("reject", targets());
                return;
            default:
        }
    }, [active, allowReject, decide, items, targets, toggle]);

    const allSelected = items.length > 0 && selected.size === items.length;

    return (
        <div className="flex flex-col h-full min-h-0 outline-none" tabIndex={0} onKeyDown={onKeyDown} data-testid="review-queue">
            <div className="flex items-center gap-2 px-4 py-2">
                <Checkbox
                    size="small"
                    checked={allSelected}
                    indeterminate={selected.size > 0 && !allSelected}
                    disabled={items.length === 0}
                    aria-label={t("review_select_all")}
                    onCheckedChange={checked => setSelected(checked ? new Set(items.map(item => item.id)) : new Set())}/>
                <Typography variant="caption" color="secondary" className="flex-grow truncate">
                    {t("review_keyboard_hint")}
                </Typography>
                <Button size="small" variant="text" color="neutral" onClick={onReload} disabled={loading || busy}>
                    {t("review_reload")}
                </Button>
            </div>

            <div className="flex-grow overflow-auto px-4 pb-4 flex flex-col gap-2" role="list">
                {loading && items.length === 0 && (
                    <div className="flex items-center gap-2 py-8 justify-center">
                        <CircularProgress size="small"/>
                        <Typography variant="body2" color="secondary">{t("review_queue_loading")}</Typography>
                    </div>
                )}
                {error && <Typography variant="body2" color="error" className="py-4">{error}</Typography>}
                {!loading && !error && items.length === 0 && (
                    <Typography variant="body2" color="secondary" className="py-8 text-center">{t("review_queue_empty")}</Typography>
                )}
                {items.map((item, index) => {
                    const isActive = index === active;
                    const isSelected = selected.has(item.id);
                    return (
                        <div
                            key={item.id}
                            role="listitem"
                            aria-current={isActive ? "true" : undefined}
                            data-change-id={item.id}
                            ref={element => {
                                if (element) entries.current.set(item.id, element);
                                else entries.current.delete(item.id);
                            }}
                            onClick={() => setActive(index)}
                            className={cls(
                                "rounded-lg p-3 flex gap-3",
                                isActive ? "bg-surface-active" : "hover:bg-surface-hover"
                            )}>
                            <div className="pt-0.5">
                                <Checkbox size="small" checked={isSelected} aria-label={t("review_select_change")}
                                          onCheckedChange={() => toggle(item.id)}/>
                            </div>
                            <div className="flex-grow min-w-0 flex flex-col gap-2">
                                {item.header}
                                {item.body}
                                <div className="flex gap-2">
                                    <Button size="small" variant="outlined" color="neutral" disabled={busy}
                                            onClick={() => void decide("approve", [item.id])}>
                                        {t("review_approve")}
                                    </Button>
                                    {allowReject && (
                                        <Button size="small" variant="text" color="neutral" disabled={busy}
                                                onClick={() => void decide("reject", [item.id])}>
                                            {t("review_reject")}
                                        </Button>
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            <div className="flex flex-col gap-2 px-4 py-3 bg-surface-card">
                <TextField size="small" value={note} onChange={event => setNote(event.target.value)}
                           placeholder={t("review_note_placeholder")}/>
                {selected.size > 0 && (
                    <div className="flex gap-2 justify-end">
                        {allowReject && (
                            <Button variant="outlined" color="neutral" disabled={busy}
                                    onClick={() => void decide("reject", targets())}>
                                {t("review_reject_selected", { count: selected.size })}
                            </Button>
                        )}
                        <Button color="primary" disabled={busy} onClick={() => void decide("approve", targets())}>
                            {t("review_approve_selected", { count: selected.size })}
                        </Button>
                    </div>
                )}
            </div>
        </div>
    );
}

/** The badges and lines that say what a staged change is and who proposed it. */
export function StagedChangeHeader({ change }: { change: StagedChange }) {
    const { t, language } = useReviewTranslation();
    const created = new Date(change.created_at);
    const when = Number.isNaN(created.getTime()) ? change.created_at : created.toLocaleString(language);
    return (
        <div className="flex flex-col gap-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
                <Chip size="small" colorScheme={OPERATION_COLORS[change.operation]}>
                    {t(OPERATION_LABELS[change.operation]).toUpperCase()}
                </Chip>
                <Typography variant="body2" className="font-medium truncate">
                    {change.target_record_id ? t("review_record", { id: change.target_record_id }) : t("review_new_record")}
                </Typography>
                <Tooltip title={change.actor_id ?? undefined}>
                    <Chip size="small">{change.actor_label ?? t("review_actor_unknown")}</Chip>
                </Tooltip>
                <Typography variant="caption" color="secondary">{t("review_proposed_at", { date: when })}</Typography>
            </div>
            <Typography variant="body2" color={change.reason ? "primary" : "secondary"} className={change.reason ? "" : "italic"}>
                {change.reason ?? t("review_no_reason")}
            </Typography>
        </div>
    );
}

/** Answer a decision with a toast either way, and reload what it changed. */
function useDecision(reload: () => Promise<void>) {
    const { t } = useReviewTranslation();
    const snackbar = useSnackbarController();
    return useCallback(async (action: "approve" | "reject", run: () => Promise<number>) => {
        try {
            const count = await run();
            snackbar.open({ type: "success",
message: t(action === "approve" ? "review_approved_toast" : "review_rejected_toast", { count }) });
        } catch (error) {
            snackbar.open({ type: "error",
message: t("review_decide_error", { message: error instanceof Error ? error.message : String(error) }) });
        } finally {
            await reload();
        }
    }, [reload, snackbar, t]);
}

/** Load something on open and on demand, keeping the last answer while reloading. */
function useLoader<T>(load: () => Promise<T>, empty: T) {
    const [value, setValue] = useState<T>(empty);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | undefined>();
    const { t } = useReviewTranslation();
    const reload = useCallback(async () => {
        setLoading(true);
        try {
            setValue(await load());
            setError(undefined);
        } catch (failure) {
            setError(t("review_queue_error", { message: failure instanceof Error ? failure.message : String(failure) }));
        } finally {
            setLoading(false);
        }
    }, [load, t]);
    useEffect(() => {
        void reload();
    }, [reload]);
    return { value,
loading,
error,
reload };
}

function StagedChangesQueue({ api, slug, onCountChange }: { api: ReviewApi; slug: string; review: StagedTableReview; onCountChange?: (count: number) => void }) {
    const load = useCallback(() => api.listChanges({ collection: slug,
status: "pending",
limit: 100 }), [api, slug]);
    const { value, loading, error, reload } = useLoader(load, { data: [],
meta: { total: 0,
limit: 0,
offset: 0,
hasMore: false } });
    useEffect(() => {
        if (!loading) onCountChange?.(value.meta.total);
    }, [loading, onCountChange, value.meta.total]);
    const settle = useDecision(reload);
    const items = useMemo(() => value.data.map((change): ReviewQueueItem => ({
        id: change.id,
        header: <StagedChangeHeader change={change}/>,
        body: <StagedChangeDiff change={change}/>
    })), [value.data]);
    const onDecide = useCallback((action: "approve" | "reject", ids: string[], note?: string) =>
        settle(action, async () => (await api.decide(action, ids, note)).length), [api, settle]);
    return <ReviewQueueList items={items} loading={loading} error={error} onDecide={onDecide} onReload={() => void reload()} allowReject/>;
}

/** The fields of a row worth showing a reviewer: everything but its id and its state. */
function RowFields({ row, review }: { row: ReviewRow; review: StateFieldReview }) {
    const entries = Object.entries(row).filter(([key]) => key !== "id" && key !== review.field);
    return (
        <div className="flex flex-col gap-1">
            {entries.map(([key, value]) => (
                <div key={key} className="grid grid-cols-[minmax(6rem,10rem)_1fr] gap-x-3">
                    <Typography variant="caption" className="font-mono truncate" color="secondary">{key}</Typography>
                    <Typography variant="body2" className="break-words">{formatReviewValue(value) ?? "—"}</Typography>
                </div>
            ))}
        </div>
    );
}

function StateFieldQueue({ api, slug, review, onCountChange }: { api: ReviewApi; slug: string; review: StateFieldReview; onCountChange?: (count: number) => void }) {
    const { t } = useReviewTranslation();
    const load = useCallback(() => api.listRowsInState({ collection: slug,
field: review.field,
value: review.pendingValue,
limit: 100 }),
        [api, review.field, review.pendingValue, slug]);
    const { value, loading, error, reload } = useLoader(load, { rows: [],
total: 0 });
    useEffect(() => {
        if (!loading) onCountChange?.(value.total);
    }, [loading, onCountChange, value.total]);
    const settle = useDecision(reload);
    const items = useMemo(() => value.rows.flatMap((row): ReviewQueueItem[] => {
        const id = row.id;
        if (typeof id !== "string" && typeof id !== "number") return [];
        return [{
            id: String(id),
            header: (
                <div className="flex items-center gap-2">
                    <Chip size="small" colorScheme="yellow">{review.pendingValue}</Chip>
                    <Typography variant="body2" className="font-medium truncate">{t("review_record", { id: String(id) })}</Typography>
                </div>
            ),
            body: <RowFields row={row} review={review}/>
        }];
    }), [review, t, value.rows]);
    const onDecide = useCallback((action: "approve" | "reject", ids: string[]) => settle(action, async () => {
        const state = action === "approve" ? review.approvedValue : review.rejectedValue;
        if (state === undefined) return 0;
        for (const id of ids) await api.setRowState({ collection: slug,
id,
field: review.field,
value: state });
        return ids.length;
    }), [api, review, settle, slug]);
    return (
        <div className="flex flex-col h-full min-h-0">
            <Typography variant="caption" color="secondary" className="px-4 pt-2">
                {t("review_pending_rows", { value: review.pendingValue })}
            </Typography>
            <ReviewQueueList items={items} loading={loading} error={error} onDecide={onDecide}
                             onReload={() => void reload()} allowReject={review.rejectedValue !== undefined}/>
        </div>
    );
}

/**
 * One collection's review queue: the proposed changes waiting in the staged
 * table, or the rows held in the pending state.
 */
export function ReviewQueueView({ config, slug, onCountChange }: {
    config: ReviewConfig;
    slug: string;
    /** Told how many entries are waiting each time the queue loads. */
    onCountChange?: (count: number) => void;
}) {
    const api = useReviewApi(config);
    const review = config.collections[slug];
    if (!review) return null;
    return review.mode === "staged-table"
        ? <StagedChangesQueue api={api} slug={slug} review={review} onCountChange={onCountChange}/>
        : <StateFieldQueue api={api} slug={slug} review={review} onCountChange={onCountChange}/>;
}
