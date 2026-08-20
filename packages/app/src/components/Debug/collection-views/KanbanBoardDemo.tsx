import React, { useState, useCallback, useMemo } from "react";
import { Typography, Chip, cls, defaultBorderMixin, KanbanView, Alert, FolderKanbanIcon } from "@rebasepro/ui";
import type { BoardItem, BoardItemViewProps } from "@rebasepro/ui";
import { SAMPLE_PROJECTS, PRIORITY_CONFIG } from "./sample_data";
import type { SampleProject, ProjectStatus } from "./sample_data";

const STATUS_COLUMNS: ProjectStatus[] = ["backlog", "in_progress", "in_review", "done"];
const COLUMN_LABELS: Record<ProjectStatus, string> = { backlog: "Backlog", in_progress: "In Progress", in_review: "In Review", done: "Done" };
const COLUMN_COLORS: Record<ProjectStatus, string> = { backlog: "#6b7280", in_progress: "#3b82f6", in_review: "#8b5cf6", done: "#22c55e" };

function KanbanProjectCard({ item, isDragging, isGroupedOver, style }: BoardItemViewProps<SampleProject>) {
    const project = item.data;
    const priorityCfg = PRIORITY_CONFIG[project.priority];
    const isOverdue = new Date(project.dueDate) < new Date() && project.status !== "done";

    const backgroundColor = useMemo((): string => {
        if (isDragging) return "bg-surface-100 dark:bg-surface-800";
        if (isGroupedOver) return "bg-surface-200 dark:bg-surface-700";
        return "bg-white dark:bg-surface-800 hover:bg-surface-50 dark:hover:bg-surface-700";
    }, [isDragging, isGroupedOver]);

    const borderColor = useMemo((): string => isDragging ? "ring-2 ring-primary" : "", [isDragging]);

    return (
        <div style={style} className="py-1" data-testid={item.id}>
            <div className={cls("group/card p-2 flex items-start border rounded-lg cursor-pointer transition-all duration-200", defaultBorderMixin, borderColor, backgroundColor, "hover:shadow-sm")}>
                <div className="w-10 h-10 rounded-md shrink-0 mr-2 bg-surface-100 dark:bg-surface-900 flex items-center justify-center">
                    <FolderKanbanIcon size={16} className="text-surface-400" />
                </div>
                <div className="flex-1 min-w-0">
                    <div className="line-clamp-2 text-sm font-medium">{project.name}</div>
                    <div className="text-xs text-surface-500 mt-1 line-clamp-2 opacity-80">{project.description}</div>
                    <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                        <Chip colorScheme={priorityCfg.color} size="smallest" outlined className="!text-[10px] !leading-tight !py-0">{priorityCfg.label}</Chip>
                        {project.tags.slice(0, 2).map(tag => <Chip key={tag} size="smallest" colorScheme="cyan" className="!text-[10px] !leading-tight !py-0 max-w-[80px] truncate">{tag}</Chip>)}
                    </div>
                    <div className="flex items-center justify-between mt-1.5">
                        <div className="flex items-center gap-1">
                            <div className="w-4 h-4 rounded-full bg-surface-200 dark:bg-surface-700 text-surface-500 flex items-center justify-center text-[8px] font-semibold">{project.assignee[0]}</div>
                            <Typography variant="caption" color="secondary" className="truncate max-w-[80px] text-[10px]">{project.assignee}</Typography>
                        </div>
                        <Typography variant="caption" className={cls("font-mono text-[10px]", isOverdue ? "text-red-500 font-semibold" : "text-surface-400")}>{project.dueDate}</Typography>
                    </div>
                </div>
            </div>
        </div>
    );
}

export function KanbanBoardDemo() {
    const [boardData, setBoardData] = useState<BoardItem<SampleProject>[]>(() => SAMPLE_PROJECTS.map(p => ({ id: p.id, data: p })));
    const [columns, setColumns] = useState<ProjectStatus[]>(STATUS_COLUMNS);

    const assignColumn = useCallback((item: BoardItem<SampleProject>): ProjectStatus => item.data.status, []);

    const handleItemsReorder = useCallback((items: BoardItem<SampleProject>[], moveInfo?: { itemId: string; sourceColumn: ProjectStatus; targetColumn: ProjectStatus }) => {
        const updatedItems = items.map(item => {
            if (moveInfo && item.id === moveInfo.itemId && moveInfo.sourceColumn !== moveInfo.targetColumn) {
                return { ...item, data: { ...item.data, status: moveInfo.targetColumn, progress: moveInfo.targetColumn === "done" ? 100 : item.data.progress } };
            }
            return item;
        });
        setBoardData(updatedItems);
    }, []);

    const handleColumnReorder = useCallback((reordered: ProjectStatus[]) => setColumns(reordered), []);

    const columnLoadingState = useMemo(() => {
        const state: Record<string, { loading: boolean; hasMore: boolean; itemCount: number; totalCount: number }> = {};
        for (const col of columns) {
            const count = boardData.filter(item => item.data.status === col).length;
            state[col] = { loading: false, hasMore: false, itemCount: count, totalCount: count };
        }
        return state;
    }, [boardData, columns]);

    return (
        <div className="space-y-3">
            <Alert color="info" size="small">Drag and drop cards between columns to change status. Columns are also reorderable.</Alert>
            <div className={cls("rounded-lg border overflow-hidden", defaultBorderMixin)} style={{ height: 520 }}>
                <KanbanView<SampleProject, ProjectStatus>
                    data={boardData} columns={columns} columnLabels={COLUMN_LABELS} columnColors={COLUMN_COLORS}
                    assignColumn={assignColumn} allowColumnReorder={true} onColumnReorder={handleColumnReorder}
                    onItemsReorder={handleItemsReorder} ItemComponent={KanbanProjectCard} columnLoadingState={columnLoadingState}
                />
            </div>
        </div>
    );
}
