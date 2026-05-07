/**
 * Lightweight shim for @firecms/formex.
 * The config dialog uses a simple form state; we replicate just
 * the tiny surface area actually called.
 */
import { useState, useCallback, useRef } from "react";

export interface FormexConfig<T> {
    initialValues: T;
}

export interface Formex<T> {
    values: T;
    dirty: boolean;
    isSubmitting: boolean;
    setFieldValue: (field: string, value: any) => void;
    setDirty: (dirty: boolean) => void;
}

export function useCreateFormex<T extends Record<string, any>>(config: FormexConfig<T>): Formex<T> {
    const [values, setValues] = useState<T>(config.initialValues);
    const [dirty, setDirty] = useState(false);
    const initialRef = useRef(config.initialValues);

    const setFieldValue = useCallback((field: string, value: any) => {
        setValues(prev => ({ ...prev, [field]: value }));
        setDirty(true);
    }, []);

    return {
        values,
        dirty,
        isSubmitting: false,
        setFieldValue,
        setDirty,
    };
}
