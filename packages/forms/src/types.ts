import React, { FormEvent } from "react";

export type FormexController<T = any> = {
    values: T;
    initialValues: T;
    setValues: (values: T) => void;
    setFieldValue: (key: string, value: unknown, shouldValidate?: boolean) => void;
    touched: Record<string, boolean>;
    setFieldTouched: (key: string, touched: boolean, shouldValidate?: boolean) => void;
    setTouched: (touched: Record<string, boolean>) => void;
    dirty: boolean;
    setDirty: (dirty: boolean) => void;
    setSubmitCount: (submitCount: number) => void;
    errors: Record<string, string>;
    setFieldError: (key: string, error?: string) => void;
    handleChange: (event: React.SyntheticEvent) => void,
    handleBlur: (event: React.FocusEvent) => void,
    handleSubmit: (event?: FormEvent<HTMLFormElement>) => void;
    validate: () => void;
    resetForm: (props?: FormexResetProps<T>) => void;
    submitCount: number;
    isSubmitting: boolean;
    setSubmitting: (isSubmitting: boolean) => void;
    isValidating: boolean;
    /**
     * The version of the form. This is incremented every time the form is reset
     * or the form is submitted, and whenever the `initialValues` it was created
     * with are replaced — a container reading `values` off the controller needs
     * to hear about a re-seed the same way it hears about a reset.
     */
    version: number;

    debugId?: string;

    undo: () => void;
    redo: () => void;

    canUndo: boolean;
    canRedo: boolean;
}

export type FormexResetProps<T = any> = {
    values?: T;
    submitCount?: number;
    errors?: Record<string, string>;
    touched?: Record<string, boolean>;
    /**
     * Leave what the reset replaced one step behind in the undo history, so
     * {@link FormexController.undo} brings it back.
     *
     * For a reset the *user* asked for — a "Discard changes" or "Clear form"
     * button — where the thing being thrown away is everything they typed, and
     * a misclick is otherwise unrecoverable. The default clears the history,
     * which is right for a reset the form performs on its own (a save, a new
     * record): there is nothing there worth stepping back into.
     */
    undoable?: boolean;
};
