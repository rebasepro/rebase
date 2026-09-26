import React, { useCallback, useEffect, useRef, useState } from "react";
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
    /**
     * Whether the field draws its own calendar button. A table that draws its
     * own opener for the cell turns it off, and the value then sits flush with
     * the text of the cells beside it rather than indented like a form field.
     */
    pickerButton?: boolean;
    /** The native input, for a caller that opens the picker itself (`showPicker()`). */
    inputRef?: React.Ref<HTMLInputElement>;
    onBlur?: React.FocusEventHandler<HTMLInputElement | HTMLTextAreaElement>;
}) {
    const { name, disabled, error, mode, timezone, internalValue, updateValue, small = false, locale, pickerButton = true, inputRef } = props;

    // An empty date input still paints its mask — `dd/mm/yyyy, --:--` — so a
    // column with gaps in it read as a column of placeholders, one per row.
    // The mask is only useful once someone is typing into it.
    const [focused, setFocused] = useState(false);
    const focusedRef = useRef(false);

    // A typed date is written once it is complete, not once per keystroke:
    // the input reports each one, and retyping a year passes through 0002,
    // 0020 and 0202 on its way to 2026. While the field has the focus a change
    // waits for the typing to pause — and a year of fewer than four digits for
    // more typing — and leaving the field writes what it holds. A date picked
    // with the field unfocused is written at once.
    const [draft, setDraft] = useState<{ value: Date | null } | null>(null);
    const draftRef = useRef<{ value: Date | null } | null>(null);
    const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const updateValueRef = useRef(updateValue);
    useEffect(() => {
        updateValueRef.current = updateValue;
    }, [updateValue]);

    const commit = useCallback(() => {
        clearTimeout(timerRef.current);
        const pending = draftRef.current;
        if (!pending) return;
        draftRef.current = null;
        setDraft(null);
        updateValueRef.current(pending.value);
    }, []);

    const onDateChange = (dateValue: Date | null) => {
        const pending = { value: dateValue ?? null };
        draftRef.current = pending;
        setDraft(pending);
        clearTimeout(timerRef.current);
        if (!focusedRef.current) {
            commit();
        } else if (!pending.value || pending.value.getFullYear() >= 1000) {
            timerRef.current = setTimeout(commit, 400);
        }
    };

    useEffect(() => () => {
        clearTimeout(timerRef.current);
        if (draftRef.current) updateValueRef.current(draftRef.current.value);
    }, []);

    const shownValue = draft ? draft.value : internalValue;
    const empty = !shownValue;

    return (
        <div className={"w-full h-full flex items-center"}
            onFocus={() => {
                focusedRef.current = true;
                setFocused(true);
            }}
            onBlur={() => {
                focusedRef.current = false;
                setFocused(false);
                commit();
            }}>
            <DateTimeField
                value={shownValue ?? undefined}
                onChange={onDateChange}
                // Same omission as `VirtualTableInput`: destructured and forwarded
                // nowhere, so a disabled date cell was still editable. `error` went
                // the same way — it drives `DateTimeField`'s invalid styling, and a
                // prop a caller passes should reach something rather than sit in a
                // destructure.
                disabled={disabled}
                error={Boolean(error)}
                // Third prop this component declared and dropped. A table cell
                // draws no visible label — the column header is the only thing
                // naming it, and a header is not an accessible name for the input
                // underneath — so without this every date cell reads as an unnamed
                // "date entry" to a screen reader, one per row per date column.
                aria-label={name}
                invisible={true}
                pickerButton={pickerButton}
                inputRef={inputRef}
                // Without this the field falls back to DateTimeField's own default of
                // `size="large"` (min-h-64px), which overflows a table cell and makes
                // the value collide with the cell border.
                size={small ? "small" : "medium"}
                inputClassName={cls("w-full h-full",
                    focusedDisabled,
                    !pickerButton && "px-0",
                    empty && !focused && "text-transparent")}
                className={cls("w-full h-full", focusedDisabled)}
                mode={mode}
                timezone={timezone}
                locale={locale}
            />
        </div>
    );
}
