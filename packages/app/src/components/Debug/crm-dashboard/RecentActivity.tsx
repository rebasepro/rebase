import React from "react";
import {
    Typography,
    Card,
    Skeleton,
    Separator,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    CircleDotIcon,
    ArrowRightLeftIcon,
    MailIcon,
    FileTextIcon,
    PenLineIcon,
    VideoIcon,
    MessageCircleIcon,
    StickyNoteIcon,
    ListPlusIcon,
    CheckCircle2Icon,
    WrenchIcon,
    PinIcon
} from "@rebasepro/ui";

/* ── Activity type → icon mapping ─────────────────── */
const ACTIVITY_ICONS: Record<string, React.ReactNode> = {
    incoming:          <CircleDotIcon className="h-4 w-4 text-blue-500" />,
    status_changed:    <ArrowRightLeftIcon className="h-4 w-4 text-violet-500" />,
    email_sent:        <MailIcon className="h-4 w-4 text-sky-500" />,
    agreements_sent:   <FileTextIcon className="h-4 w-4 text-amber-500" />,
    agreements_signed: <PenLineIcon className="h-4 w-4 text-emerald-500" />,
    zoom_setup:        <VideoIcon className="h-4 w-4 text-blue-600" />,
    whatsapp_setup:    <MessageCircleIcon className="h-4 w-4 text-green-500" />,
    note:              <StickyNoteIcon className="h-4 w-4 text-yellow-500" />,
    task_created:      <ListPlusIcon className="h-4 w-4 text-teal-500" />,
    task_completed:    <CheckCircle2Icon className="h-4 w-4 text-emerald-500" />,
    manual_action:     <WrenchIcon className="h-4 w-4 text-orange-500" />
};

/* ── Relative time helper ──────────────────────────── */
function relativeTime(dateStr: string): string {
    const now = Date.now();
    const then = new Date(dateStr).getTime();
    const diffSec = Math.round((now - then) / 1000);
    if (diffSec < 60) return 'just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay < 7) return `${diffDay}d ago`;
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/* ── Types ────────────────────────────────────────────── */

export interface RecentActivityProps {
    activities: any[];
    activitiesLoading: boolean;
    tasksMap: Map<string, any>;
    onCompleteTask: (activity: any) => void;
    onViewEmail: (activity: any) => void;
    onOpenTask: (activity: any) => void;
    emailViewerOpen: boolean;
    onEmailViewerOpenChange: (open: boolean) => void;
    selectedEmail: { to: string; subject: string; body: string; html?: string; mode?: string } | null;
}

/* ── Component ────────────────────────────────────────── */

export function RecentActivity({
    activities,
    activitiesLoading,
    tasksMap,
    onCompleteTask,
    onViewEmail,
    onOpenTask,
    emailViewerOpen,
    onEmailViewerOpenChange,
    selectedEmail
}: RecentActivityProps) {
    return (
        <>
            <Card className="p-4 flex-1">
                <Typography variant="subtitle1" className="mb-3">Recent Activity</Typography>

                {activitiesLoading ? (
                    <div className="flex flex-col gap-3">
                        {Array.from({ length: 6 }).map((_, i) => (
                            <div key={i} className="flex items-center gap-3">
                                <Skeleton className="h-5 w-5 rounded-full shrink-0" />
                                <Skeleton className="h-4 flex-1" />
                            </div>
                        ))}
                    </div>
                ) : activities.length === 0 ? (
                    <div className="flex flex-col items-center py-6">
                        <Typography variant="body2" color="secondary">
                            No recent activity
                        </Typography>
                    </div>
                ) : (
                    <div className="flex flex-col">
                        {activities.map((activity: any, idx: number) => {
                            const actType = activity.values?.type;
                            const taskId = activity.values?.metadata?.taskId;
                            const relatedTask = taskId ? tasksMap.get(taskId) : null;
                            const isTaskActivity = actType === "task_created" || actType === "task_completed";
                            const isEmailActivity = actType === "email_sent";

                            return (
                                <React.Fragment key={activity.id}>
                                    {idx > 0 && <Separator orientation="horizontal" className="my-0" />}
                                    <div className="flex items-start gap-2.5 py-2.5">
                                        <span className="shrink-0 mt-0.5 flex items-center">
                                            {ACTIVITY_ICONS[actType] ?? <PinIcon className="h-4 w-4 text-surface-400 dark:text-surface-500" />}
                                        </span>
                                        <div className="flex-1 min-w-0">
                                            <Typography variant="body2" className="truncate leading-snug">
                                                {activity.values?.description || actType || "Activity"}
                                            </Typography>
                                            {activity.values?.createdAt && (
                                                <Typography variant="caption" color="secondary" className="text-[10px]">
                                                    {relativeTime(activity.values.createdAt)}
                                                </Typography>
                                            )}
                                            {/* Action buttons using @rebasepro/ui Buttons */}
                                            <div className="flex items-center gap-3 mt-1 flex-wrap">
                                                {/* Complete Task — only for task_created with a pending task */}
                                                {isTaskActivity && relatedTask && relatedTask.values?.status !== "completed" && (
                                                    <Button
                                                        variant="text"
                                                        size="small"
                                                        color="primary"
                                                        className="text-emerald-600 dark:text-emerald-400 font-medium hover:underline p-0 h-auto min-w-0"
                                                        onClick={() => onCompleteTask(activity)}
                                                    >
                                                        Complete Task
                                                    </Button>
                                                )}
                                                {/* View Sent Email */}
                                                {isEmailActivity && (
                                                    <Button
                                                        variant="text"
                                                        size="small"
                                                        color="primary"
                                                        className="font-medium hover:underline p-0 h-auto min-w-0"
                                                        onClick={() => onViewEmail(activity)}
                                                    >
                                                        View Sent Email
                                                    </Button>
                                                )}
                                                {/* Open task in side panel */}
                                                {isTaskActivity && taskId && (
                                                    <Button
                                                        variant="text"
                                                        size="small"
                                                        color="neutral"
                                                        className="font-medium hover:underline p-0 h-auto min-w-0 text-surface-500 hover:text-surface-700 dark:text-surface-400 dark:hover:text-surface-300"
                                                        onClick={() => onOpenTask(activity)}
                                                    >
                                                        Open Task
                                                    </Button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </React.Fragment>
                            );
                        })}
                    </div>
                )}
            </Card>

            {/* ── Email Viewer Dialog ── */}
            <Dialog
                open={emailViewerOpen}
                onOpenChange={onEmailViewerOpenChange}
                maxWidth="xl"
            >
                <DialogTitle>{selectedEmail?.subject || "Email"}</DialogTitle>
                <DialogContent>
                    {selectedEmail && (
                        <div className="space-y-3">
                            <Typography variant="caption" color="secondary">
                                To: {selectedEmail.to}
                            </Typography>
                            {selectedEmail.html ? (
                                <div
                                    className="prose prose-sm dark:prose-invert max-w-none text-text-primary dark:text-text-primary-dark"
                                    dangerouslySetInnerHTML={{ __html: selectedEmail.html }}
                                />
                            ) : (
                                <Typography variant="body2" className="whitespace-pre-wrap">
                                    {selectedEmail.body}
                                </Typography>
                            )}
                            {selectedEmail.mode === "simulated" && (
                                <Typography variant="caption" color="secondary" className="italic mt-2 block">
                                    Simulated — email was not actually sent.
                                </Typography>
                            )}
                        </div>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button variant="text" onClick={() => onEmailViewerOpenChange(false)}>Close</Button>
                </DialogActions>
            </Dialog>
        </>
    );
}
