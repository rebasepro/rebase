
"use client";

import React, { useId, useRef, useState } from "react";
import { CalendarIcon, XIcon, AlertCircleIcon } from "lucide-react";
import { iconSize } from "../icons/Icon";
import { IconButton } from "./IconButton";
import { fieldBackgroundDisabledMixin, fieldBackgroundHoverMixin, fieldBackgroundMixin } from "../styles";
import { InputLabel } from "./InputLabel";
import { Typography } from "./Typography";
import { cls } from "../util";
import { useInjectStyles } from "../hooks";

export type DateTimeFieldProps = {
    value?: Date | null;
    onChange?: (date: Date | null) => void;
    mode?: "date" | "date_time";
    disabled?: boolean;
    clearable?: boolean;
    error?: boolean;
    size?: "smallest" | "small" | "medium" | "large";
    label?: React.ReactNode;
    className?: string;
    style?: React.CSSProperties;
    inputClassName?: string;
    invisible?: boolean;
    locale?: string;
    /**
     * IANA timezone string (e.g., "America/New_York", "Europe/London").
     * Used to display and input dates in the specified timezone.
     * The value passed to onChange will always be in UTC.
     * If not provided, uses the user's local timezone.
     */
    timezone?: string;
    /**
     * Names the control when there is no `label` — e.g. when the surrounding
     * form draws the label itself and passes `label={undefined}`.
     */
    "aria-label"?: string;
};

