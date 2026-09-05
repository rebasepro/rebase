import React from "react";
import {
    Chip,
    FilterChip,
    SearchBar,
    Select,
    SelectItem,
    Typography,
    Button,
    AlertTriangleIcon,
    ListTodoIcon,
    XIcon
} from "@rebasepro/ui";

/* ── Types ──────────────────────────────────────────────────── */

type QuickFilter = "all" | "overdue";

export interface TaskFiltersProps {
    quickFilter: QuickFilter;
    onQuickFilterChange: (filter: QuickFilter) => void;
    stageFilter: string | null;
    onStageFilterChange: (stage: string | null) => void;
    clientFilter: string | null;
    onClientFilterChange: (clientId: string | null) => void;
    searchText: string;
    onSearchTextChange: (text: string) => void;
    hasActiveFilter: boolean;
    onClearAllFilters: () => void;
    overdueTasks: { length: number };
    pendingTasks: { length: number };
    stageLabels: Record<string, string>;
    stageFilterOrder: string[];
    stageCounts: Record<string, number>;
    activeClientIds: string[];
    clientsMap: Map<string, { name: string; picture?: string }>;
}

/* ── Component ──────────────────────────────────────────────── */

export function TaskFilters({
    quickFilter,
    onQuickFilterChange,
    stageFilter,
    onStageFilterChange,
    clientFilter,
    onClientFilterChange,
    searchText,
    onSearchTextChange,
    hasActiveFilter,
    onClearAllFilters,
    overdueTasks,
    pendingTasks,
    stageLabels,
    stageFilterOrder,
    stageCounts,
    activeClientIds,
    clientsMap
}: TaskFiltersProps) {
    return (
        <>
            {/* Header */}
            <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                    <div className="flex items-center justify-center w-5 h-5 text-surface-400 dark:text-surface-500">
                        <ListTodoIcon className="h-4 w-4" />
                    </div>
                    <Typography variant="subtitle1">Tasks</Typography>
                    {pendingTasks.length > 0 && (
                        <Chip size="smallest" colorScheme="blue">
                            {pendingTasks.length}{hasActiveFilter ? " shown" : " pending"}
                        </Chip>
                    )}
                </div>
                {overdueTasks.length > 0 && (
                    <Chip size="smallest" colorScheme="red">
                        {overdueTasks.length} overdue
                    </Chip>
                )}
            </div>

            {/* ── Filter bar ── */}
            <div className="flex flex-col gap-2 mb-3">
                {/* Quick filter chips row */}
                <div className="flex items-center gap-1.5">
                    <FilterChip
                        active={quickFilter === "all" && !stageFilter && !clientFilter}
                        onClick={() => { onQuickFilterChange("all"); onStageFilterChange(null); onClientFilterChange(null); }}
                        size="small"
                    >
                        All
                    </FilterChip>
                    <FilterChip
                        active={quickFilter === "overdue"}
                        onClick={() => { onQuickFilterChange(quickFilter === "overdue" ? "all" : "overdue"); }}
                        size="small"
                        icon={<AlertTriangleIcon className="h-3 w-3" />}
                    >
                        Overdue{overdueTasks.length > 0 ? ` (${overdueTasks.length})` : ""}
                    </FilterChip>

                    {/* Clear all filters using @rebasepro/ui Button */}
                    {hasActiveFilter && (
                        <Button
                            variant="text"
                            size="small"
                            color="neutral"
                            className="p-0 h-auto min-w-0 text-xs text-text-secondary dark:text-text-secondary-dark hover:text-primary dark:hover:text-primary-light"
                            onClick={onClearAllFilters}
                            startIcon={<XIcon className="h-3 w-3" />}
                        >
                            Clear
                        </Button>
                    )}
                </div>

                {/* Stage select + Client select + Search row */}
                <div className="flex items-center gap-2">
                    <div className="flex-1">
                        <SearchBar
                            onTextSearch={(v) => { onSearchTextChange(v || ""); }}
                            placeholder="Search tasks..."
                            size="smallest"
                            className="w-full"
                        />
                    </div>

                    {/* Stage filter dropdown */}
                    <Select
                        value={stageFilter || "__all__"}
                        onValueChange={(v) => { onStageFilterChange(v === "__all__" ? null : v as string); }}
                        placeholder="Stage"
                        size="smallest"
                        renderValue={(v) => {
                            if (!v || v === "__all__") return "Stage";
                            return stageLabels[v as string] || "Stage";
                        }}
                        position="popper"
                    >
                        <SelectItem value={"__all__"}>All stages</SelectItem>
                        {stageFilterOrder
                            .filter(stageId => stageCounts[stageId] > 0)
                            .map(stageId => (
                                <SelectItem key={stageId} value={stageId}>
                                    {stageLabels[stageId] || stageId}
                                    {stageCounts[stageId] > 0 ? ` (${stageCounts[stageId]})` : ""}
                                </SelectItem>
                            ))
                        }
                    </Select>

                    {/* Client filter dropdown */}
                    {activeClientIds.length > 1 && (
                        <Select
                            value={clientFilter || "__all__"}
                            onValueChange={(v) => { onClientFilterChange(v === "__all__" ? null : v as string); }}
                            placeholder="All clients"
                            size="smallest"
                            renderValue={(v) => {
                                if (!v || v === "__all__") return "Client";
                                const info = clientsMap.get(v as string);
                                return info?.name || "Client";
                            }}
                            position="popper"
                        >
                            <SelectItem value={"__all__"}>All clients</SelectItem>
                            {activeClientIds.map(cId => {
                                const info = clientsMap.get(cId);
                                if (!info) return null;
                                return (
                                    <SelectItem key={cId} value={cId}>
                                        {info.name}
                                    </SelectItem>
                                );
                            })}
                        </Select>
                    )}
                </div>
            </div>
        </>
    );
}
