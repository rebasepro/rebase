import React from "react";
import { CollectionTableView } from "@rebasepro/ui";
import type { CollectionPropertyConfig, CollectionDataController } from "@rebasepro/ui";

interface SampleProject extends Record<string, unknown> {
    id: string;
    name: string;
    status: string;
    priority: string;
    assignee: string;
    tags: string[];
    dueDate: string;
    progress: number;
}

const properties: Record<string, CollectionPropertyConfig> = {
    name: { type: "string", name: "Name" },
    status: {
        type: "string",
        name: "Status",
        enum: {
            backlog: { label: "Backlog", color: "gray" },
            in_progress: { label: "In Progress", color: "blue" },
            in_review: { label: "In Review", color: "purple" },
            done: { label: "Done", color: "green" }
        }
    },
    priority: {
        type: "string",
        name: "Priority",
        enum: {
            low: { label: "Low", color: "gray" },
            medium: { label: "Medium", color: "yellow" },
            high: { label: "High", color: "orange" },
            critical: { label: "Critical", color: "red" }
        }
    },
    assignee: { type: "string", name: "Assignee" },
    tags: { type: "array", name: "Tags", of: { type: "string", name: "Tag" } },
    progress: { type: "number", name: "Progress" },
    dueDate: { type: "date", name: "Due Date" }
};

const SAMPLE_PROJECTS: SampleProject[] = [
    { id: "proj-1", name: "Website Redesign", status: "in_progress", priority: "high", assignee: "Alice Johnson", tags: ["frontend", "design"], progress: 65, dueDate: "2026-08-07" },
    { id: "proj-2", name: "API Rate Limiting", status: "in_review", priority: "critical", assignee: "Bob Smith", tags: ["backend", "security"], progress: 90, dueDate: "2026-08-02" },
    { id: "proj-3", name: "Mobile Push Notifications", status: "backlog", priority: "medium", assignee: "Carol White", tags: ["mobile", "backend"], progress: 0, dueDate: "2026-08-21" },
    { id: "proj-4", name: "Dashboard Analytics", status: "in_progress", priority: "high", assignee: "David Brown", tags: ["frontend", "data"], progress: 40, dueDate: "2026-08-05" },
    { id: "proj-5", name: "User Onboarding Flow", status: "done", priority: "medium", assignee: "Eva Green", tags: ["frontend", "ux"], progress: 100, dueDate: "2026-07-29" },
    { id: "proj-6", name: "Database Migration v3", status: "backlog", priority: "low", assignee: "Frank Miller", tags: ["backend", "infrastructure"], progress: 0, dueDate: "2026-08-30" },
    { id: "proj-7", name: "SSO Integration", status: "in_progress", priority: "critical", assignee: "Alice Johnson", tags: ["backend", "security"], progress: 75, dueDate: "2026-08-03" },
    { id: "proj-8", name: "E2E Test Suite", status: "in_review", priority: "medium", assignee: "Bob Smith", tags: ["testing", "devops"], progress: 85, dueDate: "2026-08-01" },
    { id: "proj-9", name: "Billing System Upgrade", status: "done", priority: "high", assignee: "Carol White", tags: ["backend", "payments"], progress: 100, dueDate: "2026-07-26" },
    { id: "proj-10", name: "Dark Mode Polish", status: "backlog", priority: "low", assignee: "David Brown", tags: ["frontend", "design"], progress: 0, dueDate: "2026-08-14" }
];

const dataController: CollectionDataController<SampleProject> = {
    data: SAMPLE_PROJECTS,
    loading: false,
    noMoreToLoad: true,
    sortBy: ["dueDate", "asc"]
};

export function ProjectTable() {
    return (
        <div style={{ height: 420 }} className="w-full rounded-lg border border-surface-200 dark:border-surface-800 overflow-hidden">
            <CollectionTableView<SampleProject>
                dataController={dataController}
                properties={properties}
                idProperty="id"
                size="m"
                hoverRow
            />
        </div>
    );
}
