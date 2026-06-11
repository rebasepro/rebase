import React from "react";
import type { Entity, EntityValues } from "./entities";
import type { EntityCollection } from "./collections";
import type { FormexController } from "./formex";
import type { ComponentRef } from "./component_ref";

/**
 * Context passed to custom fields and entity views.
 * @group Form custom fields
 */
export interface FormContext<M extends Record<string, unknown> = Record<string, unknown>> {

    /**
     * Current values of the entity
     */
    values: M;

    /**
     * Update the value of a field
     */
    setFieldValue: (key: string, value: unknown, shouldValidate?: boolean) => void;

    /**
     * Save the entity.
     */
    save: (values: M) => void;

    /**
     * Collection of the entity being modified
     */
    collection?: EntityCollection<M>;

    /**
     * Entity id, it can be undefined if it's a new entity
     */
    entityId?: string | number;

    /**
     * Path this entity is located at
     */
    path?: string;

    status: "new" | "existing" | "copy";

    entity?: Entity<M>;

    savingError?: Error;

    openEntityMode: "side_panel" | "full_screen" | "split" | "dialog";

    /**
     * The underlying formex controller that powers the form.
     */
    formex: FormexController<M>;

    disabled: boolean;

    /**
     * Whether the form context is in read-only detail view mode.
     * Custom entity views can use this to adjust their rendering.
     */
    readOnly?: boolean;
}


export type EntityCustomView<M extends Record<string, unknown> = Record<string, unknown>> = {
    key: string;
    name: string;
    icon?: string | React.ReactNode;
    tabComponent?: React.ReactNode;
    includeActions?: boolean | "bottom";
    Builder?: ComponentRef<EntityCustomViewParams<M>>;
    position?: "start" | "end";
};

/**
 * Configuration to replace the default entity form with a custom component.
 * The Builder receives the same props as entity view tabs (entity, formContext, etc.)
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
    Builder: ComponentRef<EntityCustomViewParams<M>>;
    /**
     * If true, the save/delete action bar is rendered alongside the custom view.
     * Defaults to true.
     */
    includeActions?: boolean;
};

export interface EntityCustomViewParams<M extends Record<string, unknown> = Record<string, unknown>> {
    collection: EntityCollection<M>;
    entity?: Entity<M>;
    modifiedValues?: EntityValues<M>;
    formContext: FormContext<M>;
    parentCollectionSlugs?: string[];
    parentEntityIds?: string[];
}
