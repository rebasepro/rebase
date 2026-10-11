import type { AdminCollection, CollectionCustomView, ViewMode } from "@rebasepro/cms-types";
import { resolveCollectionViews } from "./resolutions";
import { OpenEntityMode, resolveOpenEntityMode, resolveViewMode } from "./view_mode";

/**
 * How a record of `collection` opens when it is reached by URL, resolved from
 * the same inputs the collection view uses: the collection's custom views
 * (inline and named from the app registry), the view mode in the URL, the
 * saved one, and the collection default.
 *
 * The router used to resolve the view mode without the custom views, so a
 * custom view in the URL read as unknown and fell back to the list ("split"),
 * while the collection view resolved that view's own `openEntityMode`. A
 * custom view declaring "full_screen" then changed the URL and opened nothing.
 */
export function resolveCollectionOpenMode({
    collection,
    search,
    savedViewMode,
    registeredViews
}: {
    collection: Pick<AdminCollection<any>, "customViews" | "defaultViewMode" | "openEntityMode">;
    search?: string;
    savedViewMode?: ViewMode | null;
    /** The app-level registry of collection views (`customizationController.collectionViews`). */
    registeredViews?: CollectionCustomView<any>[];
}): OpenEntityMode {
    const customViews = resolveCollectionViews(collection.customViews, registeredViews);
    const customKeys = customViews.map((view) => view.key);
    const viewMode = resolveViewMode({ collection, search, savedViewMode, customKeys });
    return resolveOpenEntityMode({
        collection,
        viewMode,
        customView: customViews.find((view) => view.key === viewMode)
    });
}
