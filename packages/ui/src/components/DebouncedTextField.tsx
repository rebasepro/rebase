"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { TextField, TextFieldProps } from "./index";

type TextFieldChangeEvent = React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>;

export function DebouncedTextField<T extends string | number>(props: TextFieldProps<T>) {

    const [internalValue, setInternalValue] = useState<T | string>(props.value ?? "");
    const lastSentValueRef = useRef<T | string>(props.value ?? "");
    const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    // Sync state with props.value when it changes externally
    useEffect(() => {
        const externalValue = props.value ?? "";
        if (externalValue !== lastSentValueRef.current) {
            setInternalValue(externalValue);
            lastSentValueRef.current = externalValue;
        }
    }, [props.value]);

    // Cleanup timer on unmount
    useEffect(() => {
        return () => {
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, []);

    const flushChange = useCallback((value: T | string, event?: TextFieldChangeEvent) => {
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = undefined;
        }
        if (value !== props.value && props.onChange) {
            lastSentValueRef.current = value;
            const e = {
                ...event,
                target: {
                    ...event?.target,
                    value: value,
                    name: props.name
                }
            } as TextFieldChangeEvent;
            props.onChange(e);
        }
    }, [props.value, props.onChange, props.name]);

    const internalOnChange = useCallback((event: TextFieldChangeEvent) => {
        const newValue = event.target.value;
        setInternalValue(newValue);

        if (timerRef.current) clearTimeout(timerRef.current);

        const eventCopy = {
            ...event,
            target: {
                ...event?.target,
                name: event?.target?.name
            }
        };

        timerRef.current = setTimeout(() => {
            flushChange(newValue, eventCopy as TextFieldChangeEvent);
        }, 150);
    }, [flushChange]);

    const internalOnBlur = useCallback((event: React.FocusEvent<HTMLInputElement>) => {
        flushChange(internalValue, event as TextFieldChangeEvent);
        props.onBlur?.(event);
    }, [internalValue, flushChange, props.onBlur]);

    return <TextField {...props}
        onChange={internalOnChange}
        onBlur={internalOnBlur}
        value={internalValue as T}/>;
}
