"use client";
import React from "react";
import { cls } from "../util";

/**
 * Switch geometry, one row per size: track w x h, knob k, and the knob's
 * off/on x-offsets. `on` is always `w - k - inset` so the knob is inset by the
 * same amount at both ends and vertically centred.
 *
 * This is a table rather than inline `cls({...})` conditions on purpose. The
 * offsets used to be computed object keys — `[value ? "translate-x-[24px]" :
 * "translate-x-[3px]"]: size === "large"` — and `large` and `medium` both
 * produced the key `translate-x-[3px]` when off. The later literal overwrote
 * the earlier, so the off-state class was silently dropped for `large` and the
 * knob sat flush against the edge.
 */
const SWITCH_GEOMETRY = {
    smallest: {
        track: "w-[34px] h-[18px] min-w-[34px] min-h-[18px]",
        knob: "w-[16px] h-[16px]", off: "translate-x-[1px]", on: "translate-x-[17px]",
        bar: "w-[16px] h-[6px]", barX: "translate-x-[9px]"
    },
    small: {
        track: "w-[38px] h-[22px] min-w-[38px] min-h-[22px]",
        knob: "w-[18px] h-[18px]", off: "translate-x-[2px]", on: "translate-x-[18px]",
        bar: "w-[18px] h-[8px]", barX: "translate-x-[10px]"
    },
    medium: {
        track: "w-[44px] h-[26px] min-w-[44px] min-h-[26px]",
        knob: "w-[20px] h-[20px]", off: "translate-x-[3px]", on: "translate-x-[21px]",
        bar: "w-[20px] h-[10px]", barX: "translate-x-[12px]"
    },
    large: {
        track: "w-[48px] h-[28px] min-w-[48px] min-h-[28px]",
        knob: "w-[22px] h-[22px]", off: "translate-x-[3px]", on: "translate-x-[23px]",
        bar: "w-[22px] h-[11px]", barX: "translate-x-[13px]"
    }
} as const;

export type BooleanSwitchProps = {
    value: boolean | null;
    className?: string;
    disabled?: boolean;
    size?: "smallest" | "small" | "medium" | "large";
} & ({
    allowIndeterminate: true;
    onValueChange?: (newValue: boolean | null) => void;
} | {
    allowIndeterminate?: false;
    onValueChange?: (newValue: boolean) => void;
});

export const BooleanSwitch = React.forwardRef(function BooleanSwitch({
                                                                         value,
                                                                         allowIndeterminate,
                                                                         className,
                                                                         onValueChange,
                                                                         disabled = false,
                                                                         size = "medium",
                                                                         ...props
                                                                     }: BooleanSwitchProps, ref: React.Ref<HTMLButtonElement>) {
        return <button
            type="button"
            role="switch"
            aria-checked={allowIndeterminate && (value === null || value === undefined) ? "mixed" : !!value}
            aria-disabled={disabled || undefined}
            ref={ref}
            tabIndex={disabled ? -1 : undefined}
            onClick={disabled
                ? (e) => e.preventDefault()
                : (e) => {
                    e.preventDefault();
                    if (allowIndeterminate) {
                        if (value === null || value === undefined) onValueChange?.(true)
                        else if (value) onValueChange?.(false)
                        else onValueChange?.(null);
                    } else {
                        onValueChange?.(!value);
                    }
                }}
            className={cls(
                // `large` used to share the `medium` branch, so the two sizes
                // rendered identically and the prop looked inert. Geometry is
                // now derived from one table (see SWITCH_GEOMETRY) so the knob
                // inset is symmetric at every size.
                SWITCH_GEOMETRY[size].track,
                "outline-none outline-hidden rounded-full relative shadow-sm",
                // On is the primary, not the secondary rose: a boolean is the one
                // place the product turns a hue into a value, and the hue it uses
                // should be the one that means "yes" everywhere else (the primary
                // button, the checked checkbox). The rose stays a marketing token.
                // Off is the neutral `active` fill with a strong hairline, so the
                // track is visible on every surface without a fill of its own;
                // disabled keeps its state legible at reduced strength.
                disabled
                    ? (value ? "bg-primary/40 ring-1 ring-transparent" : "bg-surface-field ring-1 ring-hairline")
                    : (value ? "bg-primary ring-1 ring-primary" : "bg-surface-active ring-1 ring-hairline-strong"),
                className
            )}
            {...props}
        >
            {allowIndeterminate && (value === null || value === undefined) && <div
                key={"knob"}
                className={cls(
                    "block rounded-full transition-transform duration-100 ease-out transform will-change-auto shadow-sm",
                    // A glyph on the track, not a surface: the numbered grey is the
                    // knob's own colour on both themes.
                    "bg-surface-400",
                    SWITCH_GEOMETRY[size].bar,
                    SWITCH_GEOMETRY[size].barX
                )}
            />}

            {!(allowIndeterminate && (value === null || value === undefined)) && <div
                key={"knob"}
                className={cls(
                    "block rounded-full transition-transform duration-100 ease-out transform will-change-auto shadow-sm",
                    disabled ? "bg-surface-300 dark:bg-surface-600" : (value ? "bg-white shadow" : "bg-surface-500 dark:bg-surface-400"),
                    SWITCH_GEOMETRY[size].knob,
                    value ? SWITCH_GEOMETRY[size].on : SWITCH_GEOMETRY[size].off
                )}
            />}
        </button>;
    }
) as React.ForwardRefExoticComponent<BooleanSwitchProps & React.RefAttributes<HTMLButtonElement>>;
