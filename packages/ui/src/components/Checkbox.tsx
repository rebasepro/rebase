
import React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";

import { CheckIcon, MinusIcon } from "lucide-react";
import { cls } from "../util";

export interface CheckboxProps {
    checked: boolean;
    id?: string;
    disabled?: boolean;
    indeterminate?: boolean;
    onCheckedChange?: (checked: boolean) => void;
    padding?: boolean;
    size?: "smallest" | "small" | "medium" | "large";
    color?: "primary" | "secondary";
    "aria-label"?: string;
}

// Radius steps down with the box. `rounded-md` is 6px — on a 16-20px box that
// is most of the edge, so the control reads as a squircle rather than a
// checkbox. Box sizes match the icon glyph scale (16/16/20/24) so a Checkbox
// sitting beside IconButtons in a table row is the same visual size.
const sizeClasses = {
    large: "w-6 h-6 rounded flex items-center justify-center",
    medium: "w-5 h-5 rounded flex items-center justify-center",
    small: "w-4 h-4 rounded-sm flex items-center justify-center",
    smallest: "w-4 h-4 rounded-sm flex items-center justify-center"
};

// Outer box is the hit area and sets the control's rendered height, so it
// tracks the shared 28/32/40/48 scale. `smallest` used to reuse `small`'s
// 32px box, which made the two sizes identical.
//
// A checkbox with no `onCheckedChange` is not a hit area — it is a tick mark
// standing in for a value, as in `BooleanPreview`. There the box was 10px of
// dead space on each side of a `medium` tick: on top of a read-only field's
// own padding, it started the tick 10px further in than the text of the field
// beside it. `padding={false}` reads as the request to drop it, and until now
// did nothing at all, because it only removed `p-2` from a box whose size was
// fixed regardless. Kept for anything clickable — the same box is the click
// target for table row selection and for editor task items.
const outerSizeClasses = {
    medium: "w-10 h-10",
    small: "w-8 h-8",
    large: "w-12 h-12 ",
    smallest: "w-7 h-7"
}
// Flat p-2, as it always was. `shrink-0` on the box below is what stops it
// being squashed; changing the padding here only shifts the control's optical
// weight relative to the icons beside it.
const paddingClasses = {
    medium: "p-2",
    small: "p-2",
    large: "p-2",
    smallest: "p-2"
}

const colorClasses = {
    primary: "bg-primary",
    secondary: "bg-secondary"
}

export const Checkbox = React.memo(({
                             id,
                             checked,
                             indeterminate = false,
                             padding = true,
                             disabled,
                             size = "medium",
                             onCheckedChange,
                             color = "primary",
                             "aria-label": ariaLabel
                         }: CheckboxProps) => {

    const isChecked = indeterminate ? false : checked;

    const iconSize = size === "medium"
        ? 20
        : size === "small"
            ? 16
            : size === "smallest"
                ? 14
                : 24;
    return (
        <CheckboxPrimitive.Root
            id={id}
            checked={indeterminate || isChecked}
            disabled={disabled}
            aria-label={ariaLabel}
            aria-checked={indeterminate ? "mixed" : isChecked}
            className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            onCheckedChange={disabled ? undefined : onCheckedChange}>

            <div className={cls(
                padding ? paddingClasses[size] : "",
                padding || onCheckedChange ? outerSizeClasses[size] : "",
                "inline-flex items-center justify-center text-sm font-medium focus:outline-none transition-colors ease-in-out duration-150",
                onCheckedChange ? "rounded-full hover:bg-surface-accent-200 hover:bg-opacity-75 hover:bg-surface-accent-200/75 dark:hover:bg-surface-accent-700 dark:hover:bg-opacity-75 dark:hover:bg-surface-accent-700/75" : "",
                onCheckedChange ? "cursor-pointer" : "cursor-default"
            )}>
                <div
                    className={cls(
                        "border-2 shrink-0 relative transition-colors ease-in-out duration-150",
                        sizeClasses[size],
                        disabled
                            ? (indeterminate || isChecked ? "bg-surface-accent-400 dark:bg-surface-accent-600" : "bg-surface-accent-400 dark:bg-surface-accent-600")
                            : (indeterminate || isChecked ? colorClasses[color] : "bg-white dark:bg-surface-900"),
                        (indeterminate || isChecked) ? "text-surface-accent-100 dark:text-surface-accent-900" : "",
                        disabled
                            ? "border-transparent"
                            : (indeterminate || isChecked ? "border-transparent" : "border-surface-accent-800 dark:border-surface-accent-500")
                    )}>
                    <CheckboxPrimitive.Indicator asChild>
                        {indeterminate
                            ? (
                                <MinusIcon size={iconSize} className={"absolute"}/>
                            )
                            : (
                                <CheckIcon size={iconSize} className={"absolute"}/>
                            )}
                    </CheckboxPrimitive.Indicator>
                </div>
            </div>
        </CheckboxPrimitive.Root>
    );
});

Checkbox.displayName = "Checkbox";
