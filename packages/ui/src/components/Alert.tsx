import * as React from "react";
import { cls } from "../util";
import { AlertCircleIcon, AlertTriangleIcon, CheckCircleIcon, InfoIcon, XIcon } from "../icons";

export interface AlertProps {
    children: React.ReactNode;
    onDismiss?: () => void;
    color?: "error" | "warning" | "info" | "success" | "base";
    size?: "small" | "medium" | "large";
    action?: React.ReactNode;
    className?: string;
    outerClassName?: string;
    style?: React.CSSProperties;
}

const getSizeClasses = (size: "small" | "medium" | "large") => {
    switch (size) {
        case "small":
            return "px-3 py-1.5 text-xs gap-2 rounded-md";
        case "large":
            return "px-4 py-3.5 text-sm gap-3 rounded-lg";
        case "medium":
        default:
            return "px-3.5 py-2.5 text-sm gap-2.5 rounded-lg";
    }
}

const getIconSize = (size: "small" | "medium" | "large") => size === "small" ? 16 : 18;

const getColorClasses = (severity: string) => {
    switch (severity) {
        case "error":
            return "bg-red-500/8 dark:bg-red-500/12 text-red-800 dark:text-red-200 border border-red-500/20 dark:border-red-500/25";
        case "warning":
            return "bg-amber-500/8 dark:bg-amber-500/12 text-amber-800 dark:text-amber-200 border border-amber-500/20 dark:border-amber-500/25";
        case "info":
            return "bg-blue-500/8 dark:bg-blue-500/12 text-blue-800 dark:text-blue-200 border border-blue-500/20 dark:border-blue-500/25";
        case "success":
            return "bg-emerald-500/8 dark:bg-emerald-500/12 text-emerald-800 dark:text-emerald-200 border border-emerald-500/20 dark:border-emerald-500/25";
        case "base":
        default:
            return "bg-surface-accent-500/8 dark:bg-surface-accent-400/10 text-surface-accent-800 dark:text-surface-accent-100 border border-surface-accent-500/15 dark:border-surface-accent-400/20";
    }
};

const getIconColor = (severity: string) => {
    switch (severity) {
        case "error":
            return "text-red-500 dark:text-red-400";
        case "warning":
            return "text-amber-500 dark:text-amber-400";
        case "info":
            return "text-blue-500 dark:text-blue-400";
        case "success":
            return "text-emerald-500 dark:text-emerald-400";
        case "base":
        default:
            return "text-surface-accent-500 dark:text-surface-accent-400";
    }
};

const getIcon = (severity: string, size: number, className: string) => {
    switch (severity) {
        case "error":
            return <AlertCircleIcon size={size} className={className}/>;
        case "warning":
            return <AlertTriangleIcon size={size} className={className}/>;
        case "success":
            return <CheckCircleIcon size={size} className={className}/>;
        case "info":
        case "base":
        default:
            return <InfoIcon size={size} className={className}/>;
    }
};

export const Alert: React.FC<AlertProps> = ({
                                                children,
                                                onDismiss,
                                                color = "info",
                                                size = "medium",
                                                action,
                                                outerClassName,
                                                className,
                                                style
                                            }) => {
    const classes = getColorClasses(color);
    const iconSize = getIconSize(size);

    return (
        <div
            style={style}
            className={cls(
                getSizeClasses(size),
                "w-full",
                "font-medium leading-snug",
                "flex items-start",
                classes,
                outerClassName)}>
            <span className={cls("shrink-0 mt-px", getIconColor(color))}>
                {getIcon(color, iconSize, "")}
            </span>
            <div className={cls("grow min-w-0 self-center", className)}>{children}</div>
            {action}
            {onDismiss && (
                <button
                    type="button"
                    aria-label="Dismiss"
                    className={cls(
                        "shrink-0 rounded p-0.5 opacity-60 transition-opacity hover:opacity-100",
                        "focus:outline-none focus-visible:ring-2 focus-visible:ring-current/40")}
                    onClick={onDismiss}>
                    <XIcon size={iconSize - 2}/>
                </button>
            )}
        </div>
    );
};
