import type { AppView, AppViewsBuilder, EntityCollection, FirebaseCollection, RebasePlugin } from "@rebasepro/types";
import { AuthController, DataDriver,  User, RebaseData } from "@rebasepro/types";
import type { EntityCollectionsBuilder } from "@rebasepro/types";
import { canReadCollection } from "@rebasepro/common";

export function filterOutNotAllowedCollections(resolvedCollections: EntityCollection[], authController: AuthController<User>): EntityCollection[] {
    return resolvedCollections
        .filter((c) => canReadCollection(c, authController))
        .map((c) => {
            if (!('subcollections' in c) || !c.subcollections) return c;
            return {
                ...c,
                subcollections: () => filterOutNotAllowedCollections((c as FirebaseCollection).subcollections?.() ?? [], authController)
            } as FirebaseCollection;
        });
}

export function applyPluginModifyCollection(resolvedCollections: EntityCollection[], modifyCollection: (collection: EntityCollection) => EntityCollection) {
    return resolvedCollections.map((collection: EntityCollection): EntityCollection => {
        const modifiedCollection = modifyCollection(collection);
        if ('subcollections' in modifiedCollection && modifiedCollection.subcollections) {
            return {
                ...modifiedCollection,
                subcollections: () => applyPluginModifyCollection((modifiedCollection as FirebaseCollection).subcollections?.() ?? [], modifyCollection)
            } as FirebaseCollection;
        }
        return modifiedCollection;
    });
}

export async function resolveCollections<U extends User, EC extends EntityCollection>(
    collections: undefined | EC[] | EntityCollectionsBuilder<EC>,
    authController: AuthController<U>,
    data: RebaseData,
    plugins: RebasePlugin[] | undefined
): Promise<EntityCollection[]> {
    let resolvedCollections: EntityCollection[] = [];
    if (typeof collections === "function") {
        resolvedCollections = await collections({
            user: authController.user,
            authController,
            data
        });
    } else if (Array.isArray(collections)) {
        resolvedCollections = collections;
    }

    if (plugins) {
        for (const plugin of plugins) {
            if (plugin.hooks?.modifyCollection) {
                resolvedCollections = applyPluginModifyCollection(resolvedCollections, plugin.hooks.modifyCollection);
            }

            if (plugin.hooks?.injectCollections) {
                resolvedCollections = plugin.hooks.injectCollections(resolvedCollections ?? []);
            }
        }
    }

    resolvedCollections = filterOutNotAllowedCollections(resolvedCollections, authController);
    return resolvedCollections;
}

export async function resolveAppViews<U extends User>(
    baseViews: AppView[] | AppViewsBuilder | undefined,
    authController: AuthController<U>,
    data: RebaseData,
    plugins?: RebasePlugin[]
) {
    let resolvedViews: AppView[] = [];
    if (typeof baseViews === "function") {
        resolvedViews = await baseViews({
            user: authController.user,
            authController,
            data
        }) ?? [];
    } else if (Array.isArray(baseViews)) {
        resolvedViews = baseViews;
    }

    // Inject views from plugins
    if (plugins) {
        for (const plugin of plugins) {
            if (plugin.views && plugin.views.length > 0) {
                resolvedViews = [...resolvedViews, ...plugin.views];
            }
        }
    }

    return resolvedViews;
}
