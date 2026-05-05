"use client";

export type IconColor = "inherit" | "primary" | "secondary" | "disabled" | "error" | "success" | "warning";
export type IconSize = "smallest" | "small" | "medium" | "large";

/**
 * Standardized icon size map in px.
 * Use with direct Lucide imports: `<Database size={iconSize.small} />`
 */
export const iconSize = {
    smallest: 16,
    small: 20,
    medium: 24,
    large: 28,
} as const satisfies Record<IconSize, number>;

export type IconProps = {
    size?: IconSize | number,
    color?: IconColor,
    className?: string,
    onClick?: (e: React.SyntheticEvent) => void,
    style?: React.CSSProperties,
}

export const colorClassesMapping: Record<IconColor, string> = {
    inherit: "",
    primary: "text-primary",
    success: "text-green-500",
    warning: "text-yellow-500",
    secondary: "text-secondary",
    disabled: "text-text-disabled dark:text-text-disabled-dark",
    error: "text-red-500"
}
