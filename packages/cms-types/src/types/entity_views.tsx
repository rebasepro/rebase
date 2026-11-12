import React from "react";
import type { EntityValues } from "@rebasepro/types";

import type { FormexController } from "./formex";
import type { AdminCollection } from "@rebasepro/cms-types";

/**
 * Context passed to custom fields and entity views.
 *
 * `values`, `setFieldValue` and `save` are the form's values — typed for an
 * editor: a date as a `Date`, a relation as an `EntityRelation`. `row` is the
 * saved record as the server sends it.
 * @group Form custom fields
 */
export interface FormContext<M extends Record<string, unknown> = Record<string, unknown>> {

    /**
     * Current values of the form
     */
    values: M;

    /**
     * Update the value of a field
     */
    setFieldValue: (key: string, value: unknown, shouldValidate?: boolean) => void;

    /**
     * Quietly persist the entity to the database without any UI feedback
     * (no validation, no snackbar, no form reset).
     * Use this for programmatic/background saves from custom views.
     */
    save: (values: M) => void;

    /**
     * Submit the form — validates, saves, resets the form, and shows
     * a success snackbar. This is what the Save button calls.
     * Use this from custom views when you want the full "user saved" experience.
     */
    submit: () => void;

    /**
     * Collection of the entity being modified
     */
    collection?: AdminCollection<M>;

    /**
     * The record's id; undefined for a new record until it is saved.
     */
    id?: string | number;

    /**
     * The collection path the record is at, subcollection segments included.
     */
    path?: string;

    status: "new" | "existing" | "copy";

    /**
     * The saved record, as the server sends the row — dates as ISO strings, a
     * belongsTo as its foreign-key column, `id` only where the table has that column. Undefined for a new
     * record. What the form holds unsaved is in {@link values}.
     */
    row?: Record<string, unknown>;

    savingError?: Error;

    openEntityMode?: "side_panel" | "full_screen" | "split" | "dialog";

    /**
     * The underlying formex controller that powers the form. In a read-only
     * view it is there, but you can't operate with it.
     */
    formex: FormexController<M>;

    disabled: boolean;

    /**
     * A save is in flight. Covers the autosave debounce too, which `formex`
     * cannot report because it never goes through `handleSubmit`.
     *
     * The identity bar reads this to label its Save button, which is what
     * replaced the unlabelled floating status circle in the form.
     */
    isSaving?: boolean;

    /**
     * There is no form behind this context: the record is being shown, not
     * edited, and `setFieldValue`, `save` and `submit` throw. Always paired
     * with `disabled: true` — the read-only detail view, a record the user may
     * not edit, and an entity view tab in the moment before the form has
     * mounted all get one. Where the record is being edited this is absent.
     */
    readOnly?: boolean;
}

export type EntityCustomView<M extends Record<string, unknown> = Record<string, unknown>> = {
    key: string;
    name: string;
    icon?: string | React.ReactNode;
    tabComponent?: React.ReactNode;
    includeActions?: boolean | "bottom";
    Builder?: React.ComponentType<EntityCustomViewParams<M>>;
    /**
     * Which side of the record's own tab this one sits on.
     *
     * `"end"` (the default) puts it after the record and before the
     * subcollections, which is where an extra reading of a row belongs.
     *
     * `"start"` puts it *before* the record — the cover of an entity: a
     * read-only summary an operator opens the row to see, with the form that
     * edits it one tab to the right. Pair it with
     * {@link AdminCollectionOptions.defaultSelectedView}, or the strip will open
     * on a tab that is not the first one.
     */
    position?: "start" | "end";
};

/**
 * Configuration to replace the default entity form with a custom component.
 * The Builder receives the same props as entity view tabs (row, formContext, etc.)
 * and has full control over the UI.
 *
 * The form tab still appears in the tab bar but renders your Builder
 * instead of the auto-generated field form. It is rendered *inside* the
 * record's form, so on the edit screen `formContext` is that form's live
 * context: `formContext.setFieldValue` edits the record, the identity bar's
 * Save stores it, and closing with an edit pending asks first — the same as
 * for a generated field.
 *
 * Where the record cannot be edited — the read-only detail view, or a user
 * without permission to edit it — the Builder gets `formContext.disabled` and
 * `formContext.readOnly` set, and writes throw.
 *
 * @group Models
 */
export type FormViewConfig<M extends Record<string, unknown> = Record<string, unknown>> = {
    /**
     * Custom component that replaces the default form.
     */
    Builder: React.ComponentType<EntityCustomViewParams<M>>;
    /**
     * Whether the identity bar offers Save, Save and close and Discard while
     * this view is on screen. Set it to `false` when the Builder stores the
     * record on its own terms, through `formContext.submit` or
     * `formContext.save`. Delete is a record action, in the bar's overflow
     * menu, and is offered either way. Defaults to true.
     */
    includeActions?: boolean;
};

export interface EntityCustomViewParams<M extends Record<string, unknown> = Record<string, unknown>> {
    collection: AdminCollection<M>;
    /**
     * The saved record, as the server sends the row — dates as ISO strings, a
     * belongsTo as its foreign-key column, `id` only where the table has that column. Undefined for a new
     * record.
     */
    row?: Record<string, unknown>;
    /**
     * The saved record's id, beside `row`: its primary key as a string, a
     * composite one's parts joined by `:::` — the id `useSidePanel().open`,
     * `useRowWrites().update` and a route take. Undefined for a new record.
     */
    id?: string;
    /**
     * The form's current values, unsaved edits included — typed for an
     * editor, as {@link FormContext.values} is.
     */
    modifiedValues?: EntityValues<M>;
    formContext: FormContext<M>;
    parentCollectionSlugs?: string[];
    parentEntityIds?: string[];
}
