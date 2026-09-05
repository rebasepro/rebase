import React, { PropsWithChildren } from "react";

import type { CollectionActionsProps, EntityTableController, SelectionController } from "../collections";
import type { EntityStatus } from "@rebasepro/types";
import type { InferPropertyType, Property } from "@rebasepro/types";
import type { FormContext } from "./entity_views";
import type { RebaseContext } from "../rebase_context";
import type { NavigationGroupMapping, AppView } from "../controllers/navigation";

import type { User } from "@rebasepro/types";
import type { AnySlotContribution } from "./slots";
import type { AdminCollection } from "@rebasepro/cms-types";

/**
 * Props interface for custom field components.
 *
 * The `@rebasepro/cms` package re-exports a narrower version of this
 * interface that adds `formex` and layout-specific fields. This base
 * definition captures the core contract that every field renderer must
 * satisfy, regardless of where it is rendered.
 *
 * @typeParam P - The property type this field is bound to
 * @typeParam CustomProps - Extra props injected via the property's `customProps`
 * @typeParam M - The entity model type
 * @group Form custom fields
 */
export interface FieldProps<
    P extends Property = Property,
    CustomProps = unknown,
    M extends Record<string, unknown> = Record<string, unknown>
> {
    /** Key of the property (e.g. "user.name" for a nested path) */
    propertyKey: string;

    /** Current value of this field */
    value: InferPropertyType<P> | null;

    /** Set value of field directly */
    setValue: (value: InferPropertyType<P> | null, shouldValidate?: boolean) => void;

    /** Set value of a different field directly */
    setFieldValue: (propertyKey: string, value: unknown, shouldValidate?: boolean) => void;

    /** Is the form currently submitting */
    isSubmitting?: boolean;

    /** Should this field show the error indicator */
    showError?: boolean;

    /** Error message for this field, or undefined if valid */
    error?: string;

    /** Has this field been touched */
    touched?: boolean;

    /** Property related to this field */
    property: P;

    /** Should this field include a description */
    includeDescription?: boolean;

    /** Flag to indicate that the underlying value has been updated in the driver */
    underlyingValueHasChanged?: boolean;

    /** Is this field part of an array */
    partOfArray?: boolean;

    /** Is this field part of a block */
    partOfBlock?: boolean;

    /** Display the child properties directly, without being wrapped in an extendable panel */
    minimalistView?: boolean;

    /** Should this field autofocus on mount */
    autoFocus?: boolean;

    /** Additional properties set by the developer */
    customProps?: CustomProps;

    /** Additional values related to the state of the form or the entity */
    context: FormContext<M>;

    /** Flag to indicate if this field should be disabled */
    disabled?: boolean;

    /** Size of the field */
    size?: "small" | "medium" | "large";

    /** Callback when internal property state changes (e.g. panel expansion) */
    onPropertyChange?: (property: Partial<Property>) => void;
}

// ── Plugin ────────────────────────────────────────────────────────────

/**
 * Interface used to define plugins for Rebase.
 * Plugins contribute UI via **slots**, wrap subtrees with **providers**,
 * and inject behavioral logic via **hooks**.
 * @group Core
 */
export interface RebasePlugin {
    /**
     * Unique key identifying this plugin.
     */
    key: string;

    /**
     * If true, no admin content is shown until this plugin finishes loading.
     */
    loading?: boolean;

    /**
     * UI slot contributions rendered at the matching extension points.
     */
    slots?: AnySlotContribution[];

    /**
     * HOC providers wrapping root or form content.
     * Providers with `scope: "root"` wrap the entire admin below RebaseContext.
     * Providers with `scope: "form"` wrap each entity form/edit view.
     */
    providers?: PluginProvider[];

    /**
     * Behavioral hooks (non-UI) — collection modification, search blocking,
     * column reordering, navigation entries, etc.
     */
    hooks?: PluginHooks;

    /**
     * Field wrapping for custom field rendering (e.g. data enhancement).
     */
    fieldBuilder?: FieldBuilderConfig;

    /**
     * Views to be automatically added to the navigation.
     */
    views?: AppView[];

    /**
     * Optional lifecycle hooks. Called by the Rebase runtime
     * at appropriate points in the app lifecycle.
     */
    lifecycle?: PluginLifecycle;
}

// ── Provider ──────────────────────────────────────────────────────────

/**
 * A HOC provider that wraps a subtree of the admin.
 * @group Plugins
 */
export interface PluginProvider {
    /**
     * `"root"` — wraps the entire admin below RebaseContext.
     * `"form"` — wraps each entity form / edit view.
     */
    scope: "root" | "form";

    /**
     * The provider component. Must accept `children`.
     * Typed loosely because extra props are passed via the `props` field;
     * strict signatures cause contravariance issues.
     */
    Component: React.ComponentType<PropsWithChildren<Record<string, unknown>>>;

    /**
     * Additional props passed to the Component.
     */
    props?: Record<string, unknown>;
}

// ── Hooks ─────────────────────────────────────────────────────────────

