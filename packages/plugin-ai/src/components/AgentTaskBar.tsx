import React, { useState } from "react";
import {
    ArrowUpIcon,
    Button,
    Chip,
    cls,
    defaultBorderMixin,
    IconButton,
    iconSize,
    Maximize2Icon,
    MinusIcon,
    StatusDot,
    Typography,
    XIcon,
    type StatusTone
} from "@rebasepro/ui";

export type AgentTaskStatus = "queued" | "running" | "review" | "done" | "error";

export interface AgentTaskDiffSummary {
    label: string;
    additions?: number;
    removals?: number;
    subtitle?: string;
}

export interface AgentTaskItem {
    id: string;
    title: string;
    status: AgentTaskStatus;
    /** Optional model badge shown in the header (e.g. "Gemini", "Opus"). */
    model?: string;
    /** Context badge (e.g. "posts/abc-123 added to context"). */
    contextLabel?: string;
    /** Elapsed duration label (e.g. "Worked for 10 sec"). */
    elapsedLabel?: string;
    /** Concise human-readable intent summary (e.g. "Updated 18 rows in posts · 1 skipped"). */
    summary?: string;
    /** Optional structured diff card shown above actions. */
    diff?: AgentTaskDiffSummary;
    /** Number of pending diffs/changes ready for review. */
    pendingDiffCount?: number;
}

export interface AgentTaskBarProps {
    tasks: readonly AgentTaskItem[];
    activeTaskId?: string;
    onSelectTask?: (taskId: string) => void;
    onReviewDiff?: (taskId: string) => void;
    onApplyTask?: (taskId: string) => void;
    onDismissTask?: (taskId: string) => void;
    /** Queue a follow-up instruction for the active task without interrupting execution. */
    onQueueInstruction?: (taskId: string, instruction: string) => void;
    className?: string;
}

const STATUS_TONE: Record<AgentTaskStatus, StatusTone> = {
    queued: "idle",
    running: "busy",
    review: "busy",
    done: "ok",
    error: "bad"
};

/**
 * Docked floating multi-tab agent panel (Linear agent-window pattern).
 *
 * Keeps direct manipulation front and center: compact header with model badge
 * and minimize/expand/close controls, multi-task tabs when running concurrent
 * jobs, structured diff summary card (`+additions -removals` + Preview/Apply),
 * and a quiet bottom reply/queue bar.
 */
