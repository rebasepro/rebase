import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
    Typography,
    Button,
    cls,
    Container,
    Card,
    Alert,
    defaultBorderMixin,
    Separator,
    TextField,
    Select,
    SelectItem,
    RefreshCwIcon,
    UserPlus,
    XIcon,
    CheckIcon,
    MailIcon,
    PhoneIcon,
    CalendarIcon
} from "@rebasepro/ui";

import { DashboardMetrics } from "./DashboardMetrics";
import { PipelineOverview } from "./PipelineOverview";
import { RecentActivity } from "./RecentActivity";
import { TasksView } from "./TasksView";
import { CalendarWidget } from "./CalendarWidget";

/* ── Types ────────────────────────────────────────────── */

interface Client {
    id: string;
    name: string;
    email: string;
    phone: string;
    stage: string;
    picture?: string;
}

interface Task {
    id: string;
    values: {
        title: string;
        status: string;
        resolution: string | null;
        dueDate: string | null;
        stageId: string | null;
        description: string | null;
        notes: string | null;
        clientId: string | null;
        client?: { name?: string } | null;
        priority?: string | null;
        createdAt: string | null;
    };
}

interface Activity {
    id: string;
    values: {
        type: string;
        description: string;
        createdAt: string;
        metadata?: {
            taskId?: string;
            taskTitle?: string;
            subject?: string;
            body?: string;
            to?: string;
            mode?: string;
        };
    };
}

interface PipelineOption {
    id: string;
    name: string;
    isDefault: boolean;
    color: string;
}

interface PipelineStage {
    stageKey: string;
    label: string;
    shortLabel: string;
    color: string;
    icon: string;
    sortOrder: number;
    isTerminal: boolean;
    isLostStage: boolean;
    count: number;
}

/* ── Color map ────────────────────────────────────────── */

const COLOR_MAP: Record<string, string> = {
    blue: "#3b82f6",
    indigo: "#6366f1",
    purple: "#8b5cf6",
    yellow: "#eab308",
    teal: "#14b8a6",
    green: "#22c55e",
    orange: "#f97316",
    gray: "#6b7280",
    red: "#ef4444",
    pink: "#ec4899",
    sky: "#0ea5e9",
    amber: "#f59e0b"
};

function resolveColor(colorName: string): string {
    return COLOR_MAP[colorName] ?? COLOR_MAP.gray;
}

/* ── Stage Labels ──────────────────────────────────────── */

const STAGE_LABELS: Record<string, string> = {
    incoming: "Incoming",
    email_sent: "Intro Email",
    discovery_call: "Discovery",
    agreements: "Agreements",
    onboarding: "Onboarding",
    active: "Active",
    delivered: "Delivered",
    completed: "Done"
};

const PIPELINES: PipelineOption[] = [
    { id: "main", name: "Main Sales Pipeline", isDefault: true, color: "blue" },
    { id: "partnerships", name: "Partnerships Funnel", isDefault: false, color: "indigo" }
];

const INITIAL_STAGES: Record<string, Omit<PipelineStage, "count">[]> = {
    main: [
        { stageKey: "incoming", label: "Incoming", shortLabel: "Inbound", color: "blue", icon: "inbox", sortOrder: 1, isTerminal: false, isLostStage: false },
        { stageKey: "email_sent", label: "Intro Email", shortLabel: "Intro", color: "indigo", icon: "mail", sortOrder: 2, isTerminal: false, isLostStage: false },
        { stageKey: "discovery_call", label: "Discovery", shortLabel: "Disco", color: "purple", icon: "phone", sortOrder: 3, isTerminal: false, isLostStage: false },
        { stageKey: "agreements", label: "Agreements", shortLabel: "Contracts", color: "yellow", icon: "file-text", sortOrder: 4, isTerminal: false, isLostStage: false },
        { stageKey: "onboarding", label: "Onboarding", shortLabel: "Onboard", color: "teal", icon: "user-check", sortOrder: 5, isTerminal: false, isLostStage: false },
        { stageKey: "active", label: "Active", shortLabel: "Active", color: "green", icon: "activity", sortOrder: 6, isTerminal: false, isLostStage: false },
        { stageKey: "delivered", label: "Delivered", shortLabel: "Done", color: "orange", icon: "check-circle", sortOrder: 7, isTerminal: true, isLostStage: false },
        { stageKey: "completed", label: "Done", shortLabel: "Closed", color: "red", icon: "archive", sortOrder: 8, isTerminal: true, isLostStage: true }
    ],
    partnerships: [
        { stageKey: "incoming", label: "Outreach", shortLabel: "Outbound", color: "blue", icon: "send", sortOrder: 1, isTerminal: false, isLostStage: false },
        { stageKey: "discovery_call", label: "First Meeting", shortLabel: "Meet", color: "purple", icon: "users", sortOrder: 2, isTerminal: false, isLostStage: false },
        { stageKey: "agreements", label: "Proposal", shortLabel: "Prop", color: "yellow", icon: "file", sortOrder: 3, isTerminal: false, isLostStage: false },
        { stageKey: "active", label: "Partnered", shortLabel: "Live", color: "green", icon: "handshake", sortOrder: 4, isTerminal: true, isLostStage: false }
    ]
};

