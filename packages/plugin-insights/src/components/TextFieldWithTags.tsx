import { cls, fieldBackgroundDisabledMixin, fieldBackgroundHoverMixin, fieldBackgroundInvisibleMixin, fieldBackgroundMixin, focusedInvisibleMixin, InputLabel } from "@rebasepro/ui";
"use client";
import React, { ForwardedRef, forwardRef, useRef } from "react";


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
    inputRef?: React.ForwardedRef<HTMLInputElement | HTMLTextAreaElement>; // More specific type
    /**
     * Array of tags to display.
     */
    tags?: string[];

    renderTag?: (tag: string, index: number) => React.ReactNode;
    /**
     * Callback fired when the tags array changes.
     */
    onTagsChange?: (tags: string[]) => void;

} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "size" | "onChange" | "value">; // Omit onChange/value as they are explicitly typed

export const TextFieldWithTags = forwardRef<HTMLDivElement, TextFieldProps<string | number>>(
    <T extends string | number>(
        {
            value,
            onChange,
            label,
            type = "text",
            invisible,
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
            tags,
            onTagsChange,
            renderTag, // Destructure renderTag
            ...inputProps
        }: TextFieldProps<T>,
        ref: ForwardedRef<HTMLDivElement>
    ) => {

        const internalInputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
        const inputRef = inputRefProp || internalInputRef;

        // @ts-ignore inputRef can be a ForwardedRef or a RefObject
        const [focused, setFocused] = React.useState(() => !!autoFocus || (typeof document !== "undefined" && document.activeElement === (inputRef && "current" in inputRef ? inputRef.current : null)));
        const hasValue = value !== undefined && value !== null && value !== "";
        const hasTags = tags && tags.length > 0;

        const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
            if (event.key === "Backspace" && !value && hasTags && onTagsChange) {
                const newTags = tags.slice(0, -1);
                onTagsChange(newTags);
                event.preventDefault();
            }
            inputProps.onKeyDown?.(event as any);
        };

        const handleTagRemove = (indexToRemove: number) => {
            if (onTagsChange && tags) {
                const newTags = tags.filter((_, index) => index !== indexToRemove);
                onTagsChange(newTags);
            }
        };

        const currentInputRef = inputRef as React.RefObject<HTMLInputElement | HTMLTextAreaElement>;

        const actualInput = (
            <input
                {...inputProps}
                ref={inputRef as React.Ref<HTMLInputElement>} // Cast for input element
                disabled={disabled}
                style={inputStyle}
                className={cls(
                    "outline-none focus-visible:ring-0 focus-visible:ring-transparent focus-visible:ring-opacity-0 focus-visible:ring-offset-0 focus-visible:ring-offset-transparent",
                    "flex-grow !outline-none bg-transparent leading-normal min-w-[50px]", // min-w to ensure input is visible, no internal padding
                    disabled && "text-text-disabled dark:text-text-disabled-dark cursor-not-allowed",
                    inputClassName
                )}
                placeholder={!label || (focused || hasValue || (hasTags && !value)) ? placeholder : undefined}
                autoFocus={autoFocus}
                onFocus={(e) => {
                    setFocused(true);
                    inputProps.onFocus?.(e);
                }}
                onBlur={(e) => {
                    setFocused(false);
                    inputProps.onBlur?.(e);
                }}
                type={type}
                value={type === "number" && Number.isNaN(Number(value)) ? "" : value ?? ""}
                onChange={onChange}
                onKeyDown={handleKeyDown}
            />
        );

        const tagsAndInputWrapper = (
            <div
                className={cls(
                    "flex flex-wrap items-center w-full !outline-none bg-transparent leading-normal px-3", // Wrapper provides padding
                    "rounded-md",
                    focused && !error && "text-text-primary dark:text-text-primary-dark",
                    invisible ? focusedInvisibleMixin : "",
                    {
                        "min-h-[28px]": size === "smallest",
                        "min-h-[32px]": size === "small",
                        "min-h-[42px]": size === "medium",
                        "min-h-[64px]": size === "large",
                    },
                    label
                        ? size === "large"
                            ? "pt-8 pb-2"
                            : "pt-4 pb-2"
                        : "py-2",
                    endAdornment ? "pr-10" : "pr-3",
                    disabled && "opacity-70"
                )}
                onClick={() => {
                    if (currentInputRef && currentInputRef.current) {
                        currentInputRef.current.focus();
                    }
                }}
            >
                {tags?.map((tag, index) => (
                    <span
                        key={`${tag}-${index}`}
                        className={cls(
                            "inline-flex items-center text-sm font-medium bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-md mr-1.5 px-2 py-0.5",
                            disabled && "opacity-50 cursor-not-allowed"
                        )}
                    >
                                                {renderTag ? renderTag(tag, index) : tag}
                        {!disabled && (
                            <button
                                type="button"
                                aria-label={`Remove ${tag}`}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleTagRemove(index);
                                }}
                                className="ml-1.5 -mr-0.5 p-0.5 rounded-full text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:focus:ring-primary-400"
                            >
                                <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd"
                                          d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                                          clipRule="evenodd"/>
                                </svg>
                            </button>
                        )}
                                                </span>
                ))}
                {actualInput}
            </div>
        );

        return (
            <div
                ref={ref}
                className={cls(
                    "rounded-md relative max-w-full",
                    invisible ? fieldBackgroundInvisibleMixin : fieldBackgroundMixin,
                    disabled ? fieldBackgroundDisabledMixin : (error ? "" : fieldBackgroundHoverMixin),
                    error ? "border border-red-500 dark:border-red-600" : (focused && !invisible ? "border-primary dark:border-primary" : "border-transparent"),
                    !invisible && !error && !disabled && "hover:border-field-border-hover dark:hover:border-field-border-hover-dark",
                    className
                )}
                style={style}
            >
                {label && (
                    <InputLabel
                        className={cls(
                            "pointer-events-none absolute z-10",
                            size === "large" ? "top-1" : "top-[-1px]",
                            !error
                                ? focused
                                    ? "text-primary dark:text-primary"
                                    : "text-text-secondary dark:text-text-secondary-dark"
                                : "text-red-500 dark:text-red-600",
                            disabled ? "opacity-50" : ""
                        )}
                        shrink={hasValue || focused || hasTags}
                    >
                        {label}
                    </InputLabel>
                )}

                {tagsAndInputWrapper}

                {endAdornment && (
                    <div
                        className={cls(
                            "flex flex-row justify-center items-center absolute h-full right-0 top-0 z-10",
                            {
                                "mr-4": size === "large",
                                "mr-3": size === "medium",
                                "mr-2": size === "small" || size === "smallest",
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

TextFieldWithTags.displayName = "TextFieldWithTags";
