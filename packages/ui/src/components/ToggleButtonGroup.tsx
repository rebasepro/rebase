import React from "react";
import { cls } from "../util";

export type ToggleButtonOption<T extends string = string> = {
    value: T;
    label: string;
    icon?: React.ReactNode;
    disabled?: boolean;
}

export type ToggleButtonGroupProps<T extends string = string> = {
    /**
     * Currently selected value
     */
    value: T;
    /**
     * Callback when value changes
     */
    onValueChange: (value: T) => void;
    /**
     * Options to display
     */
    options: ToggleButtonOption<T>[];
    /**
     * Additional class names for the container
     */
    className?: string;
}

/**
 * A toggle button group component for selecting one option from a set.
 * Displays options as buttons in a horizontal row with active state styling.
 */
export function ToggleButtonGroup<T extends string = string>({
    value,
    onValueChange,
    options,
    className
}: ToggleButtonGroupProps<T>) {
    return (
        // A 32px rounded track (`lg`) with `md` segments. It was 48px with a
        // blue label on the active segment; the lifted fill already says which
        // segment is on, so the label stays in the primary ink and the hue is
        // not spent twice.
        <div role="group" aria-label="Toggle options" className={cls("inline-flex flex-row bg-surface-field rounded-lg p-1 gap-1", className)}>
            {options.map((option) => (
                <button
                    key={option.value}
                    type="button"
                    onClick={(e) => {
                        e.stopPropagation();
                        if (!option.disabled) {
                            onValueChange(option.value);
                        }
                    }}
                    disabled={option.disabled}
                    aria-pressed={value === option.value}
                    aria-disabled={option.disabled || undefined}
                    className={cls(
                        "flex flex-row items-center justify-center gap-2 h-6 px-3.5 rounded-md transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
                        value === option.value
                            ? "bg-surface-lifted text-text-primary dark:text-text-primary-dark shadow-sm"
                            : "text-text-secondary dark:text-text-secondary-dark hover:bg-surface-hover",
                        option.disabled && "opacity-50 cursor-not-allowed"
                    )}
                >
                    {option.icon}
                    <span className="text-xs font-medium">{option.label}</span>
                </button>
            ))}
        </div>
    );
}