/**
 * Behavioral hooks that a plugin can provide.
 * These are non-UI extension points for modifying admin behavior.
 * @group Plugins
 */
export interface PluginHooks {
    /**
     * Modify a single collection before it is rendered (synchronous).
     */
    modifyCollection?: (collection: AdminCollection) => AdminCollection;

    /**
     * Async version of modifyCollection — supports fetching remote config.
     * Runs during navigation resolution. If provided alongside `modifyCollection`,
     * the sync version runs first, then the async version.
     */
    modifyCollectionAsync?: (collection: AdminCollection) => Promise<AdminCollection>;

    /**
     * Modify, add or remove collections.
     */
    injectCollections?: (collections: AdminCollection[]) => AdminCollection[];

    /**
     * Callback called when columns are reordered via drag and drop.
     */
    onColumnsReorder?: (props: {
        fullPath: string;
        parentCollectionSlugs: string[];
        parentEntityIds: string[];
        collection: AdminCollection;
        newPropertiesOrder: string[];
    }) => void;

    /**
     * Callback called when Kanban board columns are reordered.
     */
    onKanbanColumnsReorder?: (props: {
        fullPath: string;
        parentCollectionSlugs: string[];
        parentEntityIds: string[];
        collection: AdminCollection;
        kanbanColumnProperty: string;
        newColumnsOrder: string[];
    }) => void;

    /**
     * Navigation entries contributed by this plugin.
     */
    navigationEntries?: NavigationGroupMapping[];

    /**
     * Callback when navigation entry order changes (e.g. drag-and-drop).
     */
    onNavigationEntriesUpdate?: (entries: NavigationGroupMapping[]) => void;

    /**
     * Allow reordering collections in the home page via drag and drop.
     */
    allowDragAndDrop?: boolean;
}

// ── Plugin Lifecycle ──────────────────────────────────────────────────

/**
 * Lifecycle hooks for plugins. Called by the Rebase runtime
 * at appropriate points in the app lifecycle.
 * @group Plugins
 */
export interface PluginLifecycle {
    /**
     * Called once when the plugin is mounted in the Rebase tree.
     * Can return a Promise for async initialization.
     */
    onMount?: (context: RebaseContext) => void | Promise<void>;

    /**
     * Called when the plugin is unmounted from the Rebase tree.
     * Use this for cleanup (subscriptions, timers, etc.).
     */
    onUnmount?: () => void;

    /**
     * Called whenever the authentication state changes.
     * Receives the new user (or null on sign-out).
     */
    onAuthStateChange?: (user: User | null) => void;

    /**
     * Called when a collection's visible entities change.
     * Useful for analytics, caching, or cross-plugin coordination.
     */
    onCollectionChange?: (slug: string, entities: unknown[]) => void;
}

// ── Field Builder ─────────────────────────────────────────────────────

/**
 * Configuration for wrapping form field components.
 * @group Plugins
 */
export interface FieldBuilderConfig {
    /**
     * Returns a wrapped field component, or null to skip wrapping.
     */
    wrap: <T>(params: PluginFieldBuilderParams) => React.ComponentType<FieldProps<Property>> | null;

    /**
     * Optional guard — return false to skip wrapping for this field.
     */
    enabled?: (params: PluginFieldBuilderParams) => boolean;
}

// ── Prop interfaces ───────────────────────────────────────────────────

/**
 * Props passed to home page collection card action components.
 * @group Models
 */
export interface PluginHomePageActionsProps<EP extends object = object, M extends Record<string, unknown> = Record<string, unknown>, USER extends User = User, EC extends AdminCollection<M> = AdminCollection<M>> {
    slug: string;
    collection: EC;
    context: RebaseContext<USER>;
}

/**
 * Props passed to form action components in entity edit/form views.
 * @group Models
 */
export interface PluginFormActionProps<USER extends User = User, EC extends AdminCollection = AdminCollection> {
    entityId?: string | number;
    path: string;
    parentCollectionSlugs: string[];
    parentEntityIds: string[];
    status: EntityStatus;
    collection: EC;
    disabled: boolean;
    formContext?: FormContext;
    context: RebaseContext<USER>;
    openEntityMode?: "side_panel" | "full_screen" | "split" | "dialog";
}

/**
 * Parameters passed to the field builder wrap function.
 * @group Models
 */
export type PluginFieldBuilderParams<M extends Record<string, unknown> = Record<string, unknown>, EC extends AdminCollection<M> = AdminCollection<M>> = {
    fieldConfigId: string;
    propertyKey: string;
    property: Property;
    Field: React.ComponentType<FieldProps<Property, unknown, M>>;
    plugin: RebasePlugin;
    path?: string;
    collection?: EC;
};

/**
 * Generic props passed to plugin components that just need admin context.
 * @group Models
 */
export interface PluginGenericProps<USER extends User = User> {
    context: RebaseContext<USER>;
}

/**
 * Props for additional card components in the home page.
 * @group Models
 */
export interface PluginHomePageAdditionalCardsProps<USER extends User = User> {
    group?: string;
    context: RebaseContext<USER>;
}
