import React from "react";
import { CHIP_COLORS, cls, getColorSchemeForKey } from "../util";

export type ChipColorScheme = {
    color: string;
    text: string;
    /** Background color override for dark mode */
    darkColor?: string;
    /** Text color override for dark mode */
    darkText?: string;
}

export type ChipColorKey = keyof typeof CHIP_COLORS;

export interface ChipProps {
    className?: string;
    children: React.ReactNode;
    size?: "smallest" | "small" | "medium" | "large";
    colorScheme?: ChipColorScheme | ChipColorKey;
    error?: boolean;
    outlined?: boolean;
    onClick?: () => void;
    icon?: React.ReactNode;
    style?: React.CSSProperties;
}

const sizeClassNames = {
    smallest: "px-1.5 text-xs",
    small: "px-2 py-0.5 text-sm",
    medium: "px-3 py-1 text-sm",
    large: "px-4 py-1.5 text-sm"
}

/**
 * Detect if the app is currently in dark mode by checking the
 * Tailwind `dark` class on the document root.
 */
function isDarkMode(): boolean {
    return typeof document !== "undefined" &&
        document.documentElement.classList.contains("dark");
}

/**
 * @group Preview components
 */
export function Chip({
                         children,
                         colorScheme,
                         error,
                         outlined,
                         onClick,
                         icon,
                         size = "large",
                         className,
                         style
                     }: ChipProps) {

    const usedColorScheme = typeof colorScheme === "string" ? getColorSchemeForKey(colorScheme) : colorScheme;

    // Resolve theme-aware colors
    const dark = isDarkMode();
    const bgColor = usedColorScheme
        ? (dark && usedColorScheme.darkColor ? usedColorScheme.darkColor : usedColorScheme.color)
        : undefined;
    const textColor = usedColorScheme
        ? (dark && usedColorScheme.darkText ? usedColorScheme.darkText : usedColorScheme.text)
        : undefined;

    return (
        <div
            className={cls("rounded-lg max-w-full w-max h-fit font-regular inline-flex gap-1",
                "text-ellipsis",
                "items-center",
                onClick ? "cursor-pointer hover:bg-surface-accent-300 dark:hover:bg-surface-accent-700" : "",
                sizeClassNames[size],
                error || !usedColorScheme ? "bg-surface-accent-200 dark:bg-surface-accent-800 text-surface-accent-800 dark:text-white" : "",
                error ? "text-red-500 dark:text-red-400" : "",
                className)}
            onClick={onClick}
            style={{
                backgroundColor: error ? undefined : bgColor,
                color: error ? undefined : textColor,
                overflow: "hidden",
                ...style
            }}
        >
            {children}
            {icon}
        </div>
    );
}
