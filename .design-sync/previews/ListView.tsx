import React from "react";
import {
    ListView,
    Typography,
    Chip,
    cls,
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
    { id: "proj-1", name: "Website Redesign", description: "Complete overhaul of the marketing website with new brand guidelines", status: "in_progress", priority: "high", assignee: "Alice Johnson", tags: ["frontend", "design"], dueDate: "2026-08-07" },
    { id: "proj-2", name: "API Rate Limiting", description: "Implement token-bucket rate limiting across all public endpoints", status: "in_review", priority: "critical", assignee: "Bob Smith", tags: ["backend", "security"], dueDate: "2026-08-02" },
    { id: "proj-3", name: "Mobile Push Notifications", description: "Add support for push notifications on iOS and Android clients", status: "backlog", priority: "medium", assignee: "Carol White", tags: ["mobile", "backend"], dueDate: "2026-08-21" },
    { id: "proj-4", name: "Dashboard Analytics", description: "Build real-time analytics dashboard with charts and KPI widgets", status: "in_progress", priority: "high", assignee: "David Brown", tags: ["frontend", "data"], dueDate: "2026-08-05" },
    { id: "proj-5", name: "User Onboarding Flow", description: "Multi-step onboarding wizard with progress tracking and email triggers", status: "done", priority: "medium", assignee: "Eva Green", tags: ["frontend", "ux"], dueDate: "2026-07-29" },
    { id: "proj-6", name: "Database Migration v3", description: "Migrate from PostgreSQL 14 to 16 with zero-downtime strategy", status: "backlog", priority: "low", assignee: "Frank Miller", tags: ["backend", "infrastructure"], dueDate: "2026-08-30" },
    { id: "proj-7", name: "SSO Integration", description: "SAML 2.0 and OIDC single sign-on for enterprise customers", status: "in_progress", priority: "critical", assignee: "Alice Johnson", tags: ["backend", "security", "enterprise"], dueDate: "2026-08-03" },
    { id: "proj-8", name: "E2E Test Suite", description: "Playwright-based end-to-end tests covering critical user journeys", status: "in_review", priority: "medium", assignee: "Bob Smith", tags: ["testing", "devops"], dueDate: "2026-08-01" }
];

function renderRow(params: {
    item: SampleProject;
    index: number;
    style: React.CSSProperties;
    className: string;
    selected: boolean;
    highlighted: boolean;
    isLast: boolean;
    onClick: (e: React.MouseEvent) => void;
    onSelectionChange: (selected: boolean) => void;
}) {
    const { item, style, className, selected, onClick } = params;
    const statusCfg = STATUS_CONFIG[item.status];
    const priorityCfg = PRIORITY_CONFIG[item.priority];
    return (
        <div
            style={style}
            className={cls(
                "flex items-center gap-3 px-4 cursor-pointer",
                selected && "ring-1 ring-primary",
                className
            )}
            onClick={onClick}
        >
            <div className="flex-1 min-w-0 py-1">
                <Typography variant="subtitle2" noWrap>{item.name}</Typography>
                <div className="flex items-center gap-2 flex-wrap">
                    <Chip colorScheme={statusCfg.color} size="smallest">{statusCfg.label}</Chip>
                    <Chip colorScheme={priorityCfg.color} size="smallest" outlined>{priorityCfg.label}</Chip>
                    <Typography variant="caption" color="secondary">{item.assignee}</Typography>
                </div>
            </div>
            <Typography variant="caption" color="secondary" className="font-mono">{item.dueDate}</Typography>
        </div>
    );
}

export function ProjectList() {
    return (
        <div style={{ height: 420 }} className="w-full overflow-auto">
            <ListView<SampleProject>
                data={SAMPLE_PROJECTS}
                dataLoading={false}
                noMoreToLoad={true}
                paginationEnabled={false}
                size="l"
                renderRow={renderRow}
            />
        </div>
    );
}