export const DateTimeField: React.FC<DateTimeFieldProps> = ({
    value,
    label,
    onChange,
    disabled,
    clearable,
    mode = "date",
    error,
    size = "large",
    className,
    style,
    inputClassName,
    invisible,
    timezone,
    "aria-label": ariaLabel
}) => {
    const inputRef = useRef<HTMLInputElement>(null);
    const [focused, setFocused] = useState(false);
    // The label was decorative: an InputLabel with no `htmlFor` beside an input
    // with no `id`, so a date field announced itself by its value even when it
    // visibly had a label. Wired the way TextField already does it.
    const inputId = useId();
    const labelId = `${inputId}-label`;
    const [internalValue, setInternalValue] = useState<string>("");
    const [isTyping, setIsTyping] = useState(false);
    const invalidValue = value !== undefined && value !== null && (!(value instanceof Date) || isNaN(value.getTime()));

    // The calendar/clear adornments are IconButtons. Left at their default
    // (`medium`, 40px) they floored the whole field at 40px, so smallest/small
    // rendered identically to medium. Keep them a step below the field.
    const adornmentSize = size === "large" ? "medium" : size === "medium" ? "small" : "smallest";

    useInjectStyles("DateTimeField", inputStyles);

    const handleClear = (e: React.MouseEvent) => {
        e.preventDefault();
        setInternalValue("");
        setIsTyping(false);
        onChange?.(null);
    };

    // Convert UTC Date to display string in the specified timezone
    const valueAsInputValue = (
        dateValue: Date | null,
        mode: "date" | "date_time"
    ) => {
        if (!dateValue || !(dateValue instanceof Date) || isNaN(dateValue.getTime())) {
            return "";
        }
        const pad = (n: number) => n.toString().padStart(2, "0");

        // Use Intl.DateTimeFormat to get date parts in the target timezone
        const options: Intl.DateTimeFormatOptions = {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
            timeZone: timezone // undefined = local timezone
        };

        const formatter = new Intl.DateTimeFormat("en-CA", options);
        const parts = formatter.formatToParts(dateValue);

        const getPart = (type: string) => parts.find(p => p.type === type)?.value ?? "";

        const year = getPart("year");
        const month = getPart("month");
        const day = getPart("day");

        if (mode === "date") {
            return `${year}-${month}-${day}`;
        } else {
            const hours = getPart("hour");
            const minutes = getPart("minute");
            return `${year}-${month}-${day}T${hours}:${minutes}`;
        }
    };

    // Get the UTC offset for a specific date in the target timezone (in minutes)
    const getTimezoneOffsetMinutes = (date: Date, tz?: string): number => {
        if (!tz) {
            // Local timezone: use built-in getTimezoneOffset (returns offset in minutes, inverted sign)
            return -date.getTimezoneOffset();
        }
        // For named timezones, calculate the offset by comparing formatted times
        const utcFormatter = new Intl.DateTimeFormat("en-CA", {
            year: "numeric",
month: "2-digit",
day: "2-digit",
            hour: "2-digit",
minute: "2-digit",
hour12: false,
            timeZone: "UTC"
        });
        const tzFormatter = new Intl.DateTimeFormat("en-CA", {
            year: "numeric",
month: "2-digit",
day: "2-digit",
            hour: "2-digit",
minute: "2-digit",
hour12: false,
            timeZone: tz
        });

        const utcParts = utcFormatter.formatToParts(date);
        const tzParts = tzFormatter.formatToParts(date);

        const getPart = (parts: Intl.DateTimeFormatPart[], type: string) =>
            parseInt(parts.find(p => p.type === type)?.value ?? "0", 10);

        const utcDate = new Date(Date.UTC(
            getPart(utcParts, "year"),
            getPart(utcParts, "month") - 1,
            getPart(utcParts, "day"),
            getPart(utcParts, "hour"),
            getPart(utcParts, "minute")
        ));

        const tzDate = new Date(Date.UTC(
            getPart(tzParts, "year"),
            getPart(tzParts, "month") - 1,
            getPart(tzParts, "day"),
            getPart(tzParts, "hour"),
            getPart(tzParts, "minute")
        ));

        return (tzDate.getTime() - utcDate.getTime()) / 60000;
    };

    // Handle input value change - convert from display timezone to UTC
    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const inputValue = e.target.value;
        setInternalValue(inputValue);
        setIsTyping(true);

        if (!inputValue) {
            onChange?.(null);
            return;
        }

        try {
            let year: number, month: number, day: number, hours = 0, minutes = 0;

            if (mode === "date") {
                // Parse date-only input: "YYYY-MM-DD"
                [year, month, day] = inputValue.split("-").map(Number);
            } else {
                // Parse datetime-local input: "YYYY-MM-DDTHH:MM"
                const [datePart, timePart] = inputValue.split("T");
                [year, month, day] = datePart.split("-").map(Number);
                [hours, minutes] = timePart.split(":").map(Number);
            }

            let resultDate: Date;

            if (!timezone) {
                // No timezone specified: interpret input as local time (backward compatible)
                resultDate = new Date(year, month - 1, day, hours, minutes);
            } else {
                // Timezone specified: interpret input as that timezone and convert to UTC
                // We need to find the UTC equivalent of the entered time in the target timezone

                // Create a reference UTC date to calculate the offset for this moment
                const refUtcDate = new Date(Date.UTC(year, month - 1, day, hours, minutes));
                const offsetMinutes = getTimezoneOffsetMinutes(refUtcDate, timezone);

                // Convert from target timezone to UTC:
                // If user entered 00:00 in Mexico (UTC-6, offset=-360), we subtract the offset
                // Date.UTC gives us 00:00 UTC, subtracting -360 minutes (= adding 360 min) gives 06:00 UTC
                resultDate = new Date(Date.UTC(year, month - 1, day, hours, minutes) - offsetMinutes * 60000);
            }

            if (isNaN(resultDate.getTime())) {
                throw new Error("Invalid date");
            }

            onChange?.(resultDate);
        } catch (e) {
            // Don't call onChange with null while typing
            return;
        }
    };

    const handleFocus = () => {
        setFocused(true);
        setIsTyping(true);
        setInternalValue(valueAsInputValue(value ?? null, mode));
    };

    const handleBlur = () => {
        setFocused(false);
        setIsTyping(false);
    };

    return (
        <>
            {/* Inject the styles to hide the calendar icon */}
            <style>{inputStyles}</style>
            <div
                className={cls(
                    "rounded-lg relative max-w-full",
                    !invisible && fieldBackgroundMixin,
                    disabled ? fieldBackgroundDisabledMixin : fieldBackgroundHoverMixin,
                    {
                        "min-h-[28px]": size === "smallest",
                        "min-h-[32px]": size === "small",
                        "min-h-[40px]": size === "medium",
                        "min-h-[48px]": size === "large"
                    },
                    className
                )}
                style={style}
                onClick={() => {
                    if (!disabled) {
                        inputRef.current?.focus();
                    }
                }}
            >
                {label && (
                    <InputLabel
                        id={labelId}
                        htmlFor={inputId}
                        className={cls(
                            "absolute top-1 pointer-events-none",
                            !error
                                ? focused
                                    ? "text-primary"
                                    : "text-text-secondary dark:text-text-secondary-dark"
                                : "text-red-600 dark:text-red-500",
                            disabled ? "opacity-50" : ""
                        )}
                        shrink={true}
                    // shrink={hasValue || focused}
                    >
                        {label}
                    </InputLabel>
                )}

                <input
                    ref={inputRef}
                    id={inputId}
                    aria-labelledby={label ? labelId : undefined}
                    aria-label={label ? undefined : ariaLabel}
                    type={mode === "date_time" ? "datetime-local" : "date"}
                    value={isTyping ? internalValue : valueAsInputValue(value ?? null, mode)}
                    onChange={handleInputChange}
                    onFocus={handleFocus}
                    onBlur={handleBlur}
                    disabled={disabled}
                    className={cls(
                        "w-full outline-hidden bg-transparent leading-normal text-base px-3",
                        clearable ? "pr-14" : "pr-12",
                        "rounded-lg",
                        {
                            "min-h-[28px]": size === "smallest",
                            "min-h-[32px]": size === "small",
                            "min-h-[40px]": size === "medium",
                            "min-h-[48px]": size === "large"
                        },
                        // A flat py-2 (16px) plus the text-base line box floored
                        // the field at 40px, so smallest/small/medium all
                        // rendered the same height. Scale it with `size`.
                        label
                            ? "pt-8 pb-2"
                            : { smallest: "py-0.5", small: "py-1", medium: "py-2", large: "py-3" }[size],
                        inputClassName,
                        disabled &&
                        "border border-transparent outline-hidden opacity-50 dark:opacity-50 text-surface-accent-600 dark:text-surface-accent-500"
                    )}
                />
                <IconButton
                    size={adornmentSize}
                    onClick={(e) => {
                        e.stopPropagation();
                        inputRef.current?.showPicker();
                    }}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-surface-accent-500!"
                >
                    <CalendarIcon/>
                </IconButton>
                {clearable && value && (
                    <IconButton
                        size={adornmentSize}
                        onClick={handleClear}
                        className="absolute right-14 top-1/2 transform -translate-y-1/2 text-surface-accent-400 "
                    >
                        <XIcon/>
                    </IconButton>
                )}
            </div>
            {invalidValue && (
                <div className="flex items-center m-2">
                    <AlertCircleIcon size={iconSize.small} color={"error"}/>
                    <div className="pl-2">
                        <Typography variant={"body2"}>
                            Invalid date value for this field
                        </Typography>
                        <Typography variant={"body2"}>
                            {`The provided value is: ${JSON.stringify(value)}`}
                        </Typography>
                    </div>
                </div>
            )}
        </>
    );
};

const inputStyles = `
    /* Hide the default calendar icon in Chrome, Safari, Edge, Opera */
    input[type="date"]::-webkit-calendar-picker-indicator,
    input[type="datetime-local"]::-webkit-calendar-picker-indicator {
        display: none;
        -webkit-appearance: none;
    }
    /* Hide default calendar icon in Firefox */
    input[type="date"],
    input[type="datetime-local"] {
        -moz-appearance:textfield;
    }
  `;
