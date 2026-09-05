import React, { useState, useMemo, useCallback } from "react";
import { TaskFilters } from "./TaskFilters";
import { TaskTable } from "./TaskTable";

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

type QuickFilter = "all" | "overdue";

const PENDING_PAGE_SIZE = 50;

function isDueDateOverdue(dateStr: string | null): boolean {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return false;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return d < today;
}

export interface TasksViewProps {
    loading: boolean;
    tasks: TaskEntity[];
    togglingIds: Set<string>;
    onToggleTask: (taskId: string, currentStatus: string) => void;
    onOpenTask: (taskId: string) => void;
    onOpenClient: (clientId: string) => void;
    clientsMap: Map<string, { name: string; picture?: string }>;
    pipelineStages: any[];
    recentlyToggledIds: Set<string>;
    completedTasks: TaskEntity[];
    completedLoaded: boolean;
    loadingCompleted: boolean;
    completedHasMore: boolean;
    onExpandCompleted: () => void;
    onLoadMoreCompleted: () => void;
}

/* ── Component ──────────────────────────────────────────────── */

export function TasksView({
    loading,
    tasks,
    togglingIds,
    onToggleTask,
    onOpenTask,
    onOpenClient,
    clientsMap,
    pipelineStages,
    recentlyToggledIds,
    completedTasks,
    completedLoaded,
    loadingCompleted,
    completedHasMore,
    onExpandCompleted,
    onLoadMoreCompleted
}: TasksViewProps) {
    const stageLabels: Record<string, string> = useMemo(
        () => Object.fromEntries(
            pipelineStages.map(s => [s.values?.stageKey, s.values?.label])
        ),
        [pipelineStages]
    );

    const stageFilterOrder: string[] = useMemo(
        () => pipelineStages.map(s => s.values?.stageKey).filter(Boolean),
        [pipelineStages]
    );

    // ── Filtering state ──
    const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");
    const [stageFilter, setStageFilter] = useState<string | null>(null);
    const [clientFilter, setClientFilter] = useState<string | null>(null);
    const [searchText, setSearchText] = useState<string>("");
    const [visiblePendingCount, setVisiblePendingCount] = useState(PENDING_PAGE_SIZE);

    /* ── Derived data ── */
    const overdueTasks = useMemo(
        () => tasks.filter(t =>
            t.values?.status === "pending" &&
            !recentlyToggledIds.has(t.id) &&
            isDueDateOverdue(t.values?.dueDate)
        ),
        [tasks, recentlyToggledIds]
    );

    // Unique client IDs in current pending tasks
    const activeClientIds = useMemo(() => {
        const ids = new Set<string>();
        tasks.forEach(t => {
            if (t.values?.clientId) ids.add(t.values.clientId);
        });
        return Array.from(ids).sort((a, b) => {
            const na = clientsMap.get(a)?.name || "";
            const nb = clientsMap.get(b)?.name || "";
            return na.localeCompare(nb);
        });
    }, [tasks, clientsMap]);

    // Stage counts for badge display
    const stageCounts = useMemo(() => {
        const counts: Record<string, number> = {};
        tasks.forEach(t => {
            if (t.values?.status === "pending" && t.values?.stageId) {
                counts[t.values.stageId] = (counts[t.values.stageId] || 0) + 1;
            }
        });
        return counts;
    }, [tasks]);

    // Apply filters to pending tasks
    const filteredPendingTasks = useMemo(() => {
        let filtered = tasks.filter(t =>
            t.values?.status === "pending" ||
            (t.values?.status === "completed" && recentlyToggledIds.has(t.id))
        );

        if (quickFilter === "overdue") {
            filtered = filtered.filter(t =>
                isDueDateOverdue(t.values?.dueDate) ||
                recentlyToggledIds.has(t.id)
            );
        }

        if (stageFilter) {
            filtered = filtered.filter(t =>
                t.values?.stageId === stageFilter ||
                recentlyToggledIds.has(t.id)
            );
        }

        if (clientFilter) {
            filtered = filtered.filter(t =>
                t.values?.clientId === clientFilter ||
                recentlyToggledIds.has(t.id)
            );
        }

        if (searchText.trim()) {
            const q = searchText.trim().toLowerCase();
            filtered = filtered.filter(t => {
                const title = (t.values?.title || "").toLowerCase();
                const desc = (t.values?.description || "").toLowerCase();
                const clientName = t.values?.clientId
                    ? (clientsMap.get(t.values.clientId)?.name || "").toLowerCase()
                    : "";
                return title.includes(q) || desc.includes(q) || clientName.includes(q);
            });
        }

        return filtered;
    }, [tasks, recentlyToggledIds, quickFilter, stageFilter, clientFilter, searchText, clientsMap]);

    const visiblePendingTasks = useMemo(() =>
        filteredPendingTasks.slice(0, visiblePendingCount),
        [filteredPendingTasks, visiblePendingCount]
    );
    const hasMorePending = filteredPendingTasks.length > visiblePendingCount;
    const pendingCount = filteredPendingTasks.length;

    const handleClearAllFilters = useCallback(() => {
        setQuickFilter("all");
        setStageFilter(null);
        setClientFilter(null);
        setSearchText("");
    }, []);

    const hasActiveFilter = quickFilter !== "all" || stageFilter !== null || clientFilter !== null || searchText !== "";

    return (
        <div className="flex flex-col h-full bg-white dark:bg-surface-900">
            <div className="flex flex-col gap-4 overflow-y-auto flex-1">
                <TaskFilters
                    quickFilter={quickFilter}
                    onQuickFilterChange={setQuickFilter}
                    stageFilter={stageFilter}
                    onStageFilterChange={setStageFilter}
                    clientFilter={clientFilter}
                    onClientFilterChange={setClientFilter}
                    searchText={searchText}
                    onSearchTextChange={setSearchText}
                    hasActiveFilter={hasActiveFilter}
                    onClearAllFilters={handleClearAllFilters}
                    overdueTasks={overdueTasks}
                    pendingTasks={tasks.filter(t => t.values?.status === "pending" && !recentlyToggledIds.has(t.id))}
                    stageLabels={stageLabels}
                    stageFilterOrder={stageFilterOrder}
                    stageCounts={stageCounts}
                    activeClientIds={activeClientIds}
                    clientsMap={clientsMap}
                />

                <TaskTable
                    tasks={tasks}
                    loading={loading}
                    pendingTasks={filteredPendingTasks}
                    visiblePendingTasks={visiblePendingTasks}
                    hasMorePending={hasMorePending}
                    onLoadMorePending={() => setVisiblePendingCount(prev => prev + PENDING_PAGE_SIZE)}
                    pendingCount={pendingCount}
                    togglingIds={togglingIds}
                    onToggleTask={onToggleTask}
                    onOpenTask={onOpenTask}
                    onOpenClient={onOpenClient}
                    clientsMap={clientsMap}
                    stageLabels={stageLabels}
                    recentlyToggledIds={recentlyToggledIds}
                    completedTasks={completedTasks}
                    completedLoaded={completedLoaded}
                    loadingCompleted={loadingCompleted}
                    completedHasMore={completedHasMore}
                    onExpandCompleted={onExpandCompleted}
                    onLoadMoreCompleted={onLoadMoreCompleted}
                />
            </div>
        </div>
    );
}