const INITIAL_CLIENTS: Client[] = [
    { id: "client-1", name: "Alice Johnson", email: "alice@johnson.com", phone: "+1 (555) 0192", stage: "discovery_call" },
    { id: "client-2", name: "Bob Smith", email: "bob@smith.co", phone: "+1 (555) 0143", stage: "email_sent" },
    { id: "client-3", name: "Carol White", email: "carol@whitecorp.com", phone: "+1 (555) 0188", stage: "agreements" },
    { id: "client-4", name: "David Brown", email: "david.b@brown.net", phone: "+1 (555) 0177", stage: "onboarding" },
    { id: "client-5", name: "Eva Green", email: "eva@greenllc.com", phone: "+1 (555) 0165", stage: "active" },
    { id: "client-6", name: "Frank Miller", email: "frank@miller.org", phone: "+1 (555) 0112", stage: "completed" },
];

const INITIAL_TASKS: Task[] = [
    {
        id: "task-1",
        values: {
            title: "Schedule discovery call",
            status: "pending",
            resolution: null,
            dueDate: new Date(Date.now() + 86400000).toISOString().split('T')[0],
            stageId: "discovery_call",
            clientId: "client-1",
            priority: "high",
            description: "Set up a 30-min Zoom call to discuss requirements and partnership scope.",
            notes: "Alice is in EST timezone, prefers morning slots.",
            createdAt: new Date(Date.now() - 172800000).toISOString()
        }
    },
    {
        id: "task-2",
        values: {
            title: "Draft partnership agreement",
            status: "pending",
            resolution: null,
            dueDate: new Date(Date.now() - 172800000).toISOString().split('T')[0], // overdue
            stageId: "agreements",
            clientId: "client-3",
            priority: "high",
            description: "Draft enterprise contract incorporating customized SLA definitions.",
            notes: "Carol requested special uptime guarantees in Appendix A.",
            createdAt: new Date(Date.now() - 345600000).toISOString()
        }
    },
    {
        id: "task-3",
        values: {
            title: "Send onboarding checklist",
            status: "pending",
            resolution: null,
            dueDate: new Date(Date.now() + 172800000).toISOString().split('T')[0],
            stageId: "onboarding",
            clientId: "client-4",
            priority: "medium",
            description: "Assemble welcome packet, Slack community invite link, and environment setup guidelines.",
            notes: "Must carbon copy David's CTO on all setup emails.",
            createdAt: new Date(Date.now() - 86400000).toISOString()
        }
    },
    {
        id: "task-4",
        values: {
            title: "Follow up on intro email",
            status: "pending",
            resolution: null,
            dueDate: new Date(Date.now() - 86400000).toISOString().split('T')[0], // overdue
            stageId: "email_sent",
            clientId: "client-2",
            priority: "medium",
            description: "Check if Bob had time to review the technical proposal sent last week.",
            notes: "Call if no email response by Friday.",
            createdAt: new Date(Date.now() - 259200000).toISOString()
        }
    },
    {
        id: "task-5",
        values: {
            title: "Review deliverables and request feedback",
            status: "pending",
            resolution: null,
            dueDate: new Date(Date.now() + 432000000).toISOString().split('T')[0],
            stageId: "active",
            clientId: "client-5",
            priority: "low",
            description: "Schedule final demo review, submit deliverables reports, and email feedback questionnaire.",
            notes: "",
            createdAt: new Date(Date.now() - 86400000).toISOString()
        }
    }
];

const INITIAL_COMPLETED_TASKS: Task[] = [
    {
        id: "task-comp-1",
        values: {
            title: "Review inbound request form",
            status: "completed",
            resolution: "verified",
            dueDate: new Date(Date.now() - 259200000).toISOString().split('T')[0],
            stageId: "incoming",
            clientId: "client-1",
            priority: "medium",
            description: "Analyze initial request details submitted via web form.",
            notes: "",
            createdAt: new Date(Date.now() - 345600000).toISOString()
        }
    },
    {
        id: "task-comp-2",
        values: {
            title: "Send pricing brochure",
            status: "completed",
            resolution: "sent",
            dueDate: new Date(Date.now() - 172800000).toISOString().split('T')[0],
            stageId: "email_sent",
            clientId: "client-2",
            priority: "medium",
            description: "Send standard PDF booklet outlining custom packages and service tiers.",
            notes: "",
            createdAt: new Date(Date.now() - 259200000).toISOString()
        }
    }
];

