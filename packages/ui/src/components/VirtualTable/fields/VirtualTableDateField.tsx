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
    locale?: string;
    onBlur?: React.FocusEventHandler<HTMLInputElement | HTMLTextAreaElement>;
}) {
    const { disabled, error, mode, timezone, internalValue, updateValue, locale } = props;

    return (
        <DateTimeField
            value={internalValue ?? undefined}
            onChange={(dateValue) => updateValue(dateValue ?? null)}
            invisible={true}
            inputClassName={cls("w-full h-full", focusedDisabled)}
            className={cls("w-full h-full", focusedDisabled)}
            mode={mode}
            timezone={timezone}
            locale={locale}
        />
    );
}
