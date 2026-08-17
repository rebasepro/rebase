import React from "react";
import type { Entity, ComponentRef } from "@rebasepro/types";
import type { AdminCollection } from "@rebasepro/admin-types";

import type { CollectionSize, EntityTableController, SelectionController, ViewMode } from "../collections";

/**
 * A custom rendering of *one* collection's rows, selectable from the same view
 * switcher as list / table / cards / kanban.
 *
 * This is the middle scope of custom UI. The other two already exist and this
 * is not a substitute for either:
 *
 * - one record → `entityViews` (the entity tab strip)
 * - one collection's rows, rendered differently → **this**
 * - a workflow spanning several collections → `AppView` (`views={[…]}`)
 *
 * A view mode is another rendering of the *same query*. The `Builder` is handed
 * the live {@link EntityTableController}, so it inherits the collection's
 * filters, search string, sort, pagination, role checks and entity side panel
 * for free — which is the whole reason to declare one instead of an `AppView`.
 *
 * If your component ignores `tableController` and fetches tables of its own, it
 * wants to be an `AppView`: the toolbar above it — search box, filters, the
 * record count — would be describing a query the view does not render.
 *
 * @group Models
 */
export type CollectionCustomView<M extends Record<string, unknown> = Record<string, unknown>> = {
    /**
     * Identifies this view. It is what `defaultViewMode` and `enabledViews`
     * name, and what the `__view` URL param carries, so it must not collide
     * with a built-in mode ("list", "table", "cards", "kanban").
     *
     * Treat it as frozen once shipped: users have it persisted in their saved
     * collection config and in bookmarked URLs.
     */
    key: string;

    /** Label shown in the view switcher. */
    name: string;

    /**
     * Icon shown beside the name, as a `lucide-react` icon name (e.g. `"Map"`)
     * or a rendered node. A name is what the collection editor can store.
     */
    icon?: string | React.ReactNode;

    /**
     * The component that renders the rows.
     */
    Builder: ComponentRef<CollectionCustomViewParams<M>>;

    /**
     * How clicking a record should present it, overriding what
     * `resolveOpenEntityMode` would otherwise derive from the view mode.
     * Defaults to `"side_panel"`, which is what the board uses: a custom view
     * usually owns its whole surface and should keep it.
     */
    openEntityMode?: "side_panel" | "full_screen" | "split" | "dialog";

    /**
     * Whether the size selector applies to this view. Off by default — most
     * custom views have no notion of row height.
     */
    sizeable?: boolean;
};

/**
 * What a {@link CollectionCustomView}'s `Builder` receives.
 *
 * This is the same set the built-in view bindings are given, so a custom view
 * starts from parity with them.
 *
 * @group Models
 */
export interface CollectionCustomViewParams<M extends Record<string, unknown> = Record<string, unknown>> {
    /** The collection being rendered, fully resolved. */
    collection: AdminCollection<M>;

    /**
     * The live query: rows, loading state, pagination, and the filter / sort /
     * search state shared with the toolbar. Read rows from here rather than
     * fetching — that is what keeps the toolbar honest.
     */
    tableController: EntityTableController<M>;

    /** Full path of the collection, e.g. `users/1234/addresses`. */
    path: string;

    /** Parent path segments, when this is a subcollection. */
    parentCollectionSlugs?: string[];
    parentEntityIds?: string[];

    /**
     * Open a record. Routes through the collection's resolved
     * `openEntityMode`, so the side panel, split view and full-screen form all
     * work without the view knowing which one it got.
     */
    onEntityClick?: (entity: Entity<M>) => void;

    /** Create a record. Undefined when the user may not create. */
    onNewClick?: () => void;

    /** Whether the current user may create records in this collection. */
    canCreate?: boolean;

    selectionController?: SelectionController<M>;
    selectionEnabled?: boolean;

    /** Records to draw as highlighted, e.g. the one open in the side panel. */
    highlightedEntities?: Entity<M>[];

    /** Records deleted in this session, for optimistic removal. */
    deletedEntities?: Entity<M>[];

    /** The shared empty state, so a custom view matches the built-ins. */
    emptyComponent?: React.ReactNode;

    /** Set when the view declared `sizeable`. */
    size?: CollectionSize;

    /** The mode this view was resolved to, for views that render several. */
    viewMode?: ViewMode;
}