const INITIAL_ACTIVITIES: Activity[] = [
    {
        id: "act-1",
        values: {
            type: "email_sent",
            description: "Intro Email sent to Bob Smith",
            createdAt: new Date(Date.now() - 3600000).toISOString(),
            metadata: {
                subject: "Welcome to Rebase — Pricing Tiers & Guidelines",
                body: "Hi Bob,\n\nThanks for your interest in Rebase! I have attached our standard pricing sheet and product documentation for your review.\n\nLet's schedule a brief 15-minute call next week to answer any questions you might have.\n\nBest regards,\nFrancesco",
                to: "bob@smith.co",
                mode: "simulated"
            }
        }
    },
    {
        id: "act-2",
        values: {
            type: "agreements_sent",
            description: "Agreements sent to Carol White",
            createdAt: new Date(Date.now() - 14400000).toISOString(),
            metadata: {
                taskId: "task-2",
                taskTitle: "Draft partnership agreement"
            }
        }
    },
    {
        id: "act-3",
        values: {
            type: "incoming",
            description: "Incoming lead Alice Johnson created",
            createdAt: new Date(Date.now() - 86400000).toISOString()
        }
    },
    {
        id: "act-4",
        values: {
            type: "note",
            description: "Added a note for David Brown: 'Prefers Slack for communications'",
            createdAt: new Date(Date.now() - 172800000).toISOString()
        }
    }
];

/* ── Helpers ────────────────────────────────────────────── */

function getGreeting(): string {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
}

function getFormattedDate(): string {
    return new Date().toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric"
    });
}

/* ── Main Component ─────────────────────────────────────── */

