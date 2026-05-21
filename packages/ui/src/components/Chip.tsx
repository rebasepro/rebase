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

    // Helper to generate rgba from hex or standard colors
    const getRgba = (hex: string, alpha: number): string => {
        if (!hex || !hex.startsWith("#")) return hex;
        let color = hex.slice(1);
        if (color.length === 3) {
            color = color[0] + color[0] + color[1] + color[1] + color[2] + color[2];
        }
        const r = parseInt(color.slice(0, 2), 16);
        const g = parseInt(color.slice(2, 4), 16);
        const b = parseInt(color.slice(4, 6), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    };

    let textColor = "";
    let bgColor = "";
    let border = "";

    if (error) {
        textColor = dark ? "#f87171" : "#dc2626";
    } else if (usedColorScheme) {
        textColor = dark && usedColorScheme.darkText ? usedColorScheme.darkText : usedColorScheme.text;
    } else {
        textColor = dark ? "#d4d4d4" : "#404040";
    }

    if (outlined) {
        bgColor = getRgba(textColor, dark ? 0.12 : 0.06);
        border = `1px solid ${getRgba(textColor, dark ? 0.25 : 0.18)}`;
    } else {
        if (error) {
            bgColor = dark ? "rgba(220, 38, 38, 0.2)" : "rgba(239, 68, 68, 0.15)";
            border = `1px solid ${dark ? "rgba(220, 38, 38, 0.4)" : "rgba(239, 68, 68, 0.3)"}`;
        } else if (usedColorScheme) {
            bgColor = dark && usedColorScheme.darkColor ? usedColorScheme.darkColor : usedColorScheme.color;
        } else {
            bgColor = dark ? "#1f1f1f" : "#f4f4f5";
            border = `1px solid ${dark ? "#2e2e30" : "#e4e4e7"}`;
        }
    }

    return (
        <div
            className={cls("rounded-lg max-w-full w-max h-fit font-regular inline-flex gap-1",
                "text-ellipsis",
                "items-center",
                onClick ? "cursor-pointer hover:bg-surface-accent-300 dark:hover:bg-surface-accent-700" : "",
                sizeClassNames[size],
                className)}
            onClick={onClick}
            style={{
                backgroundColor: bgColor,
                color: textColor,
                border: border || undefined,
                overflow: "hidden",
                ...style
            }}
        >
            {children}
            {icon}
        </div>
    );
}
