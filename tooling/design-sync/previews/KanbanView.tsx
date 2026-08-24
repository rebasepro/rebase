import React, { useState, useCallback, useMemo } from "react";
import { Typography, Chip, cls, KanbanView, FolderKanbanIcon } from "@rebasepro/ui";
import type { BoardItem, BoardItemViewProps, ChipHue } from "@rebasepro/ui";

type ProjectStatus = "backlog" | "in_progress" | "in_review" | "done";
type ProjectPriority = "low" | "medium" | "high" | "critical";

interface SampleProject {
    id: string;
    name: string;
    description: string;
    status: ProjectStatus;
    priority: ProjectPriority;
    assignee: string;
    tags: string[];
    dueDate: string;
}

const PRIORITY_CONFIG: Record<ProjectPriority, { label: string; color: ChipHue }> = {
    low: { label: "Low", color: "gray" },
    medium: { label: "Medium", color: "yellow" },
    high: { label: "High", color: "orange" },
    critical: { label: "Critical", color: "red" }
};

const STATUS_COLUMNS: ProjectStatus[] = ["backlog", "in_progress", "in_review", "done"];
const COLUMN_LABELS: Record<ProjectStatus, string> = { backlog: "Backlog", in_progress: "In Progress", in_review: "In Review", done: "Done" };
const COLUMN_COLORS: Record<ProjectStatus, string> = { backlog: "#6b7280", in_progress: "#3b82f6", in_review: "#8b5cf6", done: "#22c55e" };

const SAMPLE_PROJECTS: SampleProject[] = [
    { id: "proj-1", name: "Website Redesign", description: "Complete overhaul of the marketing website with new brand guidelines", status: "in_progress", priority: "high", assignee: "Alice Johnson", tags: ["frontend", "design"], dueDate: "2026-08-07" },
    { id: "proj-2", name: "API Rate Limiting", description: "Implement token-bucket rate limiting across all public endpoints", status: "in_review", priority: "critical", assignee: "Bob Smith", tags: ["backend", "security"], dueDate: "2026-08-02" },
    { id: "proj-3", name: "Mobile Push Notifications", description: "Add support for push notifications on iOS and Android clients", status: "backlog", priority: "medium", assignee: "Carol White", tags: ["mobile", "backend"], dueDate: "2026-08-21" },
    { id: "proj-4", name: "Dashboard Analytics", description: "Build real-time analytics dashboard with charts and KPI widgets", status: "in_progress", priority: "high", assignee: "David Brown", tags: ["frontend", "data"], dueDate: "2026-08-05" },
    { id: "proj-5", name: "User Onboarding Flow", description: "Multi-step onboarding wizard with progress tracking and email triggers", status: "done", priority: "medium", assignee: "Eva Green", tags: ["frontend", "ux"], dueDate: "2026-07-29" },
    { id: "proj-6", name: "Database Migration v3", description: "Migrate from PostgreSQL 14 to 16 with zero-downtime strategy", status: "backlog", priority: "low", assignee: "Frank Miller", tags: ["backend", "infrastructure"], dueDate: "2026-08-30" },
    { id: "proj-7", name: "SSO Integration", description: "SAML 2.0 and OIDC single sign-on for enterprise customers", status: "in_progress", priority: "critical", assignee: "Alice Johnson", tags: ["backend", "security", "enterprise"], dueDate: "2026-08-03" },
    { id: "proj-8", name: "E2E Test Suite", description: "Playwright-based end-to-end tests covering critical user journeys", status: "in_review", priority: "medium", assignee: "Bob Smith", tags: ["testing", "devops"], dueDate: "2026-08-01" },
    { id: "proj-9", name: "Billing System Upgrade", description: "Stripe integration upgrade with metered billing and invoice PDF generation", status: "done", priority: "high", assignee: "Carol White", tags: ["backend", "payments"], dueDate: "2026-07-26" },
    { id: "proj-10", name: "Dark Mode Polish", description: "Audit and fix all remaining dark mode inconsistencies across the app", status: "backlog", priority: "low", assignee: "David Brown", tags: ["frontend", "design"], dueDate: "2026-08-14" }
];

function KanbanProjectCard({ item, isDragging, isGroupedOver, style }: BoardItemViewProps<SampleProject>) {
    const project = item.data;
    const priorityCfg = PRIORITY_CONFIG[project.priority];

    const backgroundColor = isDragging
        ? "bg-surface-100 dark:bg-surface-800"
        : isGroupedOver
            ? "bg-surface-200 dark:bg-surface-700"
            : "bg-white dark:bg-surface-800";

    return (
        <div style={style} className="py-1">
            <div className={cls("p-2 flex items-start border rounded-lg border-surface-200 dark:border-surface-800", backgroundColor, isDragging && "ring-2 ring-primary")}>
                <div className="w-10 h-10 rounded-md shrink-0 mr-2 bg-surface-100 dark:bg-surface-900 flex items-center justify-center">
                    <FolderKanbanIcon size={16} className="text-surface-400" />
                </div>
                <div className="flex-1 min-w-0">
                    <Typography variant="body2" className="font-medium line-clamp-2">{project.name}</Typography>
                    <Typography variant="caption" color="secondary" className="line-clamp-2">{project.description}</Typography>
                    <div className="flex items-center gap-1 mt-1 flex-wrap">
                        <Chip colorScheme={priorityCfg.color} size="smallest" outlined>{priorityCfg.label}</Chip>
                        {project.tags.slice(0, 1).map(tag => (
                            <Chip key={tag} size="smallest" colorScheme="cyan">{tag}</Chip>
                        ))}
                    </div>
                    <div className="flex items-center justify-between mt-1">
                        <Typography variant="caption" color="secondary">{project.assignee}</Typography>
                        <Typography variant="caption" color="secondary" className="font-mono">{project.dueDate}</Typography>
                    </div>
                </div>
            </div>
        </div>
    );
}

export function ProjectBoard() {
    const [boardData, setBoardData] = useState<BoardItem<SampleProject>[]>(() => SAMPLE_PROJECTS.map(p => ({ id: p.id, data: p })));
    const [columns, setColumns] = useState<ProjectStatus[]>(STATUS_COLUMNS);

    const assignColumn = useCallback((item: BoardItem<SampleProject>): ProjectStatus => item.data.status, []);

    const handleItemsReorder = useCallback((items: BoardItem<SampleProject>[], moveInfo?: { itemId: string; sourceColumn: ProjectStatus; targetColumn: ProjectStatus }) => {
        const updatedItems = items.map(item => {
            if (moveInfo && item.id === moveInfo.itemId && moveInfo.sourceColumn !== moveInfo.targetColumn) {
                return { ...item, data: { ...item.data, status: moveInfo.targetColumn } };
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
        <div style={{ height: 480 }} className="w-full rounded-lg border border-surface-200 dark:border-surface-800 overflow-hidden">
            <KanbanView<SampleProject, ProjectStatus>
                data={boardData}
                columns={columns}
                columnLabels={COLUMN_LABELS}
                columnColors={COLUMN_COLORS}
                assignColumn={assignColumn}
                allowColumnReorder={true}
                onColumnReorder={handleColumnReorder}
                onItemsReorder={handleItemsReorder}
                ItemComponent={KanbanProjectCard}
                columnLoadingState={columnLoadingState}
            />
        </div>
    );
}
