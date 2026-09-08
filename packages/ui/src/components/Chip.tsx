import React from "react";
import { CHIP_COLORS, cls, getColorSchemeForKey } from "../util";
import type { ChipColorKey, ChipColorScheme } from "../util/chip_colors";
import { useIsDarkMode } from "../hooks/useIsDarkMode";

export type { ChipColorKey, ChipColorScheme };

export interface ChipProps {
    className?: string;
    children: React.ReactNode;
    size?: "smallest" | "small" | "medium" | "large";
    colorScheme?: ChipColorScheme | ChipColorKey;
    /**
     * How a coloured chip paints its hue. `tinted` (the default) is the hue at
     * low alpha behind hue-coloured ink: a label, not a block, and the rule the
     * chrome follows for colour everywhere else (a dot, an icon, an outline, a
     * tint — never a fill). `filled` is the palette's solid stop, for the few
     * places that want a swatch: a colour picker, a legend. A custom scheme
     * without tint values falls back to `filled`.
     */
    variant?: "tinted" | "filled";
    error?: boolean;
    outlined?: boolean;
    onClick?: () => void;
    icon?: React.ReactNode;
    style?: React.CSSProperties;
}

// `small` and `medium` used to differ only in horizontal padding, so both
// rendered at the same height and the step was invisible. Vertical rhythm now
// increases across the whole scale.
const sizeClassNames = {
    smallest: "px-1.5 py-px text-[10px]",
    small: "px-2 py-0.5 text-xs",
    medium: "px-2.5 py-1 text-xs",
    large: "px-3 py-1.5 text-sm"
}

/**
 * Helper to generate rgba from hex or standard colors.
 */
function getRgba(hex: string, alpha: number): string {
    if (!hex || !hex.startsWith("#")) return hex;
    let color = hex.slice(1);
    if (color.length === 3) {
        color = color[0] + color[0] + color[1] + color[1] + color[2] + color[2];
    }
    const r = parseInt(color.slice(0, 2), 16);
    const g = parseInt(color.slice(2, 4), 16);
    const b = parseInt(color.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * @group Preview components
 */
export function Chip({
                         children,
                         colorScheme,
                         error,
                         outlined,
                         variant = "tinted",
                         onClick,
                         icon,
                         size = "medium",
                         className,
                         style
                     }: ChipProps) {

    const usedColorScheme = typeof colorScheme === "string" ? getColorSchemeForKey(colorScheme) : colorScheme;
    // Live, not read once: the ink is chosen in JS per theme, so a theme switch
    // has to reach every mounted chip (see useIsDarkMode).
    const dark = useIsDarkMode();

    const hasScheme = error || usedColorScheme;

    let textColor = "";
    let bgColor = "";
    let border = "";

    if (error) {
        textColor = dark ? "#f87171" : "#dc2626";
    } else if (usedColorScheme) {
        textColor = dark && usedColorScheme.darkText ? usedColorScheme.darkText : usedColorScheme.text;
    }

    if (hasScheme) {
        if (outlined) {
            // An outlined chip has no fill, so it needs the ink meant for the
            // PAGE, not the ink meant for the fill it just dropped. Those are
            // different colours for most hues — a bright `solid` chip carries
            // dark ink, which on a near-black page would be invisible.
            if (!error && usedColorScheme) {
                const outlineInk = dark
                    ? usedColorScheme.darkOutlineText ?? usedColorScheme.darkText
                    : usedColorScheme.outlineText;
                if (outlineInk) textColor = outlineInk;
            }
            bgColor = getRgba(textColor, dark ? 0.1 : 0.06);
            border = `1px solid ${getRgba(textColor, dark ? 0.2 : 0.14)}`;
        } else if (error) {
            bgColor = dark ? "rgba(220, 38, 38, 0.15)" : "rgba(239, 68, 68, 0.1)";
            border = `1px solid ${dark ? "rgba(220, 38, 38, 0.3)" : "rgba(239, 68, 68, 0.2)"}`;
        } else if (usedColorScheme) {
            const tintColor = dark ? usedColorScheme.darkTintColor : usedColorScheme.tintColor;
            const tintText = dark ? usedColorScheme.darkTintText : usedColorScheme.tintText;
            if (variant === "tinted" && tintColor && tintText) {
                bgColor = tintColor;
                textColor = tintText;
            } else {
                bgColor = dark && usedColorScheme.darkColor ? usedColorScheme.darkColor : usedColorScheme.color;
            }
        }
    }

    return (
        <div
            // `rounded-md`, not `lg`: a radius is proportional to the thing it
            // rounds. At a chip's 20-24px height the control radius makes a pill,
            // and a pill is a different object (a segment, a search field).
            className={cls("rounded-md max-w-full w-max h-fit font-medium inline-flex gap-1",
                "text-ellipsis",
                "items-center",
                "transition-colors duration-150",
                !hasScheme && "bg-surface-raised text-text-secondary dark:text-text-secondary-dark",
                !hasScheme && outlined && "bg-transparent border border-hairline-strong",
                onClick ? "cursor-pointer hover:bg-surface-raised-hover" : "",
                sizeClassNames[size],
                className)}
            onClick={onClick}
            style={{
                ...(hasScheme ? {
                    backgroundColor: bgColor,
                    color: textColor,
                    border: border || undefined,
                } : {}),
                overflow: "hidden",
                ...style
            }}
        >
            {icon}
            {children}
        </div>
    );
}
