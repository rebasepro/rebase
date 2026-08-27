import React from "react";

import type { CollectionActionsProps, EntityTableController, SelectionController } from "../collections";
import type { Entity } from "@rebasepro/types";
import type { PluginFormActionProps, PluginGenericProps, PluginHomePageActionsProps, PluginHomePageAdditionalCardsProps } from "./plugins";
import type { Property } from "@rebasepro/types";
import type { RebaseContext } from "../rebase_context";
import type { AdminCollection } from "@rebasepro/cms-types";

/**
 * Registry mapping slot names to their component prop types.
 * Each key represents a UI extension point in the admin.
 * @group Plugins
 */
export interface SlotRegistry {
    // ── Home page ─────────────────────────────────────────────────────
    "home.actions": PluginGenericProps;
    "home.cards": PluginHomePageAdditionalCardsProps;
    "home.children.start": PluginGenericProps;
    "home.children.end": PluginGenericProps;
    /** Compact widget rendered inline in a home page collection card. */
    "home.card.widget": HomeCardWidgetSlotProps;
    "home.collection.actions": PluginHomePageActionsProps;

    // ── Navigation / Drawer ───────────────────────────────────────────
    /** Rendered below the logo in the sidebar drawer. */
    "navigation.header": NavigationSlotProps;
    /** Rendered above the collapse toggle at the bottom of the drawer. */
    "navigation.footer": NavigationSlotProps;

    // ── Collection view ───────────────────────────────────────────────
    "collection.actions": CollectionActionsProps;
    "collection.actions.start": CollectionActionsProps;
    "collection.header.action": CollectionHeaderActionProps;
    "collection.add-column": CollectionAddColumnProps;
    "collection.error": CollectionErrorProps;
    /** Extra widgets rendered inside the collection toolbar row. */
    "collection.toolbar": CollectionToolbarProps;
    /** Custom empty-state component when a collection has no data. */
    "collection.empty-state": CollectionEmptyStateProps;
    /** Widgets rendered above the collection table. */
    "collection.widgets": CollectionWidgetsSlotProps;

    // ── Entity / Form ─────────────────────────────────────────────────
    "form.actions": PluginFormActionProps;
    "form.actions.top": PluginFormActionProps;
    /** Rendered before the form title / field list. */
    "form.before": PluginFormActionProps;
    /** Rendered after the form field list. */
    "form.after": PluginFormActionProps;

    // ── Entity row actions ────────────────────────────────────────────
    /** Per-row actions in entity tables (e.g. bulk actions, row context menus). */
    "entity.row.actions": EntityRowActionsProps;

    // ── Entity field decoration ───────────────────────────────────────
    /** Inject UI before an individual form field. */
    "entity.field.before": EntityFieldSlotProps;
    /** Inject UI after an individual form field. */
    "entity.field.after": EntityFieldSlotProps;

    // ── Collection filter panel ───────────────────────────────────────
    /** Custom filter sidebar for a collection. */
    "collection.filter-panel": CollectionFilterPanelProps;

    // ── Dashboard ─────────────────────────────────────────────────────
    /** Widget rendered on the dashboard / home page. */
    "dashboard.widget": DashboardWidgetProps;

    // ── Global ────────────────────────────────────────────────────────
    /** Cross-collection search bar component. */
    "global.search": GlobalSearchProps;
    /** Top-level toolbar actions rendered in the shell toolbar area. */
    "shell.toolbar": ShellToolbarProps;

    // ── Kanban ────────────────────────────────────────────────────────
    "kanban.setup": KanbanSetupProps;
    "kanban.add-column": KanbanAddColumnProps;
}

/**
 * Valid slot names for UI extension points.
 * @group Plugins
 */
/**
 * Slots this build declares but renders nowhere.
 *
 * Every name here appears in {@link SlotRegistry}, has a props interface, and
 * is listed in the public slot reference alongside the ones that work — so a
 * plugin author picks one off the table, registers a component, sees nothing,
 * and has no way to tell whether the fault is theirs. Seven of twenty-nine were
 * in that state.
 *
 * This is a statement of fact, not a wish list: `slot-render-sites.test.ts`
 * derives the same set by scanning for render sites and fails when the two
 * disagree. Implementing a slot therefore forces its removal from here, and
 * declaring one without rendering it forces its addition — at which point
 * `Rebase` warns anyone who registers for it, which is the whole point.
 */
export const UNRENDERED_SLOTS = [
    "collection.filter-panel",
    "dashboard.widget",
    "entity.field.after",
    "entity.field.before",
    "entity.row.actions",
    "global.search",
    "shell.toolbar"
] as const satisfies readonly (keyof SlotRegistry)[];

export type SlotName = keyof SlotRegistry;

/**
 * A single UI component contribution to a named slot.
 * @group Plugins
 */
export interface SlotContribution<K extends SlotName = SlotName> {
    /**
     * Which slot to contribute to.
     */
    slot: K;

