
import type { SnapshotLinkBuilder } from "../types/snapshot_link_builder";
import type { Locale } from "../types/locales";
import type { SnapshotAction } from "../types/snapshot_actions";
import type { SnapshotCustomView } from "../types/snapshot_views";
import type { RebasePlugin } from "../types/plugins";
import type { PropertyConfig } from "../types/property_config";
import type { SlotContribution } from "../types/slots";
import type { ComponentOverrideMap } from "../types/component_overrides";

export type CustomizationController = {

    /**
     * Builder for generating utility links for snapshots
     */
    snapshotLinkBuilder?: SnapshotLinkBuilder;

    /**
     * Use plugins to modify the behaviour of the CMS.
     */
    plugins?: RebasePlugin[];

    /**
     * Pre-merged slots from plugins + direct slot contributions.
     */
    resolvedSlots: SlotContribution[];

    /**
     * List of additional custom views for snapshots.
     * You can use the key to reference the custom view in
     * the `snapshotViews` prop of a collection.
     *
     * You can also define a snapshot view from the UI.
     */
    snapshotViews?: SnapshotCustomView[];

    /**
     * List of actions that can be performed on snapshots.
     * These actions are displayed in the snapshot view and in the collection view.
     * You can later reuse these actions in the `snapshotActions` prop of a collection,
     * by specifying the `key` of the action.
     */
    snapshotActions?: SnapshotAction[];

    /**
     * Format of the dates in the CMS.
     * Defaults to 'MMMM dd, yyyy, HH:mm:ss'
     */
    dateTimeFormat?: string;

    /**
     * Locale of the CMS, currently only affecting dates
     */
    locale?: Locale;

    /**
     * Record of custom form fields to be used in the CMS.
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
