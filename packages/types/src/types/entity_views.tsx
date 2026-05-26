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
    tabComponent?: React.ReactNode;
    includeActions?: boolean | "bottom";
    Builder?: ComponentRef<EntityCustomViewParams<M>>;
    position?: "start" | "end";
};

export interface EntityCustomViewParams<M extends Record<string, unknown> = Record<string, unknown>> {
    collection: EntityCollection<M>;
    entity?: Entity<M>;
    modifiedValues?: EntityValues<M>;
    formContext: FormContext<M>;
    parentCollectionSlugs?: string[];
    parentEntityIds?: string[];
}

/**
 * Configuration for customizing the read-only detail view of an entity.
 * Only used when `defaultEntityAction` is set to `"view"` on the collection.
 * @group Models
 */
export type EntityDetailViewConfig<M extends Record<string, unknown> = Record<string, unknown>> = {
    /**
     * Custom component rendered above the property display in the detail view.
     */
    Header?: ComponentRef<EntityDetailViewParams<M>>;
    /**
     * Custom component rendered below the property display in the detail view.
     */
    Footer?: ComponentRef<EntityDetailViewParams<M>>;
    /**
     * Completely replace the default detail view with a custom component.
     * When set, Header and Footer are ignored.
     */
    Builder?: ComponentRef<EntityDetailViewParams<M>>;
};

/**
 * Props passed to detail view customization components (Header, Footer, Builder).
 * @group Models
 */
export interface EntityDetailViewParams<M extends Record<string, unknown> = Record<string, unknown>> {
    collection: EntityCollection<M>;
    entity: Entity<M>;
    path: string;
    onEditClick: () => void;
}
