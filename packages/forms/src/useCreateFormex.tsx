import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getIn, setIn } from "./utils";
import { deepEqual as equal } from "fast-equals";

import { FormexController, FormexResetProps } from "./types";

/**
 * One step of the form's undo history.
 *
 * `touched` and `boundary` are set only on the pair of entries an undoable
 * reset writes — the state it replaced and the state it produced. A reset
 * clears the touched map and bumps `version`, so a step across that pair has to
 * put both back. Ordinary edits leave both unset on purpose: undoing a
 * keystroke should not re-seed every field in the form.
 */
type FormexHistoryEntry<T> = {
    values: T;
    touched?: Record<string, boolean>;
    boundary?: boolean;
};

export function useCreateFormex<T = any>({
    initialValues,
    initialModifiedValues,
    initialErrors,
    initialDirty,
    initialTouched,
    validation,
    validateOnChange = false,
    validateOnInitialRender = false,
    onSubmit,
    onReset,
    onValuesChangeDeferred,
    debugId
}: {
    /**
     * The **baseline**: what the values are stored as. Everything the form
     * calls "dirty" is a difference from this, so it has to be the stored
     * record and nothing else. To open a form already carrying an edit, pass
     * that edit as {@link initialModifiedValues} — folding it into
     * `initialValues` instead makes the baseline agree with the edit, and then
     * nothing can tell that the edit is unsaved.
     */
    initialValues: T;
    /**
     * What the form should *show* on its first render, when that is not the
     * baseline — an edit handed over from somewhere else, a draft restored
     * from a cache. Dirty is computed from the difference.
     */
    initialModifiedValues?: T;
    initialErrors?: Record<string, string>;
    /**
     * Force the starting dirty state. Only for callers that know the form
     * opens modified but cannot supply the modified values; prefer
     * {@link initialModifiedValues}, which lets it be derived.
     */
    initialDirty?: boolean;
    initialTouched?: Record<string, boolean>;
    validateOnChange?: boolean;
    validateOnInitialRender?: boolean;
    validation?: (
        values: T
    ) =>
        | Record<string, string>
        | Promise<Record<string, string>>
        | undefined
        | void;
    onValuesChangeDeferred?: (values: T, controller: FormexController<T>) => void;
    onSubmit?: (values: T, controller: FormexController<T>) => void | Promise<void>;
    onReset?: (controller: FormexController<T>) => void | Promise<void>;
    debugId?: string;
}): FormexController<T> {
    // The baseline and the current values start apart when the form opens
    // already carrying an edit. Keeping them separate is what lets the dirty
    // flag be *derived* rather than asserted, and what lets the baseline be
    // replaced later without touching what the user is looking at.
    const startValues = initialModifiedValues ?? initialValues;

    const initialValuesRef = useRef<T>(initialValues);
    const valuesRef = useRef<T>(startValues);
    const debugIdRef = useRef<string | undefined>(debugId);

    const [values, setValuesInner] = useState<T>(startValues);
    const [touchedState, setTouchedState] = useState<Record<string, boolean>>(initialTouched ?? {});
    // Read by `resetForm`, which needs the map as it stands at the moment it is
    // about to clear it. Assigned during render rather than from an effect, so
    // an event handler can never read one render's worth of stale state.
    const touchedRef = useRef<Record<string, boolean>>(touchedState);
    touchedRef.current = touchedState;
    const [errors, setErrors] = useState<Record<string, string>>(initialErrors ?? {});
    const [dirty, setDirty] = useState(initialDirty ?? !equal(initialValues, startValues));
    const [submitCount, setSubmitCount] = useState(0);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isValidating, setIsValidating] = useState(false);
    const [version, setVersion] = useState(0);

    const onValuesChangeRef = useRef(onValuesChangeDeferred);
    onValuesChangeRef.current = onValuesChangeDeferred;
    const debounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    const callDebouncedOnValuesChange = useCallback((values: T) => {
        if (onValuesChangeRef.current) {
            if (debounceTimeoutRef.current) {
                clearTimeout(debounceTimeoutRef.current);
            }
            debounceTimeoutRef.current = setTimeout(() => {
                onValuesChangeRef.current?.(values, controllerRef.current);
            }, 300);
        }
    }, []);

    // Replace state for history with refs
    const historyRef = useRef<FormexHistoryEntry<T>[]>([{ values: startValues }]);
    const historyIndexRef = useRef<number>(0);

    /**
     * Record a new state, dropping anything that had been undone past it.
     */
    const pushHistory = useCallback((entry: FormexHistoryEntry<T>) => {
        const newHistory = historyRef.current.slice(0, historyIndexRef.current + 1);
        newHistory.push(entry);
        historyRef.current = newHistory;
        historyIndexRef.current = newHistory.length - 1;
    }, []);

    useEffect(() => {
        if (validateOnInitialRender) {
            validate();
        }
    }, []);

    const setValues = useCallback((newValues: T) => {
        valuesRef.current = newValues;
        setValuesInner(newValues);
        setDirty(!equal(initialValuesRef.current, newValues));
        pushHistory({ values: newValues });
        callDebouncedOnValuesChange(newValues);
    }, [callDebouncedOnValuesChange, pushHistory]);

    const validate = useCallback(async () => {
        setIsValidating(true);
        const validationErrors = await validation?.(valuesRef.current);
        setErrors(validationErrors ?? {});
        setIsValidating(false);
        return validationErrors;
    }, [validation]);

    const setFieldValue = useCallback(
        (key: string, value: unknown, shouldValidate?: boolean) => {
            const newValues = setIn(valuesRef.current as Record<string, unknown>, key, value) as T;
            valuesRef.current = newValues;
            setValuesInner(newValues);
            if (!equal(getIn(initialValuesRef.current as Record<string, unknown>, key), value)) {
                setDirty(true);
            }
            if (shouldValidate) {
                validate();
            }
            pushHistory({ values: newValues });
            callDebouncedOnValuesChange(newValues);
        },
        [validate, callDebouncedOnValuesChange, pushHistory]
    );

    const setFieldError = useCallback((key: string, error: string | undefined) => {
        setErrors((prevErrors: Record<string, string>) => {
            const newErrors = { ...prevErrors };
            if (error) {
                newErrors[key] = error;
            } else {
                delete newErrors[key];
            }
            return newErrors;
        });
    }, []);

    const setFieldTouched = useCallback(
        (key: string, touched: boolean, shouldValidate?: boolean) => {
            setTouchedState((prev: Record<string, boolean>) => ({
                ...prev,
                [key]: touched
            }));
            if (shouldValidate) {
                validate();
            }
        },
        [validate]
    );

    const handleChange = useCallback(
        (event: React.SyntheticEvent) => {
            const target = event.target as HTMLInputElement;
            let value;
            if (target.type === "checkbox") {
                value = target.checked;
            } else if (target.type === "number") {
                value = target.valueAsNumber;
            } else {
                value = target.value;
            }
            const name = target.name;
            setFieldValue(name, value, validateOnChange);
            setFieldTouched(name, true);
        },
        [setFieldValue, setFieldTouched, validateOnChange]
    );

    const handleBlur = useCallback((event: React.FocusEvent) => {
        const target = event.target as HTMLInputElement;
        const name = target.name;
        setFieldTouched(name, true);
    }, [setFieldTouched]);

    const submit = useCallback(
        async (e?: React.FormEvent<HTMLFormElement>) => {
            e?.preventDefault();
            e?.stopPropagation();
            setIsSubmitting(true);
            setSubmitCount((prev: number) => prev + 1);
            const validationErrors = await validation?.(valuesRef.current);
            if (validationErrors && Object.keys(validationErrors).length > 0) {
                setErrors(validationErrors);
            } else {
                setErrors({});
                await onSubmit?.(valuesRef.current, controllerRef.current);
            }
            setIsSubmitting(false);
            setVersion((prev: number) => prev + 1);
        },
        [onSubmit, validation]
    );

    const resetForm = useCallback((props?: FormexResetProps<T>) => {
        const {
            submitCount: submitCountProp,
            values: valuesProp,
            errors: errorsProp,
            touched: touchedProp,
            undoable
        } = props ?? {};
        const priorValues = valuesRef.current;
        const priorTouched = touchedRef.current;
        const nextValues = valuesProp ?? initialValuesRef.current;
        const nextTouched = touchedProp ?? initialTouched ?? {};
        valuesRef.current = nextValues;
        initialValuesRef.current = nextValues;
        setValuesInner(nextValues);
        setErrors(errorsProp ?? {});
        setTouchedState(nextTouched);
        setDirty(false);
        setSubmitCount(submitCountProp ?? 0);
        setVersion((prev: number) => prev + 1);
        onReset?.(controllerRef.current);
        if (undoable) {
            // Keep what the user typed one step behind them. The entry stepped
            // back into carries the touched map as well as the values: without
            // it the values return but every field reads untouched, and a draft
            // backup — which is extracted *through* the touched map — would come
            // back empty.
            const kept = historyRef.current.slice(0, historyIndexRef.current + 1);
            kept[kept.length - 1] = { values: priorValues, touched: priorTouched };
            kept.push({ values: nextValues, touched: nextTouched, boundary: true });
            historyRef.current = kept;
            historyIndexRef.current = kept.length - 1;
        } else {
            historyRef.current = [{ values: nextValues }];
            historyIndexRef.current = 0;
        }
    }, [onReset, initialTouched]);

    /**
     * The `initialValues` prop moved: the record this form edits finished
     * loading, or was replaced. That is a **re-baseline**, not a reset.
     *
     * It used to call `resetForm({ values: initialValues })`, which is a reset
     * in both of the ways that matter, and both were wrong here:
     *
     * - it fired `onReset`, which callers reasonably read as "the user
     *   discarded their changes". The admin clears the cache that seeds an
     *   in-flight edit handed over from the side panel there, so a record's own
     *   data arriving deleted the edit the form had just been opened with, and
     *   the form then re-seeded itself from the server — an expanded record
     *   silently lost whatever had been typed into it.
     * - it overwrote `values`, so anything typed while the record was still
     *   loading was thrown away without a word.
     *
     * So: move the baseline, leave the edit alone, and re-judge one against
     * the other. Only an untouched form follows the baseline to its new value.
     */
    useEffect(() => {
        if (equal(initialValuesRef.current, initialValues)) return;

        const modified = !equal(initialValuesRef.current, valuesRef.current);
        initialValuesRef.current = initialValues;

        if (modified) {
            setDirty(!equal(initialValues, valuesRef.current));
        } else {
            valuesRef.current = initialValues;
            setValuesInner(initialValues);
            historyRef.current = [{ values: initialValues }];
            historyIndexRef.current = 0;
            setDirty(false);
        }
        // Containers that read `values` off the controller key on `version`;
        // a re-seed changes what they are holding just as a reset does.
        setVersion((prev: number) => prev + 1);
    }, [initialValues]);

    const stepHistory = useCallback((newIndex: number) => {
        const from = historyRef.current[historyIndexRef.current];
        const entry = historyRef.current[newIndex];
        const newValues = entry.values;
        setValuesInner(newValues);
        valuesRef.current = newValues;
        historyIndexRef.current = newIndex;
        setDirty(!equal(initialValuesRef.current, newValues));
        if (entry.touched) {
            setTouchedState(entry.touched);
        }
        // Stepping across a reset. The reset told everything reading `values`
        // off the controller to re-read itself, so the way back has to say so
        // too — otherwise a cleared markdown editor stays cleared while the
        // value behind it is already back. Ordinary steps skip this.
        if (from?.boundary || entry.boundary) {
            setVersion((prev: number) => prev + 1);
        }
        callDebouncedOnValuesChange(newValues);
    }, [callDebouncedOnValuesChange]);

    const undo = useCallback(() => {
        if (historyIndexRef.current > 0) {
            stepHistory(historyIndexRef.current - 1);
        }
    }, [stepHistory]);

    const redo = useCallback(() => {
        if (historyIndexRef.current < historyRef.current.length - 1) {
            stepHistory(historyIndexRef.current + 1);
        }
    }, [stepHistory]);

    const controllerRef = useRef<FormexController<T>>({} as FormexController<T>);

    const controller = useMemo<FormexController<T>>(
        () => ({
            values,
            initialValues: initialValuesRef.current,
            handleChange,
            isSubmitting,
            setSubmitting: setIsSubmitting,
            setValues,
            setFieldValue,
            errors,
            setFieldError,
            touched: touchedState,
            setFieldTouched,
            setTouched: setTouchedState,
            dirty,
            setDirty,
            handleSubmit: submit,
            submitCount,
            setSubmitCount,
            handleBlur,
            validate,
            isValidating,
            resetForm,
            version,
            debugId: debugIdRef.current,
            undo,
            redo,
            canUndo: historyIndexRef.current > 0,
            canRedo: historyIndexRef.current < historyRef.current.length - 1
        }),
        [
            values,
            errors,
            touchedState,
            dirty,
            isSubmitting,
            submitCount,
            isValidating,
            version,
            handleChange,
            handleBlur,
            setValues,
            setFieldValue,
            setFieldTouched,
            setTouchedState,
            setFieldError,
            validate,
            submit,
            resetForm,
            undo,
            redo
        ]
    );

    useEffect(() => {
        controllerRef.current = controller;
    }, [controller]);

    return controller;
}
