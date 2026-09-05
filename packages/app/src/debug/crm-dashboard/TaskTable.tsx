import React, { useState, useCallback } from "react";
import {
    Typography,
    cls,
    Card,
    Chip,
    Skeleton,
    Checkbox,
    Button,
    CalendarIcon,
    AlertTriangleIcon,
    ListTodoIcon,
    CheckCircle2Icon
} from "@rebasepro/ui";

/* ── Types ──────────────────────────────────────────────────── */

interface TaskEntity {
    id: string;
    values: {
        title: string;
        status: string;
        resolution: string | null;
        dueDate: string | null;
        stageId: string | null;
        description: string | null;
        notes: string | null;
        clientId: string | null;
        client?: { name?: string } | null;
        priority?: string | null;
        createdAt: string | null;
    };
}

export interface TaskTableProps {
    tasks: TaskEntity[];
    loading: boolean;
    pendingTasks: TaskEntity[];
    visiblePendingTasks: TaskEntity[];
    hasMorePending: boolean;
    onLoadMorePending: () => void;
    pendingCount: number;
    togglingIds: Set<string>;
    onToggleTask: (taskId: string, currentStatus: string) => void;
    onOpenTask: (taskId: string) => void;
    onOpenClient: (clientId: string) => void;
    clientsMap: Map<string, { name: string; picture?: string }>;
    stageLabels: Record<string, string>;
    recentlyToggledIds: Set<string>;
    /* Completed section */
    completedTasks: TaskEntity[];
    completedLoaded: boolean;
    loadingCompleted: boolean;
    completedHasMore: boolean;
    onExpandCompleted: () => void;
    onLoadMoreCompleted: () => void;
}

export const resolutionDisplay: Record<string, { label: string; colorScheme: string }> = {
    verified: { label: "Verified", colorScheme: "green" },
    needs_followup: { label: "Needs Follow-up", colorScheme: "amber" },
    suitable: { label: "Suitable", colorScheme: "green" },
    not_a_fit: { label: "Not a Fit", colorScheme: "red" },
    response_received: { label: "Response Received", colorScheme: "green" },
    followup_sent: { label: "Follow-up Sent", colorScheme: "blue" },
    prepared: { label: "Prepared", colorScheme: "green" },
    invite_sent: { label: "Invite Sent", colorScheme: "green" },
    agreement_ready: { label: "Agreement Ready", colorScheme: "green" },
    signed: { label: "Signed", colorScheme: "green" },
    reminder_sent: { label: "Reminder Sent", colorScheme: "blue" },
    payment_confirmed: { label: "Payment Confirmed", colorScheme: "green" },
    not_yet_received: { label: "Not Yet Received", colorScheme: "amber" },
    sent: { label: "Sent", colorScheme: "green" },
    confirmed: { label: "Confirmed", colorScheme: "green" },
    not_yet: { label: "Not Yet", colorScheme: "amber" },
    scheduled: { label: "Scheduled", colorScheme: "green" },
    feedback_received: { label: "Feedback Received", colorScheme: "green" },
    awaiting_response: { label: "Awaiting Response", colorScheme: "amber" },
    archived: { label: "Archived", colorScheme: "green" },
    done: { label: "Done", colorScheme: "green" },
};

/* ── Helpers ────────────────────────────────────────────────── */

