import type { AuthCollectionConfig, CollectionCallbacks } from "@rebasepro/types";
import type { AppView, AppViewsBuilder, EntityAction, CollectionConfigsBuilder, RebaseContext, RebasePlugin, UserCreationResult, AdminCollection } from "@rebasepro/cms-types";
import { type User, type RebaseData } from "@rebasepro/types";
import { type AuthController, resolveAdminCollection } from "@rebasepro/cms-types";
import { canReadCollection } from "@rebasepro/common";
import { resetPasswordAction } from "../../components/common/default_entity_actions";
import { CreationResultDialog } from "../../components/admin/CreationResultDialog";
import React from "react";

/**
 * Check whether a `RebaseCallContext` is actually the full frontend
 * `RebaseContext` (which carries `dialogsController`).
 */
function isRebaseContext(ctx: unknown): ctx is RebaseContext {
    return typeof ctx === "object" && ctx !== null && "dialogsController" in ctx;
}

export function filterOutNotAllowedCollections(resolvedCollections: AdminCollection[], authController: AuthController): AdminCollection[] {
    return resolvedCollections
        .filter((c) => canReadCollection(c, authController))
        .map((c) => {
            if (!c.childCollections) return c;
            return {
                ...c,
                childCollections: () => filterOutNotAllowedCollections(c.childCollections!() ?? [], authController)
            };
        });
}

export function applyPluginModifyCollection(resolvedCollections: AdminCollection[], modifyCollection: (collection: AdminCollection) => AdminCollection): AdminCollection[] {
    return resolvedCollections.map((collection): AdminCollection => {
        const modifiedCollection = modifyCollection(collection);
        if (modifiedCollection.childCollections) {
            return {
                ...modifiedCollection,
                childCollections: () => applyPluginModifyCollection(modifiedCollection.childCollections!() ?? [], modifyCollection)
            };
        }
        return modifiedCollection;
    });
}

/**
 * Auto-inject auth-specific entity actions and callbacks for collections
 * with `auth: true` or `auth: { enabled: true }`.
 *
 * Injections:
 * 1. **resetPasswordAction** — adds the entity action unless explicitly disabled,
 *    or unless the auth adapter reports no `adminPasswordReset` support. Custom
 *    adapters mount their own admin routes and may not implement
 *    `POST /admin/users/:userId/reset-password`; injecting the action anyway
 *    would show a button that can only ever 404.
 * 2. **browserCallbacks.afterSave** — shows the `CreationResultDialog` when a
 *    new user is created with `invitationSent` or `temporaryPassword` in the
 *    response
 *
 * Skips injection if the collection already has the action/callback present.
 */
function injectAuthCollectionConfig(
    collections: AdminCollection[],
    adminPasswordResetSupported: boolean
): AdminCollection[] {
    return collections.map((collection) => {
        const authProp = collection.auth;
        if (!authProp) return collection;

        const isAuth = authProp === true || (typeof authProp === "object" && authProp.enabled === true);
        if (!isAuth) return collection;

        const authConfig: AuthCollectionConfig | undefined = typeof authProp === "object" ? authProp : undefined;

        let result = collection;

        // ─── Entity Action injection (resetPassword) ─────────────────────
        const resetPref = authConfig?.actions?.resetPassword;
        let actionToInject: EntityAction | undefined;

        if (resetPref === false) {
            actionToInject = undefined;
        } else if (typeof resetPref === "object") {
            // An explicitly supplied action is the collection author's own; they
            // own its backend, so the adapter capability doesn't apply.
            // `auth.actions.resetPassword`'s object form is an EntityAction; core
            // types it as `object` because a server never renders one.
            actionToInject = resetPref as EntityAction;
        } else if (!adminPasswordResetSupported) {
            actionToInject = undefined;
        } else {
            actionToInject = resetPasswordAction;
        }

        if (actionToInject) {
            const injectedAction = actionToInject;
            const existing = result.entityActions ?? [];
            // An entry is either the action or the key of an app-level one, and a
            // collection that names `"reset_password"` already has this action — so
            // the string form has to count here too, or the reset action is injected
            // a second time and the user gets two identical buttons.
            const alreadyHas = existing.some((a) =>
                typeof a === "string"
                    ? a === injectedAction.key
                    : a.key != null && a.key === injectedAction.key
            );
            if (!alreadyHas) {
                result = {
                    ...result,
                    entityActions: [...existing, injectedAction]
                };
            }
        }

        // ─── afterSave callback (creation result dialog) ─────────────────
        //
        // `browserCallbacks`, not `callbacks`. This injection has always been a
        // panel behaviour — it opens a dialog — but it was installed on the
        // server's block, which nothing in the browser runs and which the Vite
        // plugin strips on the way into the bundle. So it never fired, and
        // creating a user through the panel never showed the temporary password
        // the server had just minted and will not repeat.
        const existingAfterSave = result.browserCallbacks?.afterSave;
        const injectedAfterSave = {
            ...result.browserCallbacks,
            afterSave: (async (props) => {
                    await existingAfterSave?.(props);

                    const { values, status, context } = props;
                    if (status !== "new" && status !== "copy") return;

                    const hasCreationInfo = values.invitationSent !== undefined || values.temporaryPassword !== undefined;
                    if (!hasCreationInfo || !isRebaseContext(context) || !context.dialogsController) return;

                    const { dialogsController } = context;

                    const creationResult: UserCreationResult = {
                        user: {
                            uid: String(props.id),
                            email: typeof values.email === "string" ? values.email : "",
                            displayName: typeof values.displayName === "string" ? values.displayName : "",
                            roles: Array.isArray(values.roles) ? values.roles as string[] : [],
                            photoURL: typeof values.photoURL === "string"
                                ? values.photoURL
                                : typeof values.photoUrl === "string"
                                    ? values.photoUrl
                                    : null,
                            providerId: "password",
                            isAnonymous: false
                        },
                        invitationSent: !!values.invitationSent,
                        temporaryPassword: typeof values.temporaryPassword === "string" ? values.temporaryPassword : undefined,
                        emailDeliveryFailed: !!values.emailDeliveryFailed
                    };

                    const { closeDialog } = dialogsController.open({
                        key: "user_creation_result",
                        Component: () => (
                            React.createElement(CreationResultDialog, {
                                result: creationResult,
                                onClose: () => closeDialog()
                            })
                        )
                    });
            }) as NonNullable<CollectionCallbacks["afterSave"]>
        };

        // Written to both the flat key and the block. This injection runs after
        // `resolveAdminCollection` has flattened `admin` onto the top level, and
        // that flattening spreads the block *over* the top level — so anything
        // put only up here is undone the next time a collection is re-resolved,
        // which the registry controller does on every lookup. Writing both keeps
        // re-flattening the no-op its callers already believe it is.
        result = {
            ...result,
            browserCallbacks: injectedAfterSave,
            admin: {
                ...result.admin,
                browserCallbacks: injectedAfterSave
            }
        };

        return result;
    });
}

