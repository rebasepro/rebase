import React from "react";
import { cls } from "../util";

export interface FilterChipProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
    /**
     * The text label displayed on the chip.
     */
    children: React.ReactNode;
    /**
     * Whether the chip is currently in an active/selected state.
     */
    active?: boolean;
    /**
     * Optional icon rendered before the label.
     */
    icon?: React.ReactNode;
    /**
     * Size variant.
     * @default "medium"
     */
    size?: "small" | "medium";
    /**
     * Whether the chip is disabled.
     */
    disabled?: boolean;
}

const sizeClasses = {
    small: "px-2 py-0.5 text-xs",
    medium: "px-2.5 py-1 text-xs"
};

/**
 * A toggle chip used for filter presets and similar multi-select controls.
 *
 * Reads as a text tab: no fill at rest, the alpha highlight when active. It
 * shares no grammar with the tinted enum {@link Chip}, which carries a hue.
 *
 * @group Interactive components
 */
export const FilterChip = React.forwardRef<HTMLButtonElement, FilterChipProps>(function FilterChip({
    children,
    active = false,
    onClick,
    icon,
    size = "medium",
    className,
    disabled = false,
    ...rest
}: FilterChipProps, ref) {
    return (
        <button
            ref={ref}
            type="button"
            onClick={onClick}
            disabled={disabled}
            className={cls(
                "inline-flex items-center gap-1 rounded-md",
                "font-medium whitespace-nowrap select-none shrink-0",
                "transition-colors duration-150",
                // Colour only, no width: the 2px comes from the global inset ring, which a
                // chip needs because the preset row it sits in is a horizontal
                // scroller — an outset ring on the first or last chip was cut off
                // by the scrollport edge.
                "focus-visible:outline-none focus-visible:ring-primary/50",
                sizeClasses[size],
                !disabled && "cursor-pointer",
                // Hover is one step along the same ramp the chip already sits
                // on, the way every other hoverable surface here moves. It used
                // to be `hover:bg-primary/5` for the inactive chip, which
                // *replaces* the resting fill with a tint fainter than it — so
                // pointing at a chip made its background vanish. The active chip
                // had no hover state at all.
                // These are view presets, not enum values, so they take the row
                // grammar (an alpha highlight for the active one, text otherwise)
                // and not the chip grammar (a hue tint). A primary ring here made
                // every preset look like a selected enum cell.
                active
                    ? "bg-surface-active text-text-primary dark:text-text-primary-dark"
                    : cls(
                        "bg-transparent text-text-secondary dark:text-text-secondary-dark",
                        !disabled && "hover:bg-surface-hover"
                    ),
                disabled && "opacity-50 cursor-not-allowed",
                className
            )}
            {...rest}
        >
            {icon}
            {children}
        </button>
    );
});
