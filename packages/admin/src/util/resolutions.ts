import { HistoryIcon } from "@rebasepro/ui";
import React from "react";
import type { CollectionCustomView, CustomizationController, EntityAction, EntityCustomView } from "@rebasepro/admin-types";
import { VIEW_MODES } from "./view_mode";

/**
 * Built-in entity views that are resolved by token name.
 * These are always available without needing to be registered
 * in the customization controller's entityViews array.
 */
const BUILTIN_ENTITY_VIEWS: Record<string, EntityCustomView> = {
    "__rebase_history": {
        key: "__rebase_history",
        name: "History",
        tabComponent: React.createElement(HistoryIcon, { size: 20 }),
        position: "end"
    }
};

export function resolveEntityView(
    entityView: string | EntityCustomView<any>,
    contextEntityViews?: EntityCustomView<any>[]
): EntityCustomView<any> | undefined {
    if (typeof entityView === "string") {
        // Check built-in views first, then user-registered views
        return BUILTIN_ENTITY_VIEWS[entityView]
            ?? contextEntityViews?.find((entry) => entry.key === entityView);
    } else {
        return entityView;
    }
}

/**
 * Resolve a collection's `admin.customViews` into the views it can actually
 * render, dropping every entry that names a key nothing registered.
 *
 * Dropping is deliberate: an unresolvable key must not become a switcher entry
 * that renders a blank panel. It falls out of `enabledViews` too, so a user
 * whose saved view mode was removed lands on a built-in.
 */
export function resolveCollectionViews(
    customViews: (string | CollectionCustomView<any>)[] | undefined,
    contextCollectionViews?: CollectionCustomView<any>[]
): CollectionCustomView<any>[] {
    if (!customViews) return [];
    const resolved: CollectionCustomView<any>[] = [];
    const seen = new Set<string>();
    for (const entry of customViews) {
        const view = typeof entry === "string"
            ? contextCollectionViews?.find((candidate) => candidate.key === entry)
            : entry;
        // A custom view keyed "table" would shadow a built-in in the switcher
        // and be unreachable in the render chain, which checks built-ins first.
        if (!view || VIEW_MODES.includes(view.key) || seen.has(view.key)) continue;
        seen.add(view.key);
        resolved.push(view);
    }
    return resolved;
}

export function resolveEntityAction<M extends Record<string, unknown>>(
    entityAction: string | EntityAction<M>,
    contextEntityActions?: EntityAction<M>[]
): EntityAction<M> | undefined {
    if (typeof entityAction === "string") {
        return contextEntityActions?.find((entry) => entry.key === entityAction);
    } else {
        return entityAction;
    }
}

export function resolvedSelectedEntityView<M extends Record<string, unknown>>(
    customViews: (string | EntityCustomView<M>)[] | undefined,
    customizationController: CustomizationController,
    selectedTab?: string,
    _canEdit?: boolean
) {
    const resolvedEntityViews = customViews
        ? customViews
              .map((e) => resolveEntityView(e, (customizationController as { entityViews?: EntityCustomView[] }).entityViews))
              .filter(Boolean)
              .filter((e) => (e as EntityCustomView).key !== "__rebase_history") as EntityCustomView[]
        : [];

    const selectedEntityView = resolvedEntityViews.find((e) => e.key === selectedTab);
    const selectedSecondaryForm =
        customViews &&
        resolvedEntityViews
            .filter((e) => e.includeActions)
            .find((e) => e.key === selectedTab);
    return {
        resolvedEntityViews,
        selectedEntityView,
        selectedSecondaryForm
    };
}
