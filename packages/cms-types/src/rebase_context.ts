import type { AnalyticsController } from "./controllers/analytics_controller";
import type { AuthController } from "./controllers/auth";
import type { UserConfigurationPersistence } from "./controllers/local_config_persistence";
import type { DatabaseAdmin } from "@rebasepro/types";
import type { RebaseCallContext } from "@rebasepro/types";
import type { User } from "@rebasepro/types";

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
    collectionRegistryController?: import("@rebasepro/types").CollectionRegistryController;

    /**
     * Controller for navigation state
     */
    navigationStateController?: import("./controllers/navigation").NavigationStateController;

    /**
     * Controller for side dialogs (side sheets)
     */
    sideDialogsController?: import("./controllers/side_dialogs_controller").SideDialogsController;

    /**
     * Controller to open the side panel displaying entity forms
     */
    sidePanelController?: import("./controllers/side_panel_controller").SidePanelController;

    /**
     * Controller resolving URLs in the admin
     */
    urlController?: import("./controllers/navigation").UrlController;

    /**
     * Controller to handle simple confirmation and alert dialogs
     */
    dialogsController?: import("./controllers/dialogs_controller").DialogsController;

    /**
     * Controller for admin customization
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
