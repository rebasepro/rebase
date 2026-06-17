import type { AppView, AppViewsBuilder, EntityAction, EntityCollection, FirebaseCollection, RebasePlugin, AuthCollectionConfig } from "@rebasepro/types";
import { AuthController, DataDriver, User, RebaseData } from "@rebasepro/types";
import type { EntityCollectionsBuilder } from "@rebasepro/types";
import { canReadCollection } from "@rebasepro/common";
import { resetPasswordAction } from "../../components/common/default_entity_actions";

export function filterOutNotAllowedCollections(resolvedCollections: EntityCollection[], authController: AuthController<User>): EntityCollection[] {
    return resolvedCollections
        .filter((c) => canReadCollection(c, authController))
        .map((c) => {
            if (!("subcollections" in c) || !c.subcollections) return c;
            return {
                ...c,
                subcollections: () => filterOutNotAllowedCollections((c as FirebaseCollection).subcollections?.() ?? [], authController)
            } as FirebaseCollection;
        });
}

export function applyPluginModifyCollection(resolvedCollections: EntityCollection[], modifyCollection: (collection: EntityCollection) => EntityCollection) {
    return resolvedCollections.map((collection: EntityCollection): EntityCollection => {
        const modifiedCollection = modifyCollection(collection);
        if ("subcollections" in modifiedCollection && modifiedCollection.subcollections) {
            return {
                ...modifiedCollection,
                subcollections: () => applyPluginModifyCollection((modifiedCollection as FirebaseCollection).subcollections?.() ?? [], modifyCollection)
            } as FirebaseCollection;
        }
        return modifiedCollection;
    });
}

/**
 * Auto-inject auth-specific entity actions for collections with `auth: true`.
 *
 * Resolution:
 * - `auth: true` or `auth: { enabled: true }` (no actions config) → inject `resetPasswordAction`
 * - `auth: { enabled: true, actions: { resetPassword: false } }` → skip injection
 * - `auth: { enabled: true, actions: { resetPassword: customAction } }` → inject the custom action
 *
 * Skips injection if the collection already has an action with key `"reset_password"`.
 */
function injectAuthEntityActions(collections: EntityCollection[]): EntityCollection[] {
    return collections.map((collection) => {
        const authProp = (collection as any).auth;
        if (!authProp) return collection;

        const isAuth = authProp === true || (typeof authProp === "object" && authProp.enabled === true);
        if (!isAuth) return collection;

        const authConfig: AuthCollectionConfig | undefined = typeof authProp === "object" ? authProp : undefined;

        // Determine which action to inject (if any)
        const resetPref = authConfig?.actions?.resetPassword;
        let actionToInject: EntityAction | undefined;

        if (resetPref === false) {
            // Explicitly disabled
            actionToInject = undefined;
        } else if (typeof resetPref === "object") {
            // Custom EntityAction provided
            actionToInject = resetPref;
        } else {
            // true, undefined, or auth: true (shorthand) → use default
            actionToInject = resetPasswordAction;
        }

        if (!actionToInject) return collection;

        // Don't double-inject if already present
        const existing = collection.entityActions ?? [];
        const alreadyHas = existing.some(
            (a: EntityAction) => typeof a === "object" && a.key === (actionToInject as EntityAction).key
        );
        if (alreadyHas) return collection;

        return {
            ...collection,
            entityActions: [...existing, actionToInject],
        };
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

    // Auto-inject auth entity actions (resetPassword, etc.)
    resolvedCollections = injectAuthEntityActions(resolvedCollections);

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
