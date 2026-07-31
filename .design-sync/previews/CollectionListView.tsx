import React from "react";
import { CollectionListView } from "@rebasepro/ui";
import type { CollectionPropertyConfig, CollectionDataController } from "@rebasepro/ui";

interface SampleProject extends Record<string, unknown> {
    id: string;
    name: string;
    status: string;
    priority: string;
    assignee: string;
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
    assignee: { type: "string", name: "Assignee", hideFromCollection: true },
    dueDate: { type: "date", name: "Due Date" }
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

const dataController: CollectionDataController<SampleProject> = {
    data: SAMPLE_PROJECTS,
    loading: false,
    noMoreToLoad: true
};

export function ProjectList() {
    return (
        <div style={{ height: 420 }} className="w-full">
            <CollectionListView<SampleProject>
                dataController={dataController}
                properties={properties}
                idProperty="id"
                size="m"
                selectionEnabled
            />
        </div>
    );
}
