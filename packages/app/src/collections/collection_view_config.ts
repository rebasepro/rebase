/**
 * Collection helpers that only the admin panel needs.
 *
 * These lived in `@rebasepro/common`, which is on the backend's dependency path,
 * and they read presentation fields — `defaultSelectedView`, `localChangesBackup`
 * — that now live under a collection's `admin` block. A server has no use for
 * either, and `resolveDefaultSelectedView` was the *only* thing making
 * `@rebasepro/common` name an admin view-model type
 * (`DefaultSelectedViewBuilder`), which was the last UI symbol any core package
 * imported.
 */
import type { ChildViewSource, CollectionConfig } from "@rebasepro/types";
import { type AdminCollection, type DefaultSelectedViewBuilder, type DefaultSelectedViewParams, resolveAdminCollection } from "@rebasepro/cms-types";
import { getEntityChildViews } from "@rebasepro/common";

export function resolveDefaultSelectedView(
    defaultSelectedView: string | DefaultSelectedViewBuilder | undefined,
    params: DefaultSelectedViewParams
) {
    if (!defaultSelectedView) {
        return undefined;
    } else if (typeof defaultSelectedView === "string") {
        return defaultSelectedView;
    } else {
        return defaultSelectedView(params);
    }
}

export function getLocalChangesBackup(collection: AdminCollection) {
    if (!collection.localChangesBackup) {
        return "manual_apply";
    }

    return collection.localChangesBackup;
}

/**
 * Returns the primary keys for a entity collection by inspecting the properties
 * and finding any properties with `isId`.
 * Fallbacks to `["id"]` if no properties are marked as `isId: true`.
 * @param collection
 */
/**
 * A collection's child collections, as the panel's view model.
 *
 * `getSubcollections` in `@rebasepro/common` returns the contract type, so the
 * children of a resolved collection arrived un-flattened and reading
 * `child.icon` or `child.hideFromNavigation` failed. Resolving is not recursive
 * on purpose — children are fetched lazily through a thunk
 * (`childCollections`/`subcollections`), so walking the whole tree eagerly to
 * flatten it would defeat that.
 */
export function getAdminSubcollections(
    collection: AdminCollection | CollectionConfig
): AdminCollection[] {
    return getAdminEntityChildViews(collection).map(view => view.collection);
}

/**
 * A collection's child views as the panel's view model, keeping the `source`
 * that says what kind of list each one is.
 *
 * The tabs need it: on a junction-backed relation the parent owns the *link*,
 * so the destructive action is a removal from this record, not a delete. Every
 * caller that renders a tab should prefer this over
 * {@link getAdminSubcollections}, which flattens that distinction away.
 */
export function getAdminEntityChildViews(
    collection: AdminCollection | CollectionConfig
): { key: string; collection: AdminCollection; source: ChildViewSource }[] {
    return (getEntityChildViews(collection as CollectionConfig) ?? []).map(view => ({
        key: view.key,
        collection: resolveAdminCollection(view.collection),
        source: view.source
    }));
}