export function AgentTaskBar({
    tasks,
    activeTaskId,
    onSelectTask,
    onReviewDiff,
    onApplyTask,
    onDismissTask,
    onQueueInstruction,
    className
}: AgentTaskBarProps) {
    const [selectedId, setSelectedId] = useState<string | undefined>(activeTaskId ?? tasks[0]?.id);
    const [minimized, setMinimized] = useState(false);
    const [expanded, setExpanded] = useState(false);
    const [queuedInput, setQueuedInput] = useState("");

    if (tasks.length === 0) return null;

    const currentId = activeTaskId ?? selectedId ?? tasks[0]?.id;
    const activeTask = tasks.find((t) => t.id === currentId) ?? tasks[0];

    const handleSelect = (id: string) => {
        setSelectedId(id);
        onSelectTask?.(id);
    };

    const handleQueueSubmit = (event: React.FormEvent) => {
        event.preventDefault();
        const trimmed = queuedInput.trim();
        if (!trimmed || !activeTask || !onQueueInstruction) return;
        onQueueInstruction(activeTask.id, trimmed);
        setQueuedInput("");
    };

    if (minimized) {
        return (
            <button
                type="button"
                onClick={() => setMinimized(false)}
                className={cls(
                    "inline-flex items-center gap-2 rounded-full border bg-surface-card px-3 py-1.5 shadow-lg hover:bg-surface-card-hover transition-colors",
                    defaultBorderMixin,
                    className
                )}
            >
                <StatusDot tone={STATUS_TONE[activeTask.status]} size="small" />
                <Typography variant="caption" className="font-medium text-text-primary dark:text-text-primary-dark">
                    {activeTask.title}
                </Typography>
                {tasks.length > 1 && <Chip size="smallest">{tasks.length}</Chip>}
            </button>
        );
    }

    return (
        <aside
            aria-label="Agent tasks"
            className={cls(
                "rounded-xl border bg-surface-card shadow-2xl overflow-hidden flex flex-col",
                expanded ? "w-[480px]" : "w-[360px]",
                defaultBorderMixin,
                className
            )}
        >
            {/* Docked window header */}
            <div className={cls("flex items-center justify-between gap-2 px-3 py-2 border-b bg-surface-sheet", defaultBorderMixin)}>
                <div className="flex items-center gap-2 min-w-0">
                    <StatusDot tone={STATUS_TONE[activeTask.status]} size="small" />
                    <Typography variant="caption" className="font-semibold text-text-primary dark:text-text-primary-dark truncate">
                        {activeTask.title}
                    </Typography>
                    {activeTask.model && (
                        <Chip size="smallest">{activeTask.model}</Chip>
                    )}
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                    <IconButton size="smallest" aria-label="Minimize" onClick={() => setMinimized(true)}>
                        <MinusIcon size={iconSize.smallest} />
                    </IconButton>
                    <IconButton
                        size="smallest"
                        aria-label={expanded ? "Compact" : "Expand"}
                        onClick={() => setExpanded((e) => !e)}
                    >
                        <Maximize2Icon size={iconSize.smallest} className={expanded ? "rotate-180 transition-transform" : "transition-transform"} />
                    </IconButton>
                    {onDismissTask && (
                        <IconButton size="smallest" aria-label="Dismiss" onClick={() => onDismissTask(activeTask.id)}>
                            <XIcon size={iconSize.smallest} />
                        </IconButton>
                    )}
                </div>
            </div>

            {/* Multi-tab strip when running 2+ concurrent tasks */}
            {tasks.length > 1 && (
                <div
                    role="tablist"
                    aria-label="Active agent tasks"
                    className={cls("flex items-center gap-1 px-2 pt-1.5 border-b overflow-x-auto bg-surface-sheet", defaultBorderMixin)}
                >
                    {tasks.map((task) => {
                        const isActive = task.id === activeTask.id;
                        return (
                            <button
                                key={task.id}
                                type="button"
                                role="tab"
                                aria-selected={isActive}
                                onClick={() => handleSelect(task.id)}
                                className={cls(
                                    "flex items-center gap-1.5 px-2.5 py-1 rounded-t-md text-xs font-medium transition-colors shrink-0",
                                    isActive
                                        ? "bg-surface-card text-text-primary dark:text-text-primary-dark"
                                        : "text-surface-500 hover:bg-surface-hover"
                                )}
                            >
                                <StatusDot tone={STATUS_TONE[task.status]} size="small" />
                                <span className="truncate max-w-[140px]">{task.title}</span>
                                {task.pendingDiffCount !== undefined && task.pendingDiffCount > 0 && (
                                    <Chip size="smallest">{task.pendingDiffCount}</Chip>
                                )}
                            </button>
                        );
                    })}
                </div>
            )}

            {/* Body: context pill, elapsed, intent summary, structured diff card */}
            <div className="p-3.5 flex flex-col gap-2.5">
                {activeTask.contextLabel && (
                    <div className="flex justify-end">
                        <Typography variant="caption" color="secondary" className="text-[11px] font-mono">
                            {activeTask.contextLabel}
                        </Typography>
                    </div>
                )}

                {activeTask.elapsedLabel && (
                    <Typography variant="caption" color="secondary" className="text-[11px]">
                        {activeTask.elapsedLabel}
                    </Typography>
                )}

                {activeTask.summary && (
                    <Typography variant="body2" className="text-[13px] leading-snug text-text-primary dark:text-text-primary-dark">
                        {activeTask.summary}
                    </Typography>
                )}

                {activeTask.diff && (
                    <div className={cls("rounded-lg border bg-surface-sheet p-2.5 space-y-1.5", defaultBorderMixin)}>
                        <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                                <Typography variant="caption" className="font-medium text-text-primary dark:text-text-primary-dark truncate">
                                    {activeTask.diff.label}
                                </Typography>
                                {activeTask.diff.additions !== undefined && (
                                    <span className="font-mono text-[11px] text-emerald-500">{`+${activeTask.diff.additions}`}</span>
                                )}
                                {activeTask.diff.removals !== undefined && (
                                    <span className="font-mono text-[11px] text-red-400">{`-${activeTask.diff.removals}`}</span>
                                )}
                            </div>
                            {onReviewDiff && (
                                <Button size="small" variant="outlined" onClick={() => onReviewDiff(activeTask.id)}>
                                    Preview
                                </Button>
                            )}
                        </div>
                        {activeTask.diff.subtitle && (
                            <Typography variant="caption" color="secondary" className="font-mono text-[11px] block truncate">
                                {activeTask.diff.subtitle}
                            </Typography>
                        )}
                    </div>
                )}

                {(onApplyTask || (onReviewDiff && !activeTask.diff)) && activeTask.status === "review" && (
                    <div className="flex items-center justify-end gap-1.5 pt-0.5">
                        {onReviewDiff && !activeTask.diff && (
                            <Button size="small" variant="outlined" onClick={() => onReviewDiff(activeTask.id)}>
                                Preview
                            </Button>
                        )}
                        {onApplyTask && (
                            <Button size="small" color="primary" onClick={() => onApplyTask(activeTask.id)}>
                                Apply
                            </Button>
                        )}
                    </div>
                )}
            </div>

            {/* Bottom reply / queue bar */}
            {onQueueInstruction && (
                <form
                    onSubmit={handleQueueSubmit}
                    className={cls("flex items-center gap-2 px-3 py-2 border-t bg-surface-sheet", defaultBorderMixin)}
                >
                    <input
                        type="text"
                        value={queuedInput}
                        onChange={(e) => setQueuedInput(e.target.value)}
                        placeholder="Reply or queue instruction…"
                        aria-label="Reply or queue instruction"
                        className="flex-1 bg-transparent text-xs text-text-primary dark:text-text-primary-dark placeholder:text-surface-500 outline-none"
                    />
                    <IconButton
                        type="submit"
                        size="smallest"
                        aria-label="Send instruction"
                        disabled={!queuedInput.trim()}
                    >
                        <ArrowUpIcon size={iconSize.smallest} />
                    </IconButton>
                </form>
            )}
        </aside>
    );
}