export async function resolveCollections(
    collections: undefined | AdminCollection[] | CollectionConfigsBuilder,
    authController: AuthController,
    data: RebaseData,
    plugins: RebasePlugin[] | undefined
): Promise<AdminCollection[]> {
    let resolvedCollections: AdminCollection[] = [];
    if (typeof collections === "function") {
        resolvedCollections = await collections({
            user: authController.user,
            authController,
            data
        });
    } else if (Array.isArray(collections)) {
        resolvedCollections = collections;
    }

    // Collections arrive in the authoring shape, with presentation nested under
    // `admin`. Everything downstream — plugins, navigation, the drawer — reads the
    // panel's flat view model, so `admin.group` or `admin.hideFromNavigation`
    // would otherwise be silently ignored.
    resolvedCollections = resolvedCollections.map(resolveAdminCollection);

    if (plugins) {
        for (const plugin of plugins) {
            if (plugin.hooks?.modifyCollection) {
                resolvedCollections = applyPluginModifyCollection(resolvedCollections, plugin.hooks.modifyCollection);
            }

            if (plugin.hooks?.injectCollections) {
                // A plugin may return collections in the authoring shape too; the
                // flattening is idempotent, so re-running it is safe.
                resolvedCollections = plugin.hooks.injectCollections(resolvedCollections).map(resolveAdminCollection);
            }
        }
    }

    // Auto-inject auth entity actions and callbacks (resetPassword, creation dialog, etc.)
    resolvedCollections = injectAuthCollectionConfig(
        resolvedCollections,
        authController.capabilities?.adminPasswordReset ?? true
    );

    resolvedCollections = filterOutNotAllowedCollections(resolvedCollections, authController);
    return resolvedCollections;
}

export async function resolveAppViews(
    baseViews: AppView[] | AppViewsBuilder | undefined,
    authController: AuthController,
    data: RebaseData,
    plugins?: RebasePlugin[]
): Promise<AppView[]> {
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

    // Detect duplicate view slugs (dev warning)
    if (process.env.NODE_ENV !== 'production') {
        const slugCounts = new Map<string, number>();
        resolvedViews.forEach(v => {
            slugCounts.set(v.slug, (slugCounts.get(v.slug) ?? 0) + 1);
        });
        slugCounts.forEach((count, slug) => {
            if (count > 1) {
                console.warn(
                    `[Rebase] Duplicate view slug "${slug}" detected (${count} views). ` +
                    `Last-write-wins. Ensure unique slugs across admin views and plugins.`
                );
            }
        });
    }

    // Filter by roles — applies to admin, plugin, and builder-returned views
    resolvedViews = filterViewsByRole(resolvedViews, authController);

    return resolvedViews;
}

/**
 * Filter views by the `roles` field on AppView.
 * When `roles` is set, the view is only included if the current user
 * has at least one of the listed roles. Views without `roles` (or with
 * an empty array) are always included.
 */
function filterViewsByRole(views: AppView[], authController: AuthController): AppView[] {
    const userRoles = authController.user?.roles ?? [];
    return views.filter(view => {
        if (!view.roles || view.roles.length === 0) return true;
        return view.roles.some(role => userRoles.includes(role));
    });
}
