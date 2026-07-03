import React from "react";
import type { CollectionActionsProps, SnapshotTableController, SelectionController, SnapshotCollection } from "./collections";
import type { Snapshot } from "./snapshots";
import type { PluginFormActionProps, PluginGenericProps, PluginHomePageActionsProps, PluginHomePageAdditionalCardsProps } from "./plugins";
import type { Property } from "./properties";
import type { RebaseContext } from "../rebase_context";

/**
 * Registry mapping slot names to their component prop types.
 * Each key represents a UI extension point in the CMS.
 * @group Plugins
 */
export interface SlotRegistry {
    // ── Home page ─────────────────────────────────────────────────────
    "home.actions": PluginGenericProps;
    "home.cards": PluginHomePageAdditionalCardsProps;
    "home.children.start": PluginGenericProps;
    "home.children.end": PluginGenericProps;
    /** Compact insight widget rendered inline in a home page collection card. */
    "home.card.insight": HomeCardInsightSlotProps;
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
    /** Insight widgets rendered above the collection table. */
    "collection.insights": CollectionInsightsSlotProps;

    // ── Snapshot / Form ─────────────────────────────────────────────────
    "form.actions": PluginFormActionProps;
    "form.actions.top": PluginFormActionProps;
    /** Rendered before the form title / field list. */
    "form.before": PluginFormActionProps;
    /** Rendered after the form field list. */
    "form.after": PluginFormActionProps;

    // ── Snapshot row actions ────────────────────────────────────────────
    /** Per-row actions in snapshot tables (e.g. bulk actions, row context menus). */
    "snapshot.row.actions": SnapshotRowActionsProps;

    // ── Snapshot field decoration ───────────────────────────────────────
    /** Inject UI before an individual form field. */
    "snapshot.field.before": SnapshotFieldSlotProps;
    /** Inject UI after an individual form field. */
    "snapshot.field.after": SnapshotFieldSlotProps;

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
    collection: SnapshotCollection;
    parentCollectionSlugs: string[];
    parentSnapshotIds: string[];
    tableController: SnapshotTableController;
    selectionController: SelectionController;
}

/**
 * Props for the `collection.empty-state` slot.
 * @group Plugins
 */
export interface CollectionEmptyStateProps {
    path: string;
    collection: SnapshotCollection;
    parentCollectionSlugs: string[];
    parentSnapshotIds: string[];
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
    parentSnapshotIds: string[];
    onHover: boolean;
    collection: SnapshotCollection;
    tableController: SnapshotTableController;
}

/**
 * Props for the `collection.add-column` slot.
 * @group Plugins
 */
export interface CollectionAddColumnProps {
    path: string;
    parentCollectionSlugs: string[];
    parentSnapshotIds: string[];
    collection: SnapshotCollection;
    tableController: SnapshotTableController;
}

/**
 * Props for the `collection.error` slot.
 * @group Plugins
 */
export interface CollectionErrorProps {
    path: string;
    collection: SnapshotCollection;
    parentCollectionSlugs?: string[];
    parentSnapshotIds?: string[];
    error: Error;
}

/**
 * Props for the `kanban.setup` slot.
 * @group Plugins
 */
export interface KanbanSetupProps {
    collection: SnapshotCollection;
    fullPath: string;
    parentCollectionSlugs: string[];
    parentSnapshotIds: string[];
}

/**
 * Props for the `kanban.add-column` slot.
 * @group Plugins
 */
export interface KanbanAddColumnProps {
    collection: SnapshotCollection;
    fullPath: string;
    parentCollectionSlugs: string[];
    parentSnapshotIds: string[];
    columnProperty: string;
}

// ── New slot prop interfaces ──────────────────────────────────────────

/**
 * Props for `snapshot.row.actions` slot.
 * Rendered for each row in a snapshot collection table.
 * @group Plugins
 */
export interface SnapshotRowActionsProps {
    snapshot: Snapshot;
    snapshotId: string;
    path: string;
    collection: SnapshotCollection;
    parentCollectionSlugs: string[];
    parentSnapshotIds: string[];
    selectionController: SelectionController;
    context: RebaseContext;
}

/**
 * Props for `snapshot.field.before` and `snapshot.field.after` slots.
 * Rendered around individual form fields in the snapshot edit view.
 * @group Plugins
 */
export interface SnapshotFieldSlotProps {
    propertyKey: string;
    property: Property;
    path: string;
    snapshotId?: string | number;
    collection: SnapshotCollection;
    context: RebaseContext;
}

/**
 * Props for `collection.filter-panel` slot.
 * Custom filter sidebar rendered alongside the collection table.
 * @group Plugins
 */
export interface CollectionFilterPanelProps {
    path: string;
    collection: SnapshotCollection;
    parentCollectionSlugs: string[];
    parentSnapshotIds: string[];
    tableController: SnapshotTableController;
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
 * Props for `collection.insights` slot.
 * Insight widgets rendered above the collection table.
 * @group Plugins
 */
export interface CollectionInsightsSlotProps {
    path: string;
    collection: SnapshotCollection;
    parentCollectionSlugs: string[];
    parentSnapshotIds: string[];
}

/**
 * Props for `home.card.insight` slot.
 * Compact insight rendered inline in a home page collection card.
 * @group Plugins
 */
export interface HomeCardInsightSlotProps {
    slug: string;
    collection: SnapshotCollection;
    context: RebaseContext;
}
