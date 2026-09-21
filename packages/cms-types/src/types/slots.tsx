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

    // ── Global / Shell ────────────────────────────────────────────────
    /** Cross-collection search, rendered in the app bar beside the breadcrumbs. */
    "global.search": GlobalSearchProps;
    /** Top-level actions, rendered at the end of the app bar. */
    "shell.toolbar": ShellToolbarProps;

    // ── Kanban ────────────────────────────────────────────────────────
    "kanban.setup": KanbanSetupProps;
    "kanban.add-column": KanbanAddColumnProps;
}

/**
 * Slots this build declares but renders nowhere. **Empty, and meant to stay so.**
 *
 * It held seven of twenty-nine. Each appeared in {@link SlotRegistry}, had a
 * props interface, and had a row in the public slot reference alongside the
 * ones that work — so a plugin author picked one off the table, registered a
 * component, saw nothing, and had no way to tell whether the fault was theirs.
 *
 * Five were implemented: `entity.field.before` and `entity.field.after` render
 * in `PropertyFieldBinding` (the one component every form field goes through),
 * `entity.row.actions` in `CollectionRowActions`, and `global.search` and
 * `shell.toolbar` in `DefaultAppBar`. Two were removed, because nothing was
 * missing that a declared slot would have supplied:
 *
 * - **`collection.filter-panel`** described a filter sidebar the admin does not
 *   have. Rendering it meant inventing a region, which is a feature and not a
 *   slot; `collection.toolbar` and `collection.widgets` are the declared places
 *   for filter UI beside a table, and both work.
 * - **`dashboard.widget`** took `{ context }` and nothing else, so it carried
 *   no position on a page that already has four positions —
 *   `home.children.start`, `home.children.end`, `home.cards` and
 *   `home.card.widget`.
 *
 * This is a statement of fact, not a wish list: `slot-render-sites.test.ts`
 * derives the same set by scanning for render sites and fails when the two
 * disagree — in *both* directions. So a slot declared without a render site
 * has to be added back here, at which point `Rebase` warns anyone who registers
 * for it, which is the whole point.
 */
export const UNRENDERED_SLOTS = [] as const satisfies readonly (keyof SlotRegistry)[];

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
     * The component to render in the slot, taking that slot's props.
     *
     * This was `React.ComponentType<any>`, "typed loosely so mixed-slot arrays
     * work" — and the looseness was doing real damage: `{ slot:
     * "collection.actions", Component: MyThing }` typechecked whatever
     * `MyThing`'s props were, so a component written against the wrong slot's
     * props compiled, registered, and then read `undefined` off every prop it
     * expected. The only check was at the `useSlot` render site, which is
     * inside the framework and reports nothing to the author.
     *
     * The mixed-array problem is real but is a problem with the *array*, not
     * with this field: see {@link AnySlotContribution}, which distributes over
     * the slot names so each element is checked against its own slot.
     */
    Component: React.ComponentType<SlotRegistry[K]>;

    /**
     * Additional props to merge into the slot props before rendering.
     */
    props?: Record<string, unknown>;

    /**
     * Ordering hint. Lower values render first. Defaults to 50.
     */
    order?: number;
}

/**
 * A contribution to *some* slot, checked against that slot.
 *
 * `SlotContribution[]` cannot be the type of a mixed list: with `K` left at its
 * default the props become the union of every slot's, and a component is
 * contravariant in its props, so nothing satisfies it. Distributing the union
 * over the slot names instead gives one member per slot, and TypeScript picks
 * the member whose `slot` matches — which is what makes
 * `{ slot: "collection.actions", Component: WrongProps }` an error at the
 * declaration rather than a silent `undefined` at render.
 *
 * @group Plugins
 */
export type AnySlotContribution = { [K in SlotName]: SlotContribution<K> }[SlotName];

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
 * Props for the `entity.row.actions` slot.
 *
 * Rendered per row in a collection table, in the same hover overlay as the
 * built-in row actions — beside `edit` and the collapsed action menu.
 *
 * `collection`, `path` and `selectionController` are optional because the
 * render site's own are: a table can be shown without selection enabled, and a
 * relation picker renders rows with no collection path behind them. A slot
 * declaring them required would have promised a row's address that a row does
 * not always have.
 *
 * @group Plugins
 */
export interface EntityRowActionsProps {
    entity: Entity;
    entityId: string | number;
    path?: string;
    collection?: AdminCollection;
    selectionController?: SelectionController;
    context: RebaseContext;
}

/**
 * Props for the `entity.field.before` and `entity.field.after` slots.
 *
 * Rendered around every form field, from the one component every field goes
 * through — so a contribution appears beside a string field and a date field
 * alike.
 *
 * `collection` is optional: a field can be rendered outside a collection form
 * (an array item's inner property, a custom view that binds a property
 * directly), and those are the same fields. `propertyKey` may be a nested name
 * such as `address.street` or `friends[2]`, exactly as the field itself sees it.
 *
 * @group Plugins
 */
export interface EntityFieldSlotProps {
    propertyKey: string;
    property: Property;
    path: string;
    entityId?: string | number;
    collection?: AdminCollection;
    context: RebaseContext;
}

/**
 * Props for the `global.search` slot.
 *
 * Rendered in the app bar after the breadcrumbs and before the spacer — where
 * a search box goes. Takes only the context, so a contribution reads the
 * collections, the navigation and the client off it.
 *
 * @group Plugins
 */
export interface GlobalSearchProps {
    context: RebaseContext;
}

/**
 * Props for the `shell.toolbar` slot.
 *
 * Rendered at the end of the app bar, with the language, theme and user
 * actions. Same props as {@link GlobalSearchProps}: the two are told apart by
 * where they render, not by what they are handed.
 *
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
