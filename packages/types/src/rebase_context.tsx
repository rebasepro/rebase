import type { AnalyticsController } from "./controllers/analytics_controller";
import type { AuthController } from "./controllers/auth";
import type { StorageSource } from "./controllers/storage";
import type { UserConfigurationPersistence } from "./controllers/local_config_persistence";
import type { DatabaseAdmin } from "./types/backend";
import type { RebaseClient } from "./controllers/client";

import type { RebaseSdkData } from "./controllers/data";
import type { User } from "./users";


/**
 * Context that is provided to snapshot callbacks (hooks).
 * It contains only the dependencies that are available in both the frontend and the backend.
 * @group Hooks and utilities
 */
export type RebaseCallContext<USER extends User = User> = {

    /**
     * The Rebase client instance.
     * Available in all snapshot callbacks (beforeSave, afterSave, afterRead,
     * beforeDelete, afterDelete) and in CollectionActionsProps via context.
     * Use it to call backend functions, access data, storage, etc.
     *
     * @example
     * // In a beforeSave callback:
     * const result = await context.client.functions.invoke('my-function', { ... });
     *
     * @example
     * // In a CollectionAction component:
     * const { client } = props.context;
     * const result = await client.functions.invoke('extract-job', { url });
     */
    client: RebaseClient;

    /**
     * Unified data access — `context.data.products.create(...)`.
     * Access any collection as a dynamic property.
     *
     * Returns flat rows (`{ id, ...columns }`), identical to the frontend SDK
     * client — so `context.data` in a backend callback and `client.data` in the
     * frontend behave the same way (`row.title`, never `row.values.title`).
     */
    data: RebaseSdkData;

    /**
     * Used storage implementation
     */
    storageSource: StorageSource;

    /**
     * Set by the backend when callbacks are executed on the server.
     */
    user?: USER;
}

/**
 * Context that includes the internal controllers and contexts used by the app.
 * Some controllers and context included in this context can be accessed
 * directly from their respective hooks.
 * @group Hooks and utilities
 * @see useRebaseContext
 */
export type RebaseContext<USER extends User = User, AuthControllerType extends AuthController<USER> = AuthController<USER>> = RebaseCallContext<USER> & {

    authController: AuthControllerType;

    /**
     * Controller mapping strings to collections
     */
    collectionRegistryController?: import("./controllers/collection_registry").CollectionRegistryController;

    /**
     * Controller for navigation state
     */
    navigationStateController?: import("./controllers/navigation").NavigationStateController;

    /**
     * Controller for side dialogs (side sheets)
     */
    sideDialogsController?: import("./controllers/side_dialogs_controller").SideDialogsController;

    /**
     * Controller to open the side dialog displaying snapshot forms
     */
    sideSnapshotController?: import("./controllers/side_snapshot_controller").SideSnapshotController;

    /**
     * Controller resolving URLs in the CMS
     */
    urlController?: import("./controllers/navigation").UrlController;

    /**
     * Controller to handle simple confirmation and alert dialogs
     */
    dialogsController?: import("./controllers/dialogs_controller").DialogsController;

    /**
     * Controller for CMS customization
     */
    customizationController?: import("./controllers/customization_controller").CustomizationController;

    /**
     * Controller for effective role
     */
    effectiveRoleController?: { effectiveRole: string | null, setEffectiveRole: (role: string | null) => void };

    /**
     * Use this controller to access data stored in the browser for the user
     */
    userConfigPersistence?: UserConfigurationPersistence;

    /**
     * Callback to send analytics events
     */
    analyticsController?: AnalyticsController;


    /**
     * Administrative database operations (SQL, schema discovery).
     * Only available in developer/admin contexts.
     */
    databaseAdmin?: DatabaseAdmin;

    /**
     * Controller for snackbars
     */
    snackbarController?: import("./controllers/snackbar").SnackbarController;

};
