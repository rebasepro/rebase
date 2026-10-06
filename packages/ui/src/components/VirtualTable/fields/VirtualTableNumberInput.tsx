import React, { useEffect, useRef, useState } from "react";
import { useDebouncedCallback } from "../../../hooks/useDebouncedCallback";
import { cls } from "../../../util";
import { focusedDisabled } from "../../../styles";

export function VirtualTableNumberInput(props: {
    error?: Error;
    value: number;
    align?: "right" | "left" | "center";
    updateValue: (newValue: (number | null)) => void;
    focused: boolean;
    disabled: boolean;
}) {
    const { align = "left", value, updateValue, focused, disabled } = props;
    // Not `value && …`: 0 is a value, and it used to render as an empty cell.
    const propStringValue = typeof value === "number" ? value.toString() : "";
    const [internalValue, setInternalValue] = useState<string | null>(propStringValue);
    const prevValue = useRef<number | null>(value);

    useEffect(() => {
        if (prevValue.current !== value && String(value) !== internalValue)
            setInternalValue(value !== undefined && value !== null ? value.toString() : null);
        prevValue.current = value;
    }, [value]);

    const doUpdate = React.useCallback(() => {
        if (internalValue !== propStringValue) {
            if (internalValue !== undefined && internalValue !== null) {
                const numberValue = parseFloat(internalValue);
                if (isNaN(numberValue)) return;
                updateValue(numberValue);
            } else {
                updateValue(null);
            }
        }
    }, [internalValue, value]);

    useDebouncedCallback(internalValue, doUpdate, !focused, 400);

    useEffect(() => {
        if (!focused && propStringValue !== internalValue)
            setInternalValue(value !== undefined && value !== null ? value.toString() : null);
    }, [value, focused]);

    const inputRef = React.useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (inputRef.current && focused) {
            inputRef.current.focus({ preventScroll: true });
        }
    }, [focused, inputRef]);

    const regexp = /^-?[0-9]+[,.]?[0-9]*$/;

    // A bare input, not a `TextField`: the cell frames it, and a field's box
    // is taller than a row's line, so the value jumped as the cell was
    // selected. The number at rest is a line of mono, tabular figures in the
    // cell's type; this is that same line, so selecting the cell moves nothing.
    return (
        <input
            ref={inputRef}
            disabled={disabled}
            className={cls("w-full p-0 m-0 bg-transparent border-none outline-none font-mono tabular-nums", focusedDisabled)}
            style={{ textAlign: align }}
            value={internalValue ?? ""}
            onChange={(evt) => {
                const newValue = evt.target.value.replace(",", ".");
                if (newValue.length === 0) setInternalValue(null);
                if (regexp.test(newValue) || newValue.startsWith("-")) setInternalValue(newValue);
            }}
        />
    );
}
