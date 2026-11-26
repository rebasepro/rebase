import React, { useState } from "react";
import {
    Button,
    cls,
    defaultBorderMixin,
    StatusDot,
    Typography,
    type StatusTone
} from "@rebasepro/ui";

export type ReviewUpdateStatus = "approved" | "needs_changes" | "blocked";

export interface ReviewUpdateComposerProps {
    initialStatus?: ReviewUpdateStatus;
    maxLength?: number;
    submitting?: boolean;
    onSubmit: (update: { status: ReviewUpdateStatus; note: string }) => void;
    className?: string;
}

const STATUS_OPTIONS: ReadonlyArray<{ value: ReviewUpdateStatus; label: string; tone: StatusTone }> = [
    { value: "approved", label: "Approved", tone: "ok" },
    { value: "needs_changes", label: "Needs changes", tone: "busy" },
    { value: "blocked", label: "Blocked", tone: "bad" }
];

/**
 * Compact, template-free review update composer (Linear project-update pattern).
 *
 * Intentionally constrains the input to a brief comment-sized box paired with
 * an explicit 3-state status picker so reviewers write concise, scannable
 * context the system cannot derive from the diff itself.
 */
export function ReviewUpdateComposer({
    initialStatus = "approved",
    maxLength = 280,
    submitting = false,
    onSubmit,
    className
}: ReviewUpdateComposerProps) {
    const [status, setStatus] = useState<ReviewUpdateStatus>(initialStatus);
    const [note, setNote] = useState("");

    const handleSubmit = (event: React.FormEvent) => {
        event.preventDefault();
        if (submitting) return;
        onSubmit({ status, note: note.trim() });
        setNote("");
    };

    return (
        <form
            onSubmit={handleSubmit}
            className={cls("rounded-xl border bg-surface-card p-3 space-y-2.5", defaultBorderMixin, className)}
        >
            <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Review status">
                {STATUS_OPTIONS.map((opt) => {
                    const active = status === opt.value;
                    return (
                        <button
                            key={opt.value}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            onClick={() => setStatus(opt.value)}
                            className={cls(
                                "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
                                active
                                    ? "bg-surface-active text-text-primary dark:text-text-primary-dark"
                                    : "text-surface-500 hover:bg-surface-hover"
                            )}
                        >
                            <StatusDot tone={opt.tone} size="small" />
                            <span>{opt.label}</span>
                        </button>
                    );
                })}
            </div>

            <textarea
                rows={2}
                maxLength={maxLength}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Brief context not obvious from the diff…"
                aria-label="Review note"
                className="w-full resize-none rounded-lg bg-surface-field px-3 py-2 text-sm text-text-primary dark:text-text-primary-dark placeholder:text-surface-500 outline-none"
            />

            <div className="flex items-center justify-between gap-2">
                <Typography variant="caption" color="secondary">
                    {`${note.length}/${maxLength}`}
                </Typography>
                <Button type="submit" size="small" color="primary" disabled={submitting}>
                    Post update
                </Button>
            </div>
        </form>
    );
}
