
import type { EntityLinkBuilder } from "../types/entity_link_builder";
import type { Locale } from "../types/locales";
import type { EntityAction } from "../types/entity_actions";
import type { EntityCustomView } from "../types/entity_views";
import type { CollectionCustomView } from "../types/collection_views";
import type { RebasePlugin } from "../types/plugins";
import type { PropertyConfig } from "../types/property_config";
import type { AnySlotContribution } from "../types/slots";
import type { ComponentOverrideMap } from "../types/component_overrides";

export type CustomizationController = {

    /**
     * Builder for generating utility links for entities
     */
    entityLinkBuilder?: EntityLinkBuilder;

    /**
     * Use plugins to modify the behaviour of the admin.
     */
    plugins?: RebasePlugin[];

    /**
     * Pre-merged slots from plugins + direct slot contributions.
     */
    resolvedSlots: AnySlotContribution[];

    /**
     * List of additional custom views for entities.
     * You can use the key to reference the custom view in
     * the `entityViews` prop of a collection.
     *
     * You can also define a entity view from the UI.
     */
    entityViews?: EntityCustomView[];

    /**
     * List of additional ways to render a collection's rows. You can use the
     * key to reference the view in the `admin.customViews` prop of a
     * collection, which is also what makes it selectable from the collection
     * editor.
     */
    collectionViews?: CollectionCustomView[];

    /**
     * List of actions that can be performed on entities.
     * These actions are displayed in the entity view and in the collection view.
     * You can later reuse these actions in the `entityActions` prop of a collection,
     * by specifying the `key` of the action.
     */
    entityActions?: EntityAction[];

    /**
     * Format of the dates in the admin.
     * Defaults to 'MMMM dd, yyyy, HH:mm:ss'
     */
    dateTimeFormat?: string;

    /**
     * Locale of the admin, currently only affecting dates
     */
    locale?: Locale;

    /**
     * Record of custom form fields to be used in the admin.
     * You can use the key to reference the custom field in
     * the `propertyConfig` prop of a property in a collection.
     */
    propertyConfigs: Record<string, PropertyConfig>;

    /**
     * Global component overrides. Keys are component names from
     * {@link OverridableComponentName}. Values replace the default
     * implementation everywhere in the app.
     *
     * Collection-scoped overrides (set on individual collections)
     * take precedence over global overrides.
     */
    components?: ComponentOverrideMap;
}
