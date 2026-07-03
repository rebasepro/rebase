import React from "react";
import type { Snapshot, SnapshotValues } from "./snapshots";
import type { SnapshotCollection } from "./collections";
import type { FormexController } from "./formex";
import type { ComponentRef } from "./component_ref";

/**
 * Context passed to custom fields and snapshot views.
 * @group Form custom fields
 */
export interface FormContext<M extends Record<string, unknown> = Record<string, unknown>> {

    /**
     * Current values of the snapshot
     */
    values: M;

    /**
     * Update the value of a field
     */
    setFieldValue: (key: string, value: unknown, shouldValidate?: boolean) => void;

    /**
     * Quietly persist the snapshot to the database without any UI feedback
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
     * Collection of the snapshot being modified
     */
    collection?: SnapshotCollection<M>;

    /**
     * Snapshot id, it can be undefined if it's a new snapshot
     */
    snapshotId?: string | number;

    /**
     * Path this snapshot is located at
     */
    path?: string;

    status: "new" | "existing" | "copy";

    snapshot?: Snapshot<M>;

    savingError?: Error;

    openSnapshotMode?: "side_panel" | "full_screen" | "split" | "dialog";

    /**
     * The underlying formex controller that powers the form.
     */
    formex: FormexController<M>;

    disabled: boolean;

    /**
     * Whether the form context is in read-only detail view mode.
     * Custom snapshot views can use this to adjust their rendering.
     */
    readOnly?: boolean;
}


export type SnapshotCustomView<M extends Record<string, unknown> = Record<string, unknown>> = {
    key: string;
    name: string;
    icon?: string | React.ReactNode;
    tabComponent?: React.ReactNode;
    includeActions?: boolean | "bottom";
    Builder?: ComponentRef<SnapshotCustomViewParams<M>>;
    position?: "start" | "end";
};

/**
 * Configuration to replace the default snapshot form with a custom component.
 * The Builder receives the same props as snapshot view tabs (snapshot, formContext, etc.)
 * and has full control over the UI.
 *
 * The form tab still appears in the tab bar but renders your Builder
 * instead of the auto-generated field form.
 *
 * @group Models
 */
export type FormViewConfig<M extends Record<string, unknown> = Record<string, unknown>> = {
    /**
     * Custom component that replaces the default form.
     */
    Builder: ComponentRef<SnapshotCustomViewParams<M>>;
    /**
     * If true, the save/delete action bar is rendered alongside the custom view.
     * Defaults to true.
     */
    includeActions?: boolean;
};

export interface SnapshotCustomViewParams<M extends Record<string, unknown> = Record<string, unknown>> {
    collection: SnapshotCollection<M>;
    snapshot?: Snapshot<M>;
    modifiedValues?: SnapshotValues<M>;
    formContext: FormContext<M>;
    parentCollectionSlugs?: string[];
    parentSnapshotIds?: string[];
}