export function CrmDashboardDemo() {
    const [loading, setLoading] = useState(true);
    const [activitiesLoading, setActivitiesLoading] = useState(true);

    // Persisted states for mock DB
    const [clients, setClients] = useState<Client[]>(INITIAL_CLIENTS);
    const [tasks, setTasks] = useState<Task[]>(INITIAL_TASKS);
    const [completedTasks, setCompletedTasks] = useState<Task[]>(INITIAL_COMPLETED_TASKS);
    const [activities, setActivities] = useState<Activity[]>(INITIAL_ACTIVITIES);

    const [selectedPipelineId, setSelectedPipelineId] = useState<string>("main");

    // Local Toast/Notifications
    const [toastMessage, setToastMessage] = useState<string | null>(null);

    // Drawer state (Mock side panel)
    const [activeSideEntity, setActiveSideEntity] = useState<{
        type: "task" | "client" | "new_client";
        id?: string;
    } | null>(null);

    // Email viewer state
    const [emailViewerOpen, setEmailViewerOpen] = useState(false);
    const [selectedEmail, setSelectedEmail] = useState<{ to: string; subject: string; body: string; html?: string; mode?: string } | null>(null);

    // Form states for adding new client
    const [newClientName, setNewClientName] = useState("");
    const [newClientEmail, setNewClientEmail] = useState("");
    const [newClientPhone, setNewClientPhone] = useState("");
    const [newClientStage, setNewClientStage] = useState("incoming");

    // Toggling tasks loading animation state
    const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set());
    const [recentlyToggledIds, setRecentlyToggledIds] = useState<Set<string>>(new Set());

    // Completed section pagination
    const [completedLoaded, setCompletedLoaded] = useState(false);
    const [loadingCompleted, setLoadingCompleted] = useState(false);

    // Trigger initial load skeletons
    useEffect(() => {
        const timer1 = setTimeout(() => setLoading(false), 450);
        const timer2 = setTimeout(() => setActivitiesLoading(false), 600);
        return () => {
            clearTimeout(timer1);
            clearTimeout(timer2);
        };
    }, []);

    // Show custom toast alert
    const showToast = useCallback((msg: string) => {
        setToastMessage(msg);
        const timer = setTimeout(() => setToastMessage(null), 3000);
        return () => clearTimeout(timer);
    }, []);

    // Load completed tasks simulation
    const handleExpandCompleted = useCallback(() => {
        if (completedLoaded) return;
        setLoadingCompleted(true);
        setTimeout(() => {
            setCompletedLoaded(true);
            setLoadingCompleted(false);
        }, 300);
    }, [completedLoaded]);

    const handleLoadMoreCompleted = useCallback(() => {
        setLoadingCompleted(true);
        setTimeout(() => {
            setLoadingCompleted(false);
            showToast("Loaded additional completed tasks.");
        }, 300);
    }, [showToast]);

    // Handle pipeline change
    const handlePipelineChange = useCallback((pipelineId: string) => {
        setSelectedPipelineId(pipelineId);
        setLoading(true);
        setTimeout(() => {
            setLoading(false);
            showToast(`Switched to ${PIPELINES.find(p => p.id === pipelineId)?.name}`);
        }, 200);
    }, [showToast]);

    // Derived maps
    const clientsMap = useMemo(() => {
        const map = new Map<string, { name: string; picture?: string }>();
        clients.forEach(c => map.set(c.id, { name: c.name }));
        return map;
    }, [clients]);

    const tasksMap = useMemo(() => {
        const map = new Map<string, any>();
        tasks.forEach(t => map.set(t.id, t));
        completedTasks.forEach(t => map.set(t.id, t));
        return map;
    }, [tasks, completedTasks]);

    // Task status toggling logic
    const handleToggleTask = useCallback((taskId: string, currentStatus: string) => {
        setTogglingIds(prev => new Set(prev).add(taskId));

        setTimeout(() => {
            if (currentStatus === "pending") {
                // Complete task
                const task = tasks.find(t => t.id === taskId);
                if (task) {
                    setTasks(prev => prev.filter(t => t.id !== taskId));
                    const completedTask: Task = {
                        ...task,
                        values: { ...task.values, status: "completed", resolution: "done" }
                    };
                    setCompletedTasks(prev => [completedTask, ...prev]);

                    // Add activity
                    const newAct: Activity = {
                        id: `act-${Date.now()}`,
                        values: {
                            type: "task_completed",
                            description: `Task completed: "${task.values.title}"`,
                            createdAt: new Date().toISOString(),
                            metadata: {
                                taskId: task.id,
                                taskTitle: task.values.title
                            }
                        }
                    };
                    setActivities(prev => [newAct, ...prev]);
                    showToast(`Completed task: "${task.values.title}"`);
                }
            } else {
                // Re-open task
                const task = completedTasks.find(t => t.id === taskId);
                if (task) {
                    setCompletedTasks(prev => prev.filter(t => t.id !== taskId));
                    const pendingTask: Task = {
                        ...task,
                        values: { ...task.values, status: "pending", resolution: null }
                    };
                    setTasks(prev => [pendingTask, ...prev]);

                    // Add activity
                    const newAct: Activity = {
                        id: `act-${Date.now()}`,
                        values: {
                            type: "task_created",
                            description: `Task re-opened: "${task.values.title}"`,
                            createdAt: new Date().toISOString(),
                            metadata: {
                                taskId: task.id,
                                taskTitle: task.values.title
                            }
                        }
                    };
                    setActivities(prev => [newAct, ...prev]);
                    showToast(`Re-opened task: "${task.values.title}"`);
                }
            }
            setTogglingIds(prev => {
                const next = new Set(prev);
                next.delete(taskId);
                return next;
            });
        }, 200);
    }, [tasks, completedTasks, showToast]);

    // Activity specific handlers
    const handleCompleteTaskFromActivity = useCallback((activity: any) => {
        const taskId = activity.values?.metadata?.taskId;
        if (taskId) {
            handleToggleTask(taskId, "pending");
        }
    }, [handleToggleTask]);

    const handleViewEmail = useCallback((activity: any) => {
        if (activity.values?.metadata?.subject) {
            setSelectedEmail({
                to: activity.values.metadata.to || "",
                subject: activity.values.metadata.subject,
                body: activity.values.metadata.body || "",
                html: activity.values.metadata.html || "",
                mode: activity.values.metadata.mode || "simulated"
            });
            setEmailViewerOpen(true);
        }
    }, []);

    const handleOpenTask = useCallback((activity: any) => {
        const taskId = activity.values?.metadata?.taskId;
        if (taskId) {
            setActiveSideEntity({ type: "task", id: taskId });
        }
    }, []);

    // Side panel open helpers
    const openTaskDrawer = useCallback((taskId: string) => {
        setActiveSideEntity({ type: "task", id: taskId });
    }, []);

    const openClientDrawer = useCallback((clientId: string) => {
        setActiveSideEntity({ type: "client", id: clientId });
    }, []);

    const openNewClientDrawer = useCallback(() => {
        setActiveSideEntity({ type: "new_client" });
    }, []);

    // Create client simulation
    const handleCreateClient = () => {
        if (!newClientName.trim()) return;

        const newId = `client-${Date.now()}`;
        const newClient: Client = {
            id: newId,
            name: newClientName,
            email: newClientEmail || `${newClientName.toLowerCase().replace(/\s+/g, ".")}@example.com`,
            phone: newClientPhone || "+1 (555) 0100",
            stage: newClientStage
        };

        setClients(prev => [...prev, newClient]);

        // Add auto task
        const newTask: Task = {
            id: `task-${Date.now()}`,
            values: {
                title: `Complete discovery onboarding for ${newClientName}`,
                status: "pending",
                resolution: null,
                dueDate: new Date(Date.now() + 259200000).toISOString().split('T')[0], // 3 days from now
                stageId: newClientStage,
                clientId: newId,
                priority: "medium",
                description: `Initial welcome packet and service review task for ${newClientName}.`,
                notes: "",
                createdAt: new Date().toISOString()
            }
        };
        setTasks(prev => [newTask, ...prev]);

        // Add activity
        const newAct: Activity = {
            id: `act-${Date.now()}`,
            values: {
                type: "incoming",
                description: `New client "${newClientName}" registered in "${STAGE_LABELS[newClientStage] || newClientStage}"`,
                createdAt: new Date().toISOString()
            }
        };
        setActivities(prev => [newAct, ...prev]);

        showToast(`Created client "${newClientName}"`);

        // Reset inputs
        setNewClientName("");
        setNewClientEmail("");
        setNewClientPhone("");
        setNewClientStage("incoming");
        setActiveSideEntity(null);
    };

    // Simulated navigation / pipeline filtering
    const handleNavigate = useCallback((path: string) => {
        if (path.includes("stage=")) {
            // Simulated stage click filtering
            showToast(`Stage link clicked: simulated filtering.`);
        } else {
            showToast(`Simulated navigation to: ${path}`);
        }
    }, [showToast]);

    // Derived counts/funnel overview data
    const activeStagesData = useMemo(() => {
        const stagesList = INITIAL_STAGES[selectedPipelineId] || [];
        return stagesList.map(s => {
            const count = clients.filter(c => c.stage === s.stageKey).length;
            return { ...s, count } as PipelineStage;
        });
    }, [clients, selectedPipelineId]);

    const sortedStages = useMemo(() => {
        return [...activeStagesData].sort((a, b) => a.sortOrder - b.sortOrder);
    }, [activeStagesData]);

    const activeStagesList = useMemo(() =>
        sortedStages.filter(s => !s.isTerminal && !s.isLostStage),
        [sortedStages]
    );

    const closedStagesList = useMemo(() =>
        sortedStages.filter(s => s.isTerminal || s.isLostStage),
        [sortedStages]
    );

    const totalInPipeline = useMemo(() => {
        return clients.filter(c => c.stage !== "completed").length;
    }, [clients]);

    const insights = useMemo(() => {
        const activeClients = clients.filter(c => c.stage !== "completed" && c.stage !== "delivered").length;
        const overdueTaskCount = tasks.filter(t => {
            if (t.values.status !== "pending") return false;
            if (!t.values.dueDate) return false;
            return new Date(t.values.dueDate) < new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
        }).length;

        return {
            pipelines: PIPELINES,
            activeClients,
            potentialRevenue: activeClients * 2500,
            contractedRevenue: clients.filter(c => c.stage === "completed" || c.stage === "active").length * 8000,
            overdueTaskCount
        };
    }, [clients, tasks]);

    const totalRevenue = insights.contractedRevenue + insights.potentialRevenue;

    /* ── Render Drawer Sub-panels ──────────────────────────── */

    const renderDrawerTask = (taskId?: string) => {
        const task = tasksMap.get(taskId || "");
        if (!task) return <Typography variant="body2" color="secondary">Task not found.</Typography>;

        const isCompleted = task.values.status === "completed";
        const clientInfo = task.values.clientId ? clients.find(c => c.id === task.values.clientId) : null;
        const stageName = task.values.stageId ? STAGE_LABELS[task.values.stageId] : "None";

        return (
            <div className="flex-1 space-y-4">
                <div>
                    <Typography variant="caption" color="secondary" className="uppercase text-[9px] tracking-wider font-semibold block mb-1">Task Title</Typography>
                    <div className="flex items-start gap-2.5">
                        <span className="pt-1">
                            <input
                                type="checkbox"
                                checked={isCompleted}
                                onChange={() => handleToggleTask(task.id, task.values.status)}
                                className="h-4 w-4 rounded border-surface-300 text-primary focus:ring-primary"
                            />
                        </span>
                        <Typography variant="h6" className={isCompleted ? "line-through text-text-disabled dark:text-text-disabled-dark" : "text-text-primary dark:text-text-primary-dark"}>
                            {task.values.title}
                        </Typography>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-4 py-2 border-y border-surface-200 dark:border-surface-700">
                    <div>
                        <Typography variant="caption" color="secondary" className="uppercase text-[9px] tracking-wider block">Due Date</Typography>
                        <Typography variant="body2" className="font-medium mt-0.5 inline-flex items-center gap-1">
                            <CalendarIcon className="h-3.5 w-3.5 text-surface-400" />
                            {task.values.dueDate || "No due date"}
                        </Typography>
                    </div>
                    <div>
                        <Typography variant="caption" color="secondary" className="uppercase text-[9px] tracking-wider block">Priority</Typography>
                        <Typography variant="body2" className="font-medium mt-0.5">
                            {task.values.priority === "high" ? (
                                <span className="text-red-500 font-semibold uppercase text-xs">High</span>
                            ) : task.values.priority === "medium" ? (
                                <span className="text-amber-500 font-semibold uppercase text-xs">Medium</span>
                            ) : (
                                <span className="text-surface-450 dark:text-surface-500 uppercase text-xs">Low</span>
                            )}
                        </Typography>
                    </div>
                </div>

                {clientInfo && (
                    <div>
                        <Typography variant="caption" color="secondary" className="uppercase text-[9px] tracking-wider font-semibold block mb-1">Related Client</Typography>
                        <Card
                            className="p-3 hover:bg-surface-accent-100 dark:hover:bg-surface-800 cursor-pointer transition-colors duration-150"
                            onClick={() => openClientDrawer(clientInfo.id)}
                        >
                            <div className="flex items-center gap-2.5">
                                <div className="w-8 h-8 rounded-full bg-surface-200 dark:bg-surface-700 text-surface-500 flex items-center justify-center font-bold">
                                    {clientInfo.name[0].toUpperCase()}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <Typography variant="body2" className="font-medium truncate">{clientInfo.name}</Typography>
                                    <Typography variant="caption" color="secondary" className="truncate text-[11px] block">{clientInfo.email}</Typography>
                                </div>
                            </div>
                        </Card>
                    </div>
                )}

                <div>
                    <Typography variant="caption" color="secondary" className="uppercase text-[9px] tracking-wider block mb-0.5">Pipeline Stage</Typography>
                    <Typography variant="body2" className="font-medium">{stageName}</Typography>
                </div>

                {task.values.description && (
                    <div>
                        <Typography variant="caption" color="secondary" className="uppercase text-[9px] tracking-wider block mb-0.5">Description</Typography>
                        <div className="p-3 bg-surface-50 dark:bg-surface-900 rounded-md border border-surface-200 dark:border-surface-700">
                            <Typography variant="body2" className="whitespace-pre-wrap text-text-primary dark:text-text-primary-dark">
                                {task.values.description}
                            </Typography>
                        </div>
                    </div>
                )}

                {task.values.notes && (
                    <div>
                        <Typography variant="caption" color="secondary" className="uppercase text-[9px] tracking-wider block mb-0.5">Notes</Typography>
                        <Typography variant="body2" color="secondary" className="italic whitespace-pre-wrap">
                            &ldquo;{task.values.notes}&rdquo;
                        </Typography>
                    </div>
                )}
            </div>
        );
    };

    const renderDrawerClient = (clientId?: string) => {
        const client = clients.find(c => c.id === clientId);
        if (!client) return <Typography variant="body2" color="secondary">Client not found.</Typography>;

        const clientTasks = tasks.filter(t => t.values.clientId === client.id);
        const stageName = STAGE_LABELS[client.stage] || client.stage;

        return (
            <div className="flex-1 space-y-4">
                <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-primary/10 text-primary dark:text-primary-light flex items-center justify-center text-xl font-bold">
                        {client.name[0].toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                        <Typography variant="h6" className="truncate">{client.name}</Typography>
                        <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="w-2 h-2 rounded-full bg-green-500" />
                            <Typography variant="caption" color="secondary">{stageName}</Typography>
                        </div>
                    </div>
                </div>

                <div className="space-y-2.5 py-3 border-y border-surface-200 dark:border-surface-700">
                    <div className="flex items-center gap-2 text-surface-600 dark:text-surface-300">
                        <MailIcon className="h-4 w-4 text-surface-400" />
                        <Typography variant="body2">{client.email}</Typography>
                    </div>
                    <div className="flex items-center gap-2 text-surface-600 dark:text-surface-300">
                        <PhoneIcon className="h-4 w-4 text-surface-400" />
                        <Typography variant="body2">{client.phone}</Typography>
                    </div>
                </div>

                <div>
                    <Typography variant="caption" color="secondary" className="uppercase text-[9px] tracking-wider font-semibold block mb-2">Pending Client Tasks</Typography>
                    {clientTasks.length === 0 ? (
                        <Typography variant="body2" color="secondary" className="italic">No pending tasks for this client.</Typography>
                    ) : (
                        <div className="space-y-1.5">
                            {clientTasks.map(t => (
                                <Card
                                    key={t.id}
                                    className="p-2.5 hover:bg-surface-accent-100 dark:hover:bg-surface-800 cursor-pointer transition-colors duration-150"
                                    onClick={() => openTaskDrawer(t.id)}
                                >
                                    <div className="flex items-start gap-2">
                                        <input
                                            type="checkbox"
                                            checked={t.values.status === "completed"}
                                            onChange={(e) => {
                                                e.stopPropagation();
                                                handleToggleTask(t.id, t.values.status);
                                            }}
                                            className="h-3.5 w-3.5 mt-0.5 rounded border-surface-300 text-primary"
                                        />
                                        <div className="flex-1 min-w-0">
                                            <Typography variant="body2" className="truncate font-medium leading-snug">{t.values.title}</Typography>
                                            {t.values.dueDate && (
                                                <Typography variant="caption" color="secondary" className="text-[10px] block mt-0.5">Due: {t.values.dueDate}</Typography>
                                            )}
                                        </div>
                                    </div>
                                </Card>
                            ))}
                        </div>
                    )}
                </div>

                <div className="pt-2">
                    <Typography variant="caption" color="secondary" className="uppercase text-[9px] tracking-wider font-semibold block mb-2">Quick Actions</Typography>
                    <div className="grid grid-cols-2 gap-2">
                        <Button
                            variant="outlined"
                            size="small"
                            onClick={() => {
                                // Add simulated call note
                                const newAct: Activity = {
                                    id: `act-${Date.now()}`,
                                    values: {
                                        type: "zoom_setup",
                                        description: `Scheduled discovery meeting with ${client.name}`,
                                        createdAt: new Date().toISOString()
                                    }
                                };
                                setActivities(prev => [newAct, ...prev]);
                                showToast("Simulated action: Call scheduled");
                            }}
                        >
                            Schedule Call
                        </Button>
                        <Button
                            variant="outlined"
                            size="small"
                            onClick={() => {
                                // Add simulated email note
                                const newAct: Activity = {
                                    id: `act-${Date.now()}`,
                                    values: {
                                        type: "email_sent",
                                        description: `Email sent to ${client.name}`,
                                        createdAt: new Date().toISOString(),
                                        metadata: {
                                            subject: "Following up on discovery call",
                                            body: `Hi ${client.name.split(" ")[0]},\n\nJust wanted to follow up and see if you had any questions on the brochure.\n\nBest,\nFrancesco`,
                                            to: client.email,
                                            mode: "simulated"
                                        }
                                    }
                                };
                                setActivities(prev => [newAct, ...prev]);
                                showToast("Simulated action: Email sent");
                            }}
                        >
                            Send Email
                        </Button>
                    </div>
                </div>
            </div>
        );
    };

    const renderDrawerNewClient = () => {
        return (
            <div className="flex-1 flex flex-col justify-between">
                <div className="space-y-4">
                    <Typography variant="subtitle1" className="mb-2">New Lead Details</Typography>

                    <TextField
                        label="Client Name"
                        required
                        value={newClientName}
                        onChange={e => setNewClientName(e.target.value)}
                        placeholder="e.g. George Clark"
                    />

                    <TextField
                        label="Email Address"
                        value={newClientEmail}
                        onChange={e => setNewClientEmail(e.target.value)}
                        placeholder="e.g. george@clark.com"
                    />

                    <TextField
                        label="Phone Number"
                        value={newClientPhone}
                        onChange={e => setNewClientPhone(e.target.value)}
                        placeholder="e.g. +1 (555) 0122"
                    />

                    <div>
                        <Typography variant="caption" color="secondary" className="uppercase text-[9px] tracking-wider block mb-1">Pipeline Stage</Typography>
                        <Select
                            value={newClientStage}
                            onValueChange={(v) => setNewClientStage(v as string)}
                            size="small"
                            renderValue={(v) => STAGE_LABELS[v as string] || v as string}
                            position="popper"
                        >
                            {Object.entries(STAGE_LABELS).map(([key, val]) => (
                                <SelectItem key={key} value={key}>{val}</SelectItem>
                            ))}
                        </Select>
                    </div>
                </div>

                <div className="flex items-center gap-2 pt-6 border-t border-surface-200 dark:border-surface-700 mt-6">
                    <Button
                        variant="outlined"
                        color="neutral"
                        className="flex-1"
                        onClick={() => setActiveSideEntity(null)}
                    >
                        Cancel
                    </Button>
                    <Button
                        variant="filled"
                        color="primary"
                        className="flex-1"
                        onClick={handleCreateClient}
                        disabled={!newClientName.trim()}
                    >
                        Create
                    </Button>
                </div>
            </div>
        );
    };

    return (
        <div className="relative w-full border rounded-xl bg-surface-50 dark:bg-surface-800 border-surface-200 dark:border-surface-700 shadow-sm flex flex-row">
            {/* Dashboard main workspace */}
            <div className="flex-1 flex flex-col p-4 md:p-6 transition-all duration-300">
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-end justify-between mb-6 gap-4">
                    <div>
                        <Typography variant="h4" className="tracking-tight">
                            {/* No emoji: this demo renders inside the public rebase.pro/ui
                                gallery, and emoji render differently on every platform,
                                cannot be recoloured, and read as a placeholder for a design
                                decision nobody made. The greeting carries itself. */}
                            {getGreeting()}
                        </Typography>
                        <Typography variant="body2" color="secondary" className="mt-0.5">
                            {getFormattedDate()} — here&apos;s your crm overview.
                        </Typography>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button
                            variant="text"
                            color="primary"
                            size="small"
                            onClick={() => {
                                setLoading(true);
                                setActivitiesLoading(true);
                                setTimeout(() => {
                                    setLoading(false);
                                    setActivitiesLoading(false);
                                    showToast("Data refreshed.");
                                }, 300);
                            }}
                            disabled={loading}
                            startIcon={<RefreshCwIcon className={cls("h-4 w-4", loading && "animate-spin")} />}
                        >
                            Refresh
                        </Button>
                        <Button
                            variant="filled"
                            color="primary"
                            size="small"
                            onClick={openNewClientDrawer}
                            startIcon={<UserPlus className="h-4 w-4" />}
                        >
                            New Client
                        </Button>
                    </div>
                </div>

                {/* KPI metrics row */}
                <DashboardMetrics
                    loading={loading}
                    insights={insights}
                    totalInPipeline={totalInPipeline}
                    totalRevenue={totalRevenue}
                />

                {/* Pipeline visualizer */}
                <PipelineOverview
                    loading={loading}
                    insights={insights}
                    selectedPipelineId={selectedPipelineId}
                    onPipelineChange={handlePipelineChange}
                    onNavigate={handleNavigate}
                    sortedStages={sortedStages}
                    activeStages={activeStagesList}
                    closedStages={closedStagesList}
                    totalInPipeline={totalInPipeline}
                    resolveColor={resolveColor}
                />

                {/* Combined Tasks, Calendar, and RecentActivity */}
                <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6 mt-2">
                    <Card className="p-4 flex flex-col h-[400px]">
                        <TasksView
                            loading={loading}
                            tasks={tasks}
                            togglingIds={togglingIds}
                            onToggleTask={handleToggleTask}
                            onOpenTask={openTaskDrawer}
                            onOpenClient={openClientDrawer}
                            clientsMap={clientsMap}
                            pipelineStages={sortedStages}
                            recentlyToggledIds={recentlyToggledIds}
                            completedTasks={completedTasks}
                            completedLoaded={completedLoaded}
                            loadingCompleted={loadingCompleted}
                            completedHasMore={false}
                            onExpandCompleted={handleExpandCompleted}
                            onLoadMoreCompleted={handleLoadMoreCompleted}
                        />
                    </Card>

                    <div className="flex flex-col gap-6">
                        <Card className="p-4 h-auto">
                            <CalendarWidget
                                loading={loading}
                                tasks={tasks.concat(completedTasks)}
                                onOpenTask={openTaskDrawer}
                            />
                        </Card>
                        <RecentActivity
                            activities={activities}
                            activitiesLoading={activitiesLoading}
                            tasksMap={tasksMap}
                            onCompleteTask={handleCompleteTaskFromActivity}
                            onViewEmail={handleViewEmail}
                            onOpenTask={handleOpenTask}
                            emailViewerOpen={emailViewerOpen}
                            onEmailViewerOpenChange={setEmailViewerOpen}
                            selectedEmail={selectedEmail}
                        />
                    </div>
                </div>
            </div>

            {/* Custom Mock Side panel sliding in */}
            <div className={cls(
                "fixed top-0 right-0 bottom-0 w-full sm:w-[420px] bg-white dark:bg-surface-900 border-l border-surface-200 dark:border-surface-700 shadow-2xl z-40 transition-transform duration-300 ease-in-out flex flex-col",
                activeSideEntity ? "translate-x-0" : "translate-x-full"
            )}>
                <div className="p-4 flex items-center justify-between border-b border-surface-200 dark:border-surface-800">
                    <Typography variant="subtitle1" className="font-semibold uppercase tracking-wider text-[10px] color-secondary">
                        {activeSideEntity?.type === "task" ? "Task Details" : activeSideEntity?.type === "client" ? "Client profile" : "Create Lead"}
                    </Typography>
                    <button
                        onClick={() => setActiveSideEntity(null)}
                        className="p-1 rounded-md text-surface-400 hover:text-surface-700 hover:bg-surface-100 dark:hover:bg-surface-800 focus:outline-none"
                    >
                        <XIcon className="h-4 w-4" />
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto p-5 flex flex-col">
                    {activeSideEntity?.type === "task" && renderDrawerTask(activeSideEntity.id)}
                    {activeSideEntity?.type === "client" && renderDrawerClient(activeSideEntity.id)}
                    {activeSideEntity?.type === "new_client" && renderDrawerNewClient()}
                </div>
            </div>

            {/* Backdrop click to close drawer */}
            {activeSideEntity && (
                <div
                    onClick={() => setActiveSideEntity(null)}
                    className="fixed inset-0 bg-black/20 dark:bg-black/50 z-30 transition-opacity duration-300"
                />
            )}

            {/* Custom interactive toast popup */}
            <div className={cls(
                "absolute bottom-4 left-4 z-50 transition-all duration-300 transform",
                toastMessage ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0 pointer-events-none"
            )}>
                {toastMessage && (
                    <div className="px-4 py-3 bg-surface-900 dark:bg-surface-50 text-white dark:text-surface-900 text-xs font-medium rounded-lg shadow-lg flex items-center gap-2 border border-surface-800 dark:border-surface-200">
                        <CheckIcon className="h-4 w-4 text-green-500" />
                        <span>{toastMessage}</span>
                    </div>
                )}
            </div>
        </div>
    );
}
