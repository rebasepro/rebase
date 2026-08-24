import React from "react";
import { CollectionView } from "@rebasepro/ui";
import type { CollectionPropertyConfig, CollectionDataController } from "@rebasepro/ui";

interface SampleProject extends Record<string, unknown> {
    id: string;
    name: string;
    status: string;
    priority: string;
    assignee: string;
    tags: string[];
    dueDate: string;
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
    dueDate: { type: "date", name: "Due Date" }
};

const SAMPLE_PROJECTS: SampleProject[] = [
    { id: "proj-1", name: "Website Redesign", status: "in_progress", priority: "high", assignee: "Alice Johnson", tags: ["frontend", "design"], dueDate: "2026-08-07" },
    { id: "proj-2", name: "API Rate Limiting", status: "in_review", priority: "critical", assignee: "Bob Smith", tags: ["backend", "security"], dueDate: "2026-08-02" },
    { id: "proj-3", name: "Mobile Push Notifications", status: "backlog", priority: "medium", assignee: "Carol White", tags: ["mobile", "backend"], dueDate: "2026-08-21" },
    { id: "proj-4", name: "Dashboard Analytics", status: "in_progress", priority: "high", assignee: "David Brown", tags: ["frontend", "data"], dueDate: "2026-08-05" },
    { id: "proj-5", name: "User Onboarding Flow", status: "done", priority: "medium", assignee: "Eva Green", tags: ["frontend", "ux"], dueDate: "2026-07-29" },
    { id: "proj-6", name: "Database Migration v3", status: "backlog", priority: "low", assignee: "Frank Miller", tags: ["backend", "infrastructure"], dueDate: "2026-08-30" },
    { id: "proj-7", name: "SSO Integration", status: "in_progress", priority: "critical", assignee: "Alice Johnson", tags: ["backend", "security"], dueDate: "2026-08-03" },
    { id: "proj-8", name: "E2E Test Suite", status: "in_review", priority: "medium", assignee: "Bob Smith", tags: ["testing", "devops"], dueDate: "2026-08-01" },
    { id: "proj-9", name: "Billing System Upgrade", status: "done", priority: "high", assignee: "Carol White", tags: ["backend", "payments"], dueDate: "2026-07-26" },
    { id: "proj-10", name: "Dark Mode Polish", status: "backlog", priority: "low", assignee: "David Brown", tags: ["frontend", "design"], dueDate: "2026-08-14" }
];

const dataController: CollectionDataController<SampleProject> = {
    data: SAMPLE_PROJECTS,
    loading: false,
    noMoreToLoad: true
};

export function TableMode() {
    return (
        <div style={{ height: 460 }} className="w-full">
            <CollectionView<SampleProject>
                dataController={dataController}
                properties={properties}
                idProperty="id"
                titleProperty="name"
                defaultViewMode="table"
                enabledViews={["list", "table", "cards", "kanban"]}
            />
        </div>
    );
}

export function KanbanMode() {
    return (
        <div style={{ height: 500 }} className="w-full">
            <CollectionView<SampleProject>
                dataController={dataController}
                properties={properties}
                idProperty="id"
                titleProperty="name"
                defaultViewMode="kanban"
                kanbanProperty="status"
                enabledViews={["list", "table", "cards", "kanban"]}
            />
        </div>
    );
}
