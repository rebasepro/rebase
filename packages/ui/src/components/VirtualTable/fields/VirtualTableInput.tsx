import React, { useEffect, useRef, useState } from "react";
import { useDebouncedCallback } from "../../../hooks/useDebouncedCallback";
import { focusedDisabled } from "../../../styles";
import { TextareaAutosize } from "../../TextareaAutosize";

export function VirtualTableInput(props: {
    error?: Error;
    value: string;
    multiline?: boolean;
    focused: boolean;
    disabled: boolean;
    updateValue: (newValue: (string | null)) => void;
    onBlur?: () => void;
}) {
    const ref = React.useRef<HTMLTextAreaElement>(null);
    const { disabled, value, multiline = false, updateValue, focused } = props;
    const prevValue = useRef<string | null>(value);
    const [internalValue, setInternalValue] = useState<typeof value>(value);
    const focusedState = useRef<boolean>(false);

    useEffect(() => {
        if (prevValue.current !== value && value !== internalValue)
            setInternalValue(value);
        prevValue.current = value;
    }, [value]);

    const doUpdate = React.useCallback(() => {
        const emptyInitialValue = !value;
        if (emptyInitialValue && !internalValue) return;
        if (internalValue !== value && internalValue !== prevValue.current) {
            prevValue.current = internalValue;
            updateValue(internalValue);
        }
    }, [internalValue, updateValue, value]);

    useDebouncedCallback(internalValue, doUpdate, !focused, 400);

    useEffect(() => {
        if (ref.current && focused && !focusedState.current) {
            focusedState.current = true;
            ref.current.focus({ preventScroll: true });
            ref.current.selectionStart = ref.current.value.length;
            ref.current.selectionEnd = ref.current.value.length;
        } else {
            focusedState.current = focused;
        }
    }, [focused, ref]);

    return (
        <TextareaAutosize
            className={focusedDisabled}
            ref={ref}
            // Destructured above and passed to nothing, so a property carrying
            // `admin: { disabled: true }` stayed typeable in the table and the
            // debounced write fired on blur. `readOnly` as well as `disabled`:
            // a disabled textarea is skipped by keyboard navigation, and a cell
            // you cannot tab through is worse than one you cannot edit.
            disabled={disabled}
            readOnly={disabled}
            style={{
                padding: 0,
                margin: 0,
                width: "100%",
                color: "unset",
                fontWeight: "unset",
                fontSize: "unset",
                fontFamily: "unset",
                background: "unset",
                border: "unset",
                resize: "none",
                outline: "none"
            }}
            value={internalValue ?? ""}
            onChange={(evt) => {
                const newValue = evt.target.value as string;
                if (multiline || !newValue.endsWith("\n"))
                    setInternalValue(newValue);
            }}
            onFocus={() => {
                focusedState.current = true;
            }}
            onBlur={() => {
                focusedState.current = false;
                doUpdate();
                if (props.onBlur) props.onBlur();
            }}
        />
    );
}
