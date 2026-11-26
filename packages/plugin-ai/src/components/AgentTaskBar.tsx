import React, { useState } from "react";
import {
    Button,
    Chip,
    cls,
    defaultBorderMixin,
    StatusDot,
    Typography,
    type StatusTone
} from "@rebasepro/ui";

export type AgentTaskStatus = "queued" | "running" | "review" | "done" | "error";

export interface AgentTaskItem {
    id: string;
    title: string;
    status: AgentTaskStatus;
    /** Concise human-readable intent summary (e.g. "Updated 18 rows in posts · 1 skipped"). */
    summary?: string;
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
 * Direct-manipulation multi-tab toolbar for concurrent AI agent tasks.
 *
 * Replaces chat-style sidebars with scannable tabs, live status dots,
 * concise intent summaries, explicit diff/apply controls, and non-blocking
 * instruction queuing.
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

    return (
        <aside
            aria-label="Agent tasks"
            className={cls(
                "rounded-xl border bg-surface-card shadow-lg overflow-hidden",
                defaultBorderMixin,
                className
            )}
        >
            {/* Multi-tab task strip */}
            <div
                role="tablist"
                aria-label="Active agent tasks"
                className={cls("flex items-center gap-1 px-2 pt-2 border-b overflow-x-auto bg-surface-sheet", defaultBorderMixin)}
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
                                "flex items-center gap-2 px-3 py-1.5 rounded-t-lg text-xs font-medium transition-colors shrink-0",
                                isActive
                                    ? "bg-surface-card text-text-primary dark:text-text-primary-dark"
                                    : "text-surface-500 hover:bg-surface-hover"
                            )}
                        >
                            <StatusDot tone={STATUS_TONE[task.status]} size="small" />
                            <span className="truncate max-w-[180px]">{task.title}</span>
                            {task.pendingDiffCount !== undefined && task.pendingDiffCount > 0 && (
                                <Chip size="smallest">{task.pendingDiffCount}</Chip>
                            )}
                        </button>
                    );
                })}
            </div>

            {/* Active task intent summary & direct controls */}
            {activeTask && (
                <div className="p-3 flex flex-col gap-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                            <Typography variant="body2" className="font-medium truncate">
                                {activeTask.summary ?? activeTask.title}
                            </Typography>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                            {onReviewDiff && activeTask.status === "review" && (
                                <Button size="small" variant="outlined" onClick={() => onReviewDiff(activeTask.id)}>
                                    Review diff
                                </Button>
                            )}
                            {onApplyTask && activeTask.status === "review" && (
                                <Button size="small" color="primary" onClick={() => onApplyTask(activeTask.id)}>
                                    Apply
                                </Button>
                            )}
                            {onDismissTask && (activeTask.status === "done" || activeTask.status === "error") && (
                                <Button size="small" variant="text" onClick={() => onDismissTask(activeTask.id)}>
                                    Dismiss
                                </Button>
                            )}
                        </div>
                    </div>

                    {onQueueInstruction && (activeTask.status === "running" || activeTask.status === "queued") && (
                        <form onSubmit={handleQueueSubmit} className="flex items-center gap-2">
                            <input
                                type="text"
                                value={queuedInput}
                                onChange={(e) => setQueuedInput(e.target.value)}
                                placeholder="Queue next instruction…"
                                aria-label="Queue next instruction"
                                className="flex-1 rounded-lg bg-surface-field px-3 py-1.5 text-xs text-text-primary dark:text-text-primary-dark placeholder:text-surface-500 outline-none"
                            />
                            <Button type="submit" size="small" variant="outlined" disabled={!queuedInput.trim()}>
                                Queue
                            </Button>
                        </form>
                    )}
                </div>
            )}
        </aside>
    );
}