function formatDueDate(dateStr: string | null): string | null {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diffMs = target.getTime() - today.getTime();
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Tomorrow";
    if (diffDays === -1) return "Yesterday";
    if (diffDays < 0) return `${Math.abs(diffDays)}d overdue`;
    if (diffDays <= 7) return `In ${diffDays}d`;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function isDueDateOverdue(dateStr: string | null): boolean {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return false;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return d < today;
}

function isDueDateSoon(dateStr: string | null): boolean {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return false;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const diffMs = d.getTime() - today.getTime();
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
    return diffDays >= 0 && diffDays <= 2;
}

/* ── Component ──────────────────────────────────────────────── */

export function TaskTable({
    tasks,
    loading,
    pendingTasks,
    visiblePendingTasks,
    hasMorePending,
    onLoadMorePending,
    pendingCount,
    togglingIds,
    onToggleTask,
    onOpenTask,
    onOpenClient,
    clientsMap,
    stageLabels,
    recentlyToggledIds,
    completedTasks,
    completedLoaded,
    loadingCompleted,
    completedHasMore,
    onExpandCompleted,
    onLoadMoreCompleted
}: TaskTableProps) {

    /* ── Task Row Renderer ── */
    const renderTaskRow = useCallback((task: TaskEntity) => {
        const isCompleted = task.values?.status === "completed";
        const isToggling = togglingIds.has(task.id);
        const dueLabel = formatDueDate(task.values?.dueDate);
        const overdue = !isCompleted && isDueDateOverdue(task.values?.dueDate);
        const soon = !isCompleted && isDueDateSoon(task.values?.dueDate);
        const stageName = task.values?.stageId ? stageLabels[task.values.stageId] : null;
        const clientInfo = task.values?.clientId ? clientsMap.get(task.values.clientId) : null;
        const clientName = clientInfo?.name || null;

        return (
            <div
                key={task.id}
                className={cls(
                    "group flex items-start gap-3 py-2.5 px-3 rounded-md transition-colors duration-150 cursor-pointer",
                    "hover:bg-surface-accent-100 dark:hover:bg-surface-800",
                    isCompleted && "opacity-60",
                    overdue && "border-l-2 border-l-red-500 rounded-l-none",
                    soon && !overdue && "border-l-2 border-l-amber-450 rounded-l-none"
                )}
                onClick={() => onOpenTask(task.id)}
            >
                {/* Checkbox */}
                <div
                    className="pt-0.5 shrink-0"
                    onClick={(e) => e.stopPropagation()}
                >
                    <Checkbox
                        checked={isCompleted}
                        size="small"
                        onCheckedChange={() => {
                            if (!isToggling) onToggleTask(task.id, task.values?.status);
                        }}
                    />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                        <Typography
                            variant="body2"
                            className={cls(
                                "leading-snug",
                                isCompleted && "line-through text-text-disabled dark:text-text-disabled-dark"
                            )}
                        >
                            {task.values?.title || "Untitled Task"}
                        </Typography>
                        {task.values?.priority === "high" && (
                            <Chip colorScheme="red" size="smallest">High</Chip>
                        )}
                    </div>

                    {/* Meta row */}
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                        {dueLabel && (
                            <span className={cls(
                                "inline-flex items-center gap-1 text-[11px]",
                                overdue && "text-red-600 dark:text-red-400 font-medium",
                                soon && !overdue && "text-amber-600 dark:text-amber-400 font-medium",
                                !overdue && !soon && "text-text-secondary dark:text-text-secondary-dark"
                            )}>
                                {overdue ? (
                                    <AlertTriangleIcon className="h-3 w-3" />
                                ) : (
                                    <CalendarIcon className="h-3 w-3" />
                                )}
                                {dueLabel}
                            </span>
                        )}

                        {clientName && task.values?.clientId && (
                            <Typography
                                variant="body2"
                                className={cls(
                                    "inline-flex items-center gap-1 text-primary hover:text-primary-dark",
                                    "dark:text-primary-light dark:hover:text-primary",
                                    "hover:underline cursor-pointer text-[11px]"
                                )}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onOpenClient(task.values.clientId!);
                                }}
                            >
                                {(() => {
                                    const clientPic = clientInfo?.picture;
                                    const clientInitial = (clientName || "?")[0].toUpperCase();
                                    return clientPic ? (
                                        <img src={clientPic} alt="" className="w-4 h-4 rounded-full object-cover shrink-0" />
                                    ) : (
                                        <div className="w-4 h-4 rounded-full bg-surface-200 dark:bg-surface-700 text-surface-500 dark:text-surface-400 flex items-center justify-center shrink-0">
                                            <span className="text-[9px] font-semibold">{clientInitial}</span>
                                        </div>
                                    );
                                })()}
                                {clientName}
                            </Typography>
                        )}

                        {stageName && (
                            <Chip size="smallest" colorScheme="cyan" outlined>
                                {stageName}
                            </Chip>
                        )}

                        {/* Resolution chip for completed tasks */}
                        {isCompleted && task.values?.resolution && resolutionDisplay[task.values.resolution] && (
                            <Chip
                                size="smallest"
                                colorScheme={resolutionDisplay[task.values.resolution].colorScheme as any}
                            >
                                {resolutionDisplay[task.values.resolution].label}
                            </Chip>
                        )}
                    </div>
                </div>
            </div>
        );
    }, [togglingIds, onToggleTask, onOpenTask, onOpenClient, clientsMap, recentlyToggledIds, stageLabels]);

    /* ── Skeleton loader ── */
    if (loading) {
        return (
            <div className="flex flex-col gap-3">
                {[1, 2, 3, 4].map(i => (
                    <div key={i} className="flex items-center gap-3 py-2 px-3">
                        <Skeleton width={18} height={18} />
                        <div className="flex-1 space-y-1">
                            <Skeleton width={200} height={16} />
                            <Skeleton width={120} height={12} />
                        </div>
                    </div>
                ))}
            </div>
        );
    }

    return (
        <div className="flex-1 overflow-y-auto">
            {tasks.length === 0 ? (
                <Card className="flex flex-col items-center justify-center py-10 px-6 text-center mt-2 border-dashed">
                    <div className="flex items-center justify-center w-5 h-5 text-surface-400 dark:text-surface-500 mb-3">
                        <CheckCircle2Icon className="h-4 w-4" />
                    </div>
                    <Typography variant="subtitle2" className="mb-1">
                        All clear!
                    </Typography>
                    <Typography variant="body2" color="secondary">
                        No tasks at the moment. New tasks will show up here automatically.
                    </Typography>
                </Card>
            ) : (
                <div className="space-y-4">
                    {/* Pending tasks */}
                    {pendingTasks.length > 0 && (
                        <div className="space-y-0.5">
                            {visiblePendingTasks.map(renderTaskRow)}
                            {hasMorePending && (
                                <div className="pt-2">
                                    <Button
                                        variant="text"
                                        size="small"
                                        color="primary"
                                        className="w-full justify-center"
                                        onClick={onLoadMorePending}
                                    >
                                        Load more ({pendingCount - visiblePendingTasks.length} remaining)
                                    </Button>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Completed tasks - lazy loaded collapsed section */}
                    <CompletedSection
                        tasks={completedTasks}
                        renderTaskRow={renderTaskRow}
                        onExpand={onExpandCompleted}
                        onLoadMore={onLoadMoreCompleted}
                        loading={loadingCompleted}
                        hasMore={completedHasMore}
                    />
                </div>
            )}
        </div>
    );
}

/* ── Completed Section (collapsible, lazy-loaded) ─────────── */

function CompletedSection({
    tasks,
    renderTaskRow,
    onExpand,
    onLoadMore,
    loading,
    hasMore
}: {
    tasks: TaskEntity[];
    renderTaskRow: (task: TaskEntity) => React.ReactNode;
    onExpand: () => void;
    onLoadMore: () => void;
    loading: boolean;
    hasMore: boolean;
}) {
    const [expanded, setExpanded] = useState(false);

    const handleToggle = () => {
        const willExpand = !expanded;
        setExpanded(willExpand);
        if (willExpand) onExpand();
    };

    return (
        <div>
            <Button
                variant="text"
                size="small"
                color="neutral"
                className="w-full justify-between hover:bg-surface-accent-100 dark:hover:bg-surface-800 px-3 py-1.5 h-auto text-left"
                onClick={handleToggle}
                endIcon={
                    <svg
                        className={cls(
                            "h-3 w-3 text-text-secondary dark:text-text-secondary-dark transition-transform duration-150",
                            expanded && "rotate-90"
                        )}
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    >
                        <polyline points="9 18 15 12 9 6" />
                    </svg>
                }
            >
                <Typography
                    variant="caption"
                    color="secondary"
                    className="font-semibold uppercase tracking-wider text-[10px]"
                >
                    Completed{tasks.length > 0 ? ` (${tasks.length}${hasMore ? "+" : ""})` : ""}
                </Typography>
            </Button>
            {expanded && (
                <div className="mt-1 space-y-0.5">
                    {loading && tasks.length === 0 ? (
                        <div className="flex items-center gap-2 px-3 py-3">
                            <Skeleton width={18} height={18} />
                            <Skeleton width={200} height={16} />
                        </div>
                    ) : (
                        <>
                            {tasks.map(renderTaskRow)}
                            {hasMore && (
                                <div className="pt-2">
                                    <Button
                                        variant="text"
                                        size="small"
                                        color="primary"
                                        className="w-full justify-center"
                                        onClick={onLoadMore}
                                        disabled={loading}
                                    >
                                        {loading ? "Loading..." : "Load more completed"}
                                    </Button>
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