    /**
     * The component to render in the slot.
     * Typed loosely so mixed-slot arrays work.
     * Type safety is provided at the `useSlot` call site.
     */
    Component: React.ComponentType<any>;

    /**
     * Additional props to merge into the slot props before rendering.
     */
    props?: Record<string, unknown>;

    /**
     * Ordering hint. Lower values render first. Defaults to 50.
     */
    order?: number;
}

// ── Prop interfaces for slots ─────────────────────────────────────────

/**
 * Props for `navigation.header` and `navigation.footer` slots.
 * @group Plugins
 */
export interface NavigationSlotProps {
    drawerOpen: boolean;
    drawerHovered: boolean;
    context: RebaseContext;
}

/**
 * Props for the `collection.toolbar` slot.
 * @group Plugins
 */
export interface CollectionToolbarProps {
    path: string;
    collection: AdminCollection;
    parentCollectionSlugs: string[];
    parentEntityIds: string[];
    tableController: EntityTableController;
    selectionController: SelectionController;
}

/**
 * Props for the `collection.empty-state` slot.
 * @group Plugins
 */
export interface CollectionEmptyStateProps {
    path: string;
    collection: AdminCollection;
    parentCollectionSlugs: string[];
    parentEntityIds: string[];
    canCreate: boolean;
    onNewClick?: () => void;
}

/**
 * Props for the `collection.header.action` slot.
 * @group Plugins
 */
export interface CollectionHeaderActionProps {
    property: Property;
    propertyKey: string;
    path: string;
    parentCollectionSlugs: string[];
    parentEntityIds: string[];
    onHover: boolean;
    collection: AdminCollection;
    tableController: EntityTableController;
}

/**
 * Props for the `collection.add-column` slot.
 * @group Plugins
 */
export interface CollectionAddColumnProps {
    path: string;
    parentCollectionSlugs: string[];
    parentEntityIds: string[];
    collection: AdminCollection;
    tableController: EntityTableController;
}

/**
 * Props for the `collection.error` slot.
 * @group Plugins
 */
export interface CollectionErrorProps {
    path: string;
    collection: AdminCollection;
    parentCollectionSlugs?: string[];
    parentEntityIds?: string[];
    error: Error;
}

/**
 * Props for the `kanban.setup` slot.
 * @group Plugins
 */
export interface KanbanSetupProps {
    collection: AdminCollection;
    fullPath: string;
    parentCollectionSlugs: string[];
    parentEntityIds: string[];
}

/**
 * Props for the `kanban.add-column` slot.
 * @group Plugins
 */
export interface KanbanAddColumnProps {
    collection: AdminCollection;
    fullPath: string;
    parentCollectionSlugs: string[];
    parentEntityIds: string[];
    columnProperty: string;
}

// ── New slot prop interfaces ──────────────────────────────────────────

/**
 * Props for `entity.row.actions` slot.
 * Rendered for each row in a entity collection table.
 * @group Plugins
 */
export interface EntityRowActionsProps {
    entity: Entity;
    entityId: string;
    path: string;
    collection: AdminCollection;
    parentCollectionSlugs: string[];
    parentEntityIds: string[];
    selectionController: SelectionController;
    context: RebaseContext;
}

/**
 * Props for `entity.field.before` and `entity.field.after` slots.
 * Rendered around individual form fields in the entity edit view.
 * @group Plugins
 */
export interface EntityFieldSlotProps {
    propertyKey: string;
    property: Property;
    path: string;
    entityId?: string | number;
    collection: AdminCollection;
    context: RebaseContext;
}

/**
 * Props for `collection.filter-panel` slot.
 * Custom filter sidebar rendered alongside the collection table.
 * @group Plugins
 */
export interface CollectionFilterPanelProps {
    path: string;
    collection: AdminCollection;
    parentCollectionSlugs: string[];
    parentEntityIds: string[];
    tableController: EntityTableController;
    context: RebaseContext;
}

/**
 * Props for `dashboard.widget` slot.
 * Widgets rendered on the home / dashboard page.
 * @group Plugins
 */
export interface DashboardWidgetProps {
    context: RebaseContext;
}

/**
 * Props for `global.search` slot.
 * Cross-collection search bar rendered in the app shell.
 * @group Plugins
 */
export interface GlobalSearchProps {
    context: RebaseContext;
}

/**
 * Props for `shell.toolbar` slot.
 * Actions rendered in the top-level toolbar / app bar area.
 * @group Plugins
 */
export interface ShellToolbarProps {
    context: RebaseContext;
}

/**
 * Props for `collection.widgets` slot.
 * Widgets rendered above the collection table.
 * @group Plugins
 */
export interface CollectionWidgetsSlotProps {
    path: string;
    collection: AdminCollection;
    parentCollectionSlugs: string[];
    parentEntityIds: string[];
}

/**
 * Props for `home.card.widget` slot.
 * Compact widget rendered inline in a home page collection card.
 * @group Plugins
 */
export interface HomeCardWidgetSlotProps {
    slug: string;
    collection: AdminCollection;
    context: RebaseContext;
}
