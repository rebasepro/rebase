import type {
    AppView,
    AppViewsBuilder,
    AuthCollectionConfig,
    SnapshotAction,
    SnapshotCollection,
    SnapshotCollectionsBuilder,
    RebaseContext,
    RebasePlugin,
    UserCreationResult
} from "@rebasepro/types";
import { type AuthController, type User, type RebaseData } from "@rebasepro/types";
import { canReadCollection } from "@rebasepro/common";
import { resetPasswordAction } from "../../components/common/default_snapshot_actions";
import { CreationResultDialog } from "../../components/admin/CreationResultDialog";
import React from "react";

/**
 * Check whether a `RebaseCallContext` is actually the full frontend
 * `RebaseContext` (which carries `dialogsController`).
 */
function isRebaseContext(ctx: unknown): ctx is RebaseContext {
    return typeof ctx === "object" && ctx !== null && "dialogsController" in ctx;
}

export function filterOutNotAllowedCollections(resolvedCollections: SnapshotCollection[], authController: AuthController): SnapshotCollection[] {
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

export function applyPluginModifyCollection(resolvedCollections: SnapshotCollection[], modifyCollection: (collection: SnapshotCollection) => SnapshotCollection): SnapshotCollection[] {
    return resolvedCollections.map((collection): SnapshotCollection => {
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
 * Auto-inject auth-specific snapshot actions and callbacks for collections
 * with `auth: true` or `auth: { enabled: true }`.
 *
 * Injections:
 * 1. **resetPasswordAction** — adds the snapshot action unless explicitly disabled
 * 2. **afterSave callback** — shows the `CreationResultDialog` when a new user
 *    is created with `invitationSent` or `temporaryPassword` in the response
 *
 * Skips injection if the collection already has the action/callback present.
 */
function injectAuthCollectionConfig(collections: SnapshotCollection[]): SnapshotCollection[] {
    return collections.map((collection) => {
        const authProp = collection.auth;
        if (!authProp) return collection;

        const isAuth = authProp === true || (typeof authProp === "object" && authProp.enabled === true);
        if (!isAuth) return collection;

        const authConfig: AuthCollectionConfig | undefined = typeof authProp === "object" ? authProp : undefined;

        let result = collection;

        // ─── Snapshot Action injection (resetPassword) ─────────────────────
        const resetPref = authConfig?.actions?.resetPassword;
        let actionToInject: SnapshotAction | undefined;

        if (resetPref === false) {
            actionToInject = undefined;
        } else if (typeof resetPref === "object") {
            actionToInject = resetPref;
        } else {
            actionToInject = resetPasswordAction;
        }

        if (actionToInject) {
            const injectedAction = actionToInject;
            const existing = result.snapshotActions ?? [];
            const alreadyHas = existing.some(
                (a) => a.key != null && a.key === injectedAction.key
            );
            if (!alreadyHas) {
                result = {
                    ...result,
                    snapshotActions: [...existing, injectedAction]
                };
            }
        }

        // ─── afterSave callback (creation result dialog) ─────────────────
        const existingAfterSave = result.callbacks?.afterSave;
        result = {
            ...result,
            callbacks: {
                ...result.callbacks,
                afterSave: async (props) => {
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
                        temporaryPassword: typeof values.temporaryPassword === "string" ? values.temporaryPassword : undefined
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
                }
            }
        };

        return result;
    });
}

export async function resolveCollections(
    collections: undefined | SnapshotCollection[] | SnapshotCollectionsBuilder,
    authController: AuthController,
    data: RebaseData,
    plugins: RebasePlugin[] | undefined
): Promise<SnapshotCollection[]> {
    let resolvedCollections: SnapshotCollection[] = [];
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
                resolvedCollections = plugin.hooks.injectCollections(resolvedCollections);
            }
        }
    }

    // Auto-inject auth snapshot actions and callbacks (resetPassword, creation dialog, etc.)
    resolvedCollections = injectAuthCollectionConfig(resolvedCollections);

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
                    `Last-write-wins. Ensure unique slugs across CMS views and plugins.`
                );
            }
        });
    }

    // Filter by roles — applies to CMS, plugin, and builder-returned views
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
