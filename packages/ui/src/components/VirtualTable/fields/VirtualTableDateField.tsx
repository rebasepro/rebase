import React from "react";
import { cls } from "../../../util";
import { focusedDisabled } from "../../../styles";
import { DateTimeField } from "../../DateTimeField";

export function VirtualTableDateField(props: {
    name?: string;
    error?: Error;
    mode?: "date" | "date_time";
    timezone?: string;
    internalValue: Date | undefined | null;
    updateValue: (newValue: (Date | null)) => void;
    focused: boolean;
    disabled: boolean;
    small?: boolean;
    locale?: string;
    onBlur?: React.FocusEventHandler<HTMLInputElement | HTMLTextAreaElement>;
}) {
    const { disabled, error, mode, timezone, internalValue, updateValue, small = false, locale } = props;

    return (
        <DateTimeField
            value={internalValue ?? undefined}
            onChange={(dateValue) => updateValue(dateValue ?? null)}
            // Same omission as `VirtualTableInput`: destructured and forwarded
            // nowhere, so a disabled date cell was still editable. `error` went
            // the same way — it drives `DateTimeField`'s invalid styling, and a
            // prop a caller passes should reach something rather than sit in a
            // destructure.
            disabled={disabled}
            error={Boolean(error)}
            invisible={true}
            // Without this the field falls back to DateTimeField's own default of
            // `size="large"` (min-h-64px), which overflows a table cell and makes
            // the value collide with the cell border.
            size={small ? "small" : "medium"}
            inputClassName={cls("w-full h-full", focusedDisabled)}
            className={cls("w-full h-full", focusedDisabled)}
            mode={mode}
            timezone={timezone}
            locale={locale}
        />
    );
}
