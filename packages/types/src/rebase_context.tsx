import type { AnalyticsController } from "./controllers/analytics_controller";
import type { AuthController } from "./controllers/auth";
import type { StorageSource } from "./controllers/storage";
import type { UserConfigurationPersistence } from "./controllers/local_config_persistence";
import type { DatabaseAdmin } from "./types/backend";
import type { RebaseClient } from "./controllers/client";

import type { RebaseData } from "./controllers/data";
import type { User } from "./users";
import type { UserManagementDelegate } from "./types/user_management_delegate";


/**
 * Context that is provided to entity callbacks (hooks).
 * It contains only the dependencies that are available in both the frontend and the backend.
 * @group Hooks and utilities
 */
export type RebaseCallContext<USER extends User = User> = {

    /**
     * The Rebase client instance.
     * Available in all entity callbacks (beforeSave, afterSave, afterRead,
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
    client: RebaseClient<any>;

    /**
     * Unified data access — `context.data.products.create(...)`.
     * Access any collection as a dynamic property.
     */
    data: RebaseData;

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
     * Controller to open the side dialog displaying entity forms
     */
    sideEntityController?: import("./controllers/side_entity_controller").SideEntityController;

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
     * This section is used to manage users in the CMS.
     * It is used to show user information in various places of the CMS,
     * for example, to show who created or modified an entity,
     * or to assign ownership of an entity.
     *
     * In the base CMS, this information is not used for access control.
     * You can pass your own implementation of this section, to populate
     * the dropdown of users when assigning ownership of an entity,
     * or to show more information about the user.
     *
     * If you are using the Rebase user management plugin, this
     * section will be implemented automatically.
     */
    userManagement?: UserManagementDelegate<USER>;

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
