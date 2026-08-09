"use client";
import React, { ForwardedRef, forwardRef, useEffect, useId, useRef } from "react";

import {
    fieldBackgroundDisabledMixin,
    fieldBackgroundHoverMixin,
    fieldBackgroundInvisibleMixin,
    fieldBackgroundMixin,
    focusedInvisibleMixin
} from "../styles";
import { InputLabel } from "./InputLabel";
import { cls } from "../util";

export type InputType =
    | "text"
    | "number"
    | "phone"
    | "email"
    | "password"
    | "search"
    | "url"
    | "date"
    | "time"
    | "datetime-local"
    | "month"
    | "week"
    | "color";

export type TextFieldProps<T extends string | number> = {
    type?: InputType;
    value?: T;
    onChange?: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
    label?: React.ReactNode;
    multiline?: boolean;
    disabled?: boolean;
    invisible?: boolean;
    error?: boolean;
    endAdornment?: React.ReactNode;
    autoFocus?: boolean;
    placeholder?: string;
    size?: "smallest" | "small" | "medium" | "large";
    className?: string;
    style?: React.CSSProperties;
    inputClassName?: string;
    inputStyle?: React.CSSProperties;
    inputRef?: React.ForwardedRef<any>;
    /**
     * Maximum number of rows to display.
     */
    maxRows?: number | string;
    /**
     * Minimum number of rows to display.
     * @default 1
     */
    minRows?: number | string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "size" | "value">;

export const TextField = forwardRef<HTMLDivElement, TextFieldProps<string | number>>(
    <T extends string | number>(
        {
            value,
            onChange,
            label,
            type = "text",
            multiline = false,
            invisible,
            maxRows,
            minRows,
            disabled,
            error,
            endAdornment,
            autoFocus,
            placeholder,
            size = "large",
            className,
            style,
            inputClassName,
            inputStyle,
            inputRef: inputRefProp,
            ...inputProps
        }: TextFieldProps<T>,
        ref: ForwardedRef<HTMLDivElement>
    ) => {

        const fallbackRef = useRef(null);
        const inputRef = inputRefProp ?? fallbackRef;
        const autoId = useId();
        const inputId = inputProps.id ?? autoId;
        const labelId = `${inputId}-label`;

        const [focused, setFocused] = React.useState(false);
        const hasValue = value !== undefined && value !== null && value !== "";

        useEffect(() => {
            const element = inputRef && "current" in inputRef ? inputRef.current : null;
            if (element && document.activeElement === element) {
                setFocused(true);
            }
        }, []);

        useEffect(() => {
            if (type !== "number") return;
            const handleWheel = (event: any) => {
                if (event.target instanceof HTMLElement) event.target.blur();
            };

            const element = "current" in inputRef ? inputRef.current : inputRef;

            element?.addEventListener("wheel", handleWheel);

            return () => {
                element?.removeEventListener("wheel", handleWheel);
            };
        }, [inputRef, type]);

        const input = multiline ? (
            <textarea
                {...(inputProps as React.TextareaHTMLAttributes<HTMLTextAreaElement>)}
                ref={inputRef}
                id={inputId}
                // Falls back to the caller's own value rather than to `undefined`:
                // this sits after the spread, so hardcoding `undefined` silently
                // erased an `aria-labelledby` a consumer had passed, and the
                // unlabelled field it was meant to name stayed unnamed.
                aria-labelledby={label ? labelId : inputProps["aria-labelledby"]}
                aria-invalid={error || undefined}
                aria-disabled={disabled || undefined}
                placeholder={focused || hasValue || !label ? placeholder : undefined}
                autoFocus={autoFocus}
                rows={typeof minRows === "string" ? parseInt(minRows) : (minRows ?? 3)}
                value={value ?? ""}
                onChange={onChange}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                style={inputStyle}
                className={cls(
                    invisible ? focusedInvisibleMixin : "",
                    "rounded-lg resize-none w-full outline-none text-base bg-transparent min-h-[64px] px-3",
                    label ? "pt-8 pb-2" : "py-2",
                    disabled && "outline-none opacity-50 text-surface-accent-600 dark:text-surface-accent-500",
                    inputClassName
                )}
            />
        ) : (
            <input
                {...inputProps}
                ref={inputRef}
                id={inputId}
                // See the textarea branch: preserve a caller-supplied
                // `aria-labelledby` instead of overwriting it with `undefined`.
                aria-labelledby={label ? labelId : inputProps["aria-labelledby"]}
                aria-invalid={error || undefined}
                aria-disabled={disabled || undefined}
                disabled={disabled}
                style={inputStyle}
                className={cls(
                    "w-full outline-none bg-transparent leading-normal px-3",
                    "rounded-lg",
                    "focused:text-text-primary focused:dark:text-text-primary-dark",
                    invisible ? focusedInvisibleMixin : "",
                    disabled ? fieldBackgroundDisabledMixin : fieldBackgroundHoverMixin,
                    {
                        "min-h-[28px]": size === "smallest",
                        "min-h-[32px]": size === "small",
                        "min-h-[40px]": size === "medium",
                        "min-h-[48px]": size === "large"
                    },
                    /* A shrunk label occupies roughly the first 16px of the
                       box (`top-[-1px]`, translated down 2px, ~15px tall at
                       scale-75). `pt-4` put the value's first line at exactly
                       16px, so label and content shared a row: a labelled
                       `small` field with a placeholder rendered "Name" on top
                       of "e.g. Analytics Pipeline". `large` was never affected
                       — it reserves `pt-8`. */
                    label
                        // Labelled fields sit exactly 16px above the unlabelled
                        // scale (44/48/56/64 against 28/32/40/48). smallest,
                        // small and medium all used to share `pt-5 pb-1.5`, so
                        // they rendered at an identical 50px and `size` looked
                        // inert whenever a label was present.
                        ? { smallest: "pt-4 pb-1", small: "pt-5 pb-1", medium: "pt-6 pb-2", large: "pt-8 pb-2" }[size]
                        : size === "smallest"
                            ? "py-0.5"
                            : size === "small"
                                ? "py-1"
                                : "py-2",
                    endAdornment ? "pr-12" : "pr-3",
                    disabled &&
                    "outline-none opacity-65 dark:opacity-60 text-surface-accent-800 dark:text-white",
                    inputClassName
                )}
                placeholder={focused || hasValue || !label ? placeholder : undefined}
                autoFocus={autoFocus}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                type={type}
                value={type === "number" && Number.isNaN(value) ? "" : value ?? ""}
                onChange={onChange}
            />
        );

        return (
            <div
                ref={ref}
                className={cls(
                    "rounded-lg relative max-w-full",
                    invisible ? fieldBackgroundInvisibleMixin : fieldBackgroundMixin,
                    disabled ? fieldBackgroundDisabledMixin : fieldBackgroundHoverMixin,
                    error ? "border border-red-500 dark:border-red-600" : "",
                    {
                        "min-h-[28px]": size === "smallest",
                        "min-h-[32px]": size === "small",
                        "min-h-[40px]": size === "medium",
                        "min-h-[48px]": size === "large"
                    },
                    className
                )}
                style={style}
            >
                {label && (
                    <InputLabel
                        id={labelId}
                        htmlFor={inputId}
                        className={cls(
                            "pointer-events-none absolute",
                            size === "large" ? "top-1" : "top-[-1px]",
                            !error
                                ? focused
                                    ? "text-primary dark:text-primary"
                                    : "text-text-secondary dark:text-text-secondary-dark"
                                : "text-red-500 dark:text-red-600",
                            disabled ? "opacity-50" : ""
                        )}
                        shrink={hasValue || focused}
                    >
                        {label}
                    </InputLabel>
                )}

                {input}

                {endAdornment && (
                    <div
                        className={cls(
                            "flex flex-row justify-center items-center absolute h-full right-0 top-0",
                            {
                                "mr-4": size === "large",
                                "mr-3": size === "medium",
                                "mr-2": size === "small" || size === "smallest"
                            }
                        )}
                    >
                        {endAdornment}
                    </div>
                )}
            </div>
        );
    }
);

TextField.displayName = "TextField";
