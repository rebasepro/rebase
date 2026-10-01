"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { TextField, TextFieldProps } from "./TextField";

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

    // A value still waiting on the timer when the field unmounts is reported,
    // not dropped: a dialog that closes on Enter unmounts the field it was
    // typed into. Read through a ref — the cleanup runs once, at unmount.
    const pendingFlushRef = useRef<(() => void) | undefined>(undefined);
    useEffect(() => {
        return () => {
            if (timerRef.current) {
                clearTimeout(timerRef.current);
                timerRef.current = undefined;
                pendingFlushRef.current?.();
            }
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

        pendingFlushRef.current = () => flushChange(newValue, eventCopy as TextFieldChangeEvent);
        timerRef.current = setTimeout(() => {
            flushChange(newValue, eventCopy as TextFieldChangeEvent);
        }, 150);
    }, [flushChange]);

    // Enter submits the form around the field without blurring it, so the
    // timer had not fired yet and the form submitted the value from before
    // typing. Report it first: the keydown is handled before the browser's
    // implicit submission, and React renders the change in between.
    const internalOnKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        if (event.key === "Enter" && timerRef.current) flushChange(internalValue);
        props.onKeyDown?.(event as React.KeyboardEvent<HTMLInputElement>);
    }, [internalValue, flushChange, props.onKeyDown]);

    const internalOnBlur = useCallback((event: React.FocusEvent<HTMLInputElement>) => {
        flushChange(internalValue, event as TextFieldChangeEvent);
        props.onBlur?.(event);
    }, [internalValue, flushChange, props.onBlur]);

    return <TextField {...props}
        onChange={internalOnChange}
        onKeyDown={internalOnKeyDown}
        onBlur={internalOnBlur}
        value={internalValue as T}/>;
}
