import React from "react";
import {
    TableView,
    Typography,
    Chip
} from "@rebasepro/ui";
import type { CellRendererParams } from "@rebasepro/ui";

type ProjectStatus = "backlog" | "in_progress" | "in_review" | "done";
type ProjectPriority = "low" | "medium" | "high" | "critical";

interface SampleProject extends Record<string, unknown> {
    id: string;
    name: string;
    status: ProjectStatus;
    priority: ProjectPriority;
    assignee: string;
    dueDate: string;
}

const STATUS_CONFIG: Record<ProjectStatus, { label: string; color: string }> = {
    backlog: { label: "Backlog", color: "gray" },
    in_progress: { label: "In Progress", color: "blue" },
    in_review: { label: "In Review", color: "purple" },
    done: { label: "Done", color: "green" }
};

const PRIORITY_CONFIG: Record<ProjectPriority, { label: string; color: string }> = {
    low: { label: "Low", color: "gray" },
    medium: { label: "Medium", color: "yellow" },
    high: { label: "High", color: "orange" },
    critical: { label: "Critical", color: "red" }
};

const SAMPLE_PROJECTS: SampleProject[] = [
    { id: "proj-1", name: "Website Redesign", status: "in_progress", priority: "high", assignee: "Alice Johnson", dueDate: "2026-08-07" },
    { id: "proj-2", name: "API Rate Limiting", status: "in_review", priority: "critical", assignee: "Bob Smith", dueDate: "2026-08-02" },
    { id: "proj-3", name: "Mobile Push Notifications", status: "backlog", priority: "medium", assignee: "Carol White", dueDate: "2026-08-21" },
    { id: "proj-4", name: "Dashboard Analytics", status: "in_progress", priority: "high", assignee: "David Brown", dueDate: "2026-08-05" },
    { id: "proj-5", name: "User Onboarding Flow", status: "done", priority: "medium", assignee: "Eva Green", dueDate: "2026-07-29" },
    { id: "proj-6", name: "Database Migration v3", status: "backlog", priority: "low", assignee: "Frank Miller", dueDate: "2026-08-30" },
    { id: "proj-7", name: "SSO Integration", status: "in_progress", priority: "critical", assignee: "Alice Johnson", dueDate: "2026-08-03" },
    { id: "proj-8", name: "E2E Test Suite", status: "in_review", priority: "medium", assignee: "Bob Smith", dueDate: "2026-08-01" },
    { id: "proj-9", name: "Billing System Upgrade", status: "done", priority: "high", assignee: "Carol White", dueDate: "2026-07-26" },
    { id: "proj-10", name: "Dark Mode Polish", status: "backlog", priority: "low", assignee: "David Brown", dueDate: "2026-08-14" }
];

const columns = [
    { key: "name", title: "Name", width: 220, sortable: true, resizable: true },
    { key: "status", title: "Status", width: 140, sortable: true, resizable: true },
    { key: "priority", title: "Priority", width: 130, sortable: true, resizable: true },
    { key: "assignee", title: "Assignee", width: 160, resizable: true },
    { key: "dueDate", title: "Due Date", width: 130, sortable: true, resizable: true }
];

function cellRenderer({ column, rowData }: CellRendererParams<SampleProject>) {
    if (!rowData) return null;
    const value = rowData[column.key];
    if (column.key === "status") {
        const cfg = STATUS_CONFIG[value as ProjectStatus];
        return <div className="flex items-center h-full px-1"><Chip colorScheme={cfg.color} size="small">{cfg.label}</Chip></div>;
    }
    if (column.key === "priority") {
        const cfg = PRIORITY_CONFIG[value as ProjectPriority];
        return <div className="flex items-center h-full px-1"><Chip colorScheme={cfg.color} size="smallest" outlined>{cfg.label}</Chip></div>;
    }
    if (column.key === "dueDate") {
        return <div className="flex items-center h-full px-1"><Typography variant="body2" className="font-mono">{String(value)}</Typography></div>;
    }
    return <div className="flex items-center h-full px-1"><Typography variant="body2" noWrap>{String(value ?? "")}</Typography></div>;
}

export function ProjectTable() {
    return (
        <div style={{ height: 420 }} className="w-full rounded-lg border border-surface-200 dark:border-surface-800 overflow-hidden">
            <TableView<SampleProject>
                data={SAMPLE_PROJECTS}
                columns={columns}
                cellRenderer={cellRenderer}
                rowHeight={44}
                hoverRow
                sortBy={["dueDate", "asc"]}
            />
        </div>
    );
}
