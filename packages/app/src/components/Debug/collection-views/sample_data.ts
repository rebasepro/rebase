import type { ChipColorKey } from "@rebasepro/ui";

export type ProjectStatus = "backlog" | "in_progress" | "in_review" | "done";
export type ProjectPriority = "low" | "medium" | "high" | "critical";

export interface SampleProject {
    id: string;
    name: string;
    description: string;
    status: ProjectStatus;
    priority: ProjectPriority;
    assignee: string;
    tags: string[];
    dueDate: string;
    progress: number;
    createdAt: string;
}

export const STATUS_CONFIG: Record<ProjectStatus, { label: string; color: ChipColorKey }> = {
    backlog: { label: "Backlog", color: "gray" },
    in_progress: { label: "In Progress", color: "blue" },
    in_review: { label: "In Review", color: "purple" },
    done: { label: "Done", color: "green" }
};

export const PRIORITY_CONFIG: Record<ProjectPriority, { label: string; color: ChipColorKey }> = {
    low: { label: "Low", color: "gray" },
    medium: { label: "Medium", color: "yellow" },
    high: { label: "High", color: "orange" },
    critical: { label: "Critical", color: "red" }
};

export const SAMPLE_PROJECTS: SampleProject[] = [
    { id: "proj-1", name: "Website Redesign", description: "Complete overhaul of the marketing website with new brand guidelines", status: "in_progress", priority: "high", assignee: "Alice Johnson", tags: ["frontend", "design"], dueDate: new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0], progress: 65, createdAt: new Date(Date.now() - 14 * 86400000).toISOString() },
    { id: "proj-2", name: "API Rate Limiting", description: "Implement token-bucket rate limiting across all public endpoints", status: "in_review", priority: "critical", assignee: "Bob Smith", tags: ["backend", "security"], dueDate: new Date(Date.now() + 2 * 86400000).toISOString().split("T")[0], progress: 90, createdAt: new Date(Date.now() - 10 * 86400000).toISOString() },
    { id: "proj-3", name: "Mobile Push Notifications", description: "Add support for push notifications on iOS and Android clients", status: "backlog", priority: "medium", assignee: "Carol White", tags: ["mobile", "backend"], dueDate: new Date(Date.now() + 21 * 86400000).toISOString().split("T")[0], progress: 0, createdAt: new Date(Date.now() - 3 * 86400000).toISOString() },
    { id: "proj-4", name: "Dashboard Analytics", description: "Build real-time analytics dashboard with charts and KPI widgets", status: "in_progress", priority: "high", assignee: "David Brown", tags: ["frontend", "data"], dueDate: new Date(Date.now() + 5 * 86400000).toISOString().split("T")[0], progress: 40, createdAt: new Date(Date.now() - 7 * 86400000).toISOString() },
    { id: "proj-5", name: "User Onboarding Flow", description: "Multi-step onboarding wizard with progress tracking and email triggers", status: "done", priority: "medium", assignee: "Eva Green", tags: ["frontend", "ux"], dueDate: new Date(Date.now() - 2 * 86400000).toISOString().split("T")[0], progress: 100, createdAt: new Date(Date.now() - 21 * 86400000).toISOString() },
    { id: "proj-6", name: "Database Migration v3", description: "Migrate from PostgreSQL 14 to 16 with zero-downtime strategy", status: "backlog", priority: "low", assignee: "Frank Miller", tags: ["backend", "infrastructure"], dueDate: new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0], progress: 0, createdAt: new Date(Date.now() - 1 * 86400000).toISOString() },
    { id: "proj-7", name: "SSO Integration", description: "SAML 2.0 and OIDC single sign-on for enterprise customers", status: "in_progress", priority: "critical", assignee: "Alice Johnson", tags: ["backend", "security", "enterprise"], dueDate: new Date(Date.now() + 3 * 86400000).toISOString().split("T")[0], progress: 75, createdAt: new Date(Date.now() - 12 * 86400000).toISOString() },
    { id: "proj-8", name: "E2E Test Suite", description: "Playwright-based end-to-end tests covering critical user journeys", status: "in_review", priority: "medium", assignee: "Bob Smith", tags: ["testing", "devops"], dueDate: new Date(Date.now() + 1 * 86400000).toISOString().split("T")[0], progress: 85, createdAt: new Date(Date.now() - 8 * 86400000).toISOString() },
    { id: "proj-9", name: "Billing System Upgrade", description: "Stripe integration upgrade with metered billing and invoice PDF generation", status: "done", priority: "high", assignee: "Carol White", tags: ["backend", "payments"], dueDate: new Date(Date.now() - 5 * 86400000).toISOString().split("T")[0], progress: 100, createdAt: new Date(Date.now() - 28 * 86400000).toISOString() },
    { id: "proj-10", name: "Dark Mode Polish", description: "Audit and fix all remaining dark mode inconsistencies across the app", status: "backlog", priority: "low", assignee: "David Brown", tags: ["frontend", "design"], dueDate: new Date(Date.now() + 14 * 86400000).toISOString().split("T")[0], progress: 0, createdAt: new Date(Date.now() - 2 * 86400000).toISOString() }
];
