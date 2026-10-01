"use client";
import React from "react";
import {
    controlHeightMixin,
    fieldBackgroundDisabledMixin,
    fieldBackgroundHoverMixin,
    fieldBackgroundMixin,
    focusedClasses,
    focusedDisabled
} from "../styles";
import { BooleanSwitch, BooleanSwitchProps } from "./BooleanSwitch";
import { cls } from "../util";

export type BooleanSwitchWithLabelProps = BooleanSwitchProps & {
    position?: "start" | "end",
    invisible?: boolean,
    label?: React.ReactNode,
    error?: boolean,
    autoFocus?: boolean,
    fullWidth?: boolean,
    className?: string,
    inputClassName?: string,
};

/**
 * Simple boolean switch.
 *
 */
export const BooleanSwitchWithLabel = function BooleanSwitchWithLabel({
                                                                          value,
                                                                          position = "end",
                                                                          size = "medium",
                                                                          invisible,
                                                                          onValueChange,
                                                                          error,
                                                                          label,
                                                                          autoFocus,
                                                                          disabled,
                                                                          className,
                                                                          fullWidth = true,
                                                                          inputClassName,
                                                                          "aria-label": ariaLabel,
                                                                          "aria-labelledby": ariaLabelledBy,
                                                                          ...props
                                                                      }: BooleanSwitchWithLabelProps) {

    const ref = React.useRef<HTMLDivElement | null>(null);
    const refInput = React.useRef<HTMLButtonElement | null>(null);
    const switchLabelId = React.useId();
    const [_, setFocused] = React.useState(autoFocus)
    const onFocus = () => setFocused(true);
    const onBlur = () => setFocused(false);

    React.useEffect(() => {
        if (autoFocus) refInput.current?.focus();
        // Mount only, like the `autoFocus` attribute it stands in for.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const focus = document.activeElement === refInput?.current || document.activeElement === ref?.current

    return (
        // The row is a click target only. It used to be a second
        // `role="switch"` carrying the label, wrapped around the real switch
        // (the one that takes focus), which had no name: a screen reader
        // tabbing in heard "switch, off". The label now names the switch.
        <div
            ref={ref}
            onFocus={onFocus}
            onBlur={onBlur}
            className={cls(
                !invisible && fieldBackgroundMixin,
                !invisible && (disabled ? fieldBackgroundDisabledMixin : fieldBackgroundHoverMixin),
                disabled ? "cursor-default" : "cursor-pointer",
                "rounded-lg max-w-full justify-between box-border relative inline-flex items-center",
                !invisible && focus && !disabled ? focusedClasses : "",
                error ? "text-red-500 dark:text-red-600" : (focus && !disabled ? "text-primary" : (!disabled ? "text-text-primary dark:text-text-primary-dark" : "text-text-secondary dark:text-text-secondary-dark")),
                // The one control size scale — 28/32/40/48. This component still
                // carried its own map (…/44/64), so a switch at `large` stood
                // 16px taller than the text field beside it, which read as a
                // giant empty box once the label moved out of the control.
                controlHeightMixin[size],
                size === "small" || size === "smallest" ? "pl-2" : "pl-4",
                size === "small" || size === "smallest" ? "pr-4" : "pr-6",
                position === "end" ? "flex-row-reverse" : "flex-row",
                fullWidth ? "w-full" : "",
                className
            )}
            onClick={disabled ? undefined : (e) => {
                if (props.allowIndeterminate) {
                    const onChange = onValueChange as ((newValue: boolean | null) => void) | undefined;
                    if (value === null || value === undefined) onChange?.(true)
                    else if (value) onChange?.(false)
                    else onChange?.(null);
                } else {
                    onValueChange?.(!value);
                }
            }}
        >

            <BooleanSwitch
                value={value}
                ref={refInput}
                size={size}
                aria-labelledby={ariaLabelledBy ?? (label ? switchLabelId : undefined)}
                aria-label={ariaLabel}
                // The row draws the focus ring around the whole field; a second
                // ring on the switch inside it would be noise. Invisible rows
                // have no ring of their own, so the switch keeps it.
                className={cls(invisible ? (focus ? focusedClasses : "") : focusedDisabled, inputClassName)}
                disabled={disabled}
                {...props}
            />

            <div id={switchLabelId} className={cls(
                "grow",
                position === "end" ? "mr-4" : "ml-4",
                size === "small" || size === "smallest" ? "text-sm" : "text-base"
            )}>
                {label}
            </div>

        </div>

    );
};
