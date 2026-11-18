import React from "react";
import { cls } from "../util";

/**
 * What a state means, not which hue draws it: `ok` is emerald, `busy` amber
 * (and pulses, because busy is a state that ends), `bad` red, `idle` the
 * disabled ink.
 */
export type StatusTone = "ok" | "busy" | "bad" | "idle";

const DOT: Record<StatusTone, string> = {
    ok: "bg-emerald-500",
    busy: "bg-amber-500",
    bad: "bg-red-500",
    idle: "bg-text-disabled dark:bg-text-disabled-dark"
};

export interface StatusDotProps {
    tone: StatusTone;
    /** The word the dot stands before. Omit it for a bare dot, and give the dot an `aria-label`. */
    children?: React.ReactNode;
    /**
     * `small` sets the word at 12px, beside a secondary value; `medium` at
     * 14px, in a list or a header; `inherit` takes the size and ink of the
     * text around it — a status as a tile's value.
     */
    size?: "small" | "medium" | "inherit";
    className?: string;
    "aria-label"?: string;
}

/**
 * State, as a dot before the word.
 *
 * A list shows what HAPPENED to each row — running, failed, stopped — as a dot
 * and a word, not as a filled badge: a column of tinted badges reads as a
 * column of labels someone applied. The dot carries the hue; the word carries
 * the meaning, in the secondary ink. A value the operator chose is a `Chip`.
 */
export function StatusDot({ tone, children, size = "medium", className, "aria-label": ariaLabel }: StatusDotProps) {
    return (
        <span
            className={cls(
                "inline-flex items-center gap-1.5 shrink-0",
                size === "inherit" ? undefined : "text-text-secondary dark:text-text-secondary-dark",
                size === "small" ? "text-xs" : size === "medium" ? "text-sm" : undefined,
                className
            )}
            aria-label={ariaLabel}
            role={ariaLabel && !children ? "img" : undefined}
        >
            <span className={cls("relative rounded-full shrink-0", size === "inherit" ? "w-2 h-2" : "w-1.5 h-1.5", DOT[tone])}>
                {tone === "busy" && (
                    <span className="absolute inset-0 rounded-full bg-amber-500 motion-safe:animate-ping"/>
                )}
            </span>
            {children}
        </span>
    );
}
