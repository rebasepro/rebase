import React from "react";
import {
    CardView,
    Card,
    Typography,
    Chip,
    cls,
    FolderKanbanIcon,
    type ChipHue
} from "@rebasepro/ui";

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
    progress: number;
}

const STATUS_CONFIG: Record<ProjectStatus, { label: string; color: ChipHue }> = {
    backlog: { label: "Backlog", color: "gray" },
    in_progress: { label: "In Progress", color: "blue" },
    in_review: { label: "In Review", color: "purple" },
    done: { label: "Done", color: "green" }
};

const PRIORITY_CONFIG: Record<ProjectPriority, { label: string; color: ChipHue }> = {
    low: { label: "Low", color: "gray" },
    medium: { label: "Medium", color: "yellow" },
    high: { label: "High", color: "orange" },
    critical: { label: "Critical", color: "red" }
};

const SAMPLE_PROJECTS: SampleProject[] = [
    { id: "proj-1", name: "Website Redesign", description: "Complete overhaul of the marketing website with new brand guidelines", status: "in_progress", priority: "high", assignee: "Alice Johnson", tags: ["frontend", "design"], dueDate: "2026-08-07", progress: 65 },
    { id: "proj-2", name: "API Rate Limiting", description: "Implement token-bucket rate limiting across all public endpoints", status: "in_review", priority: "critical", assignee: "Bob Smith", tags: ["backend", "security"], dueDate: "2026-08-02", progress: 90 },
    { id: "proj-3", name: "Mobile Push Notifications", description: "Add support for push notifications on iOS and Android clients", status: "backlog", priority: "medium", assignee: "Carol White", tags: ["mobile", "backend"], dueDate: "2026-08-21", progress: 0 },
    { id: "proj-4", name: "Dashboard Analytics", description: "Build real-time analytics dashboard with charts and KPI widgets", status: "in_progress", priority: "high", assignee: "David Brown", tags: ["frontend", "data"], dueDate: "2026-08-05", progress: 40 },
    { id: "proj-5", name: "User Onboarding Flow", description: "Multi-step onboarding wizard with progress tracking and email triggers", status: "done", priority: "medium", assignee: "Eva Green", tags: ["frontend", "ux"], dueDate: "2026-07-29", progress: 100 },
    { id: "proj-7", name: "SSO Integration", description: "SAML 2.0 and OIDC single sign-on for enterprise customers", status: "in_progress", priority: "critical", assignee: "Alice Johnson", tags: ["backend", "security", "enterprise"], dueDate: "2026-08-03", progress: 75 },
    { id: "proj-8", name: "E2E Test Suite", description: "Playwright-based end-to-end tests covering critical user journeys", status: "in_review", priority: "medium", assignee: "Bob Smith", tags: ["testing", "devops"], dueDate: "2026-08-01", progress: 85 },
    { id: "proj-9", name: "Billing System Upgrade", description: "Stripe integration upgrade with metered billing and invoice PDF generation", status: "done", priority: "high", assignee: "Carol White", tags: ["backend", "payments"], dueDate: "2026-07-26", progress: 100 }
];

function renderCard(
    item: SampleProject,
    extra: {
        selected: boolean;
        highlighted: boolean;
        onSelectionChange: (selected: boolean) => void;
        onClick: (e: React.MouseEvent) => void;
    }
) {
    const statusCfg = STATUS_CONFIG[item.status];
    const priorityCfg = PRIORITY_CONFIG[item.priority];
    return (
        <Card
            onClick={(e) => { if (e) extra.onClick(e); }}
            className={cls("overflow-hidden cursor-pointer", extra.selected && "ring-1 ring-primary")}
        >
            <div className="h-24 bg-surface-100 dark:bg-surface-900 flex items-center justify-center relative">
                <FolderKanbanIcon size={24} className="text-surface-400" />
                <div className="absolute top-2 right-2">
                    <Chip colorScheme={priorityCfg.color} size="smallest" outlined>{priorityCfg.label}</Chip>
                </div>
            </div>
            <div className="p-3">
                <Typography variant="subtitle2" noWrap>{item.name}</Typography>
                <Typography variant="caption" color="secondary" className="line-clamp-2">{item.description}</Typography>
                <div className="flex items-center gap-2 flex-wrap mt-2">
                    <Chip colorScheme={statusCfg.color} size="smallest">{statusCfg.label}</Chip>
                    {item.tags.slice(0, 2).map(tag => (
                        <Chip key={tag} size="smallest" colorScheme="cyan">{tag}</Chip>
                    ))}
                </div>
            </div>
        </Card>
    );
}

export function ProjectGrid() {
    return (
        <div style={{ height: 480 }} className="w-full overflow-auto rounded-lg border border-surface-200 dark:border-surface-800">
            <CardView<SampleProject>
                data={SAMPLE_PROJECTS}
                dataLoading={false}
                noMoreToLoad={true}
                paginationEnabled={false}
                size="m"
                selectionEnabled
                renderCard={renderCard}
            />
        </div>
    );
}
